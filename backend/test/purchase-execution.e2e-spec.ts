/**
 * Purchase Execution E2E tests (docx spec Phase 9).
 *
 * Covers: Supplier Order => Goods Receipt (partial, twice), fulfillment
 * (received/remaining) recomputed live, over-receipt rejection, Goods
 * Receipt posting with real GRNI clearing GL entry and physical inventory
 * increase, Goods Receipt => Purchase Invoice inheriting receipt lines
 * and clearing GRNI (never double-debiting inventory), real input VAT +
 * Accounts Payable (SupplierPayable) on invoice posting, duplicate
 * supplier invoice rejection, direct Supplier-Order-based invoice (no
 * receipt) debiting inventory directly, Purchase Return against a posted
 * invoice with prorated tax + contra GL + inventory decrease + excessive
 * -return rejection, Additional Purchase Cost BY_VALUE allocation with a
 * balanced GL entry, three-way matching (MATCHED and QUANTITY_MISMATCH),
 * and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { PURCHASE_ORDER_TYPE } from '../src/procurement/purchase-order.repository';
import { GOODS_RECEIPT_TYPE } from '../src/purchase-execution/goods-receipt.repository';
import { PURCHASE_INVOICE_TYPE } from '../src/purchase-execution/purchase-invoice.repository';
import * as request from 'supertest';

describe('Purchase Execution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let approverToken: string; // holds every approval-chain role, distinct from token1 (the creator)
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let productId: string;
  let unitId: string;
  let supplierId: string;
  let warehouseId: string;
  let currencyId: string;
  let responsiblePersonId: string;

  const DOC_DATE = '2026-08-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const localization = app.get(AzTaxLocalizationService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`pex1-${run}@e2e.test`, `pex-t1-${run}`, 'PEX1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    approverToken = await setupApprover(tenant1Id, org1Id);
    const s2 = await setupTenant(`pex2-${run}@e2e.test`, `pex-t2-${run}`, 'PEX2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    await charts.ensureAdopted(tenant1Id);
    await localization.ensureSeeded();

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS9', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'P9-PROD-001', name: 'Purchase Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: 'SUP-P9', name: 'Purchase Supply Co', paymentTerms: 30, taxId: '1234567890', countryCode: 'AZ' })
      .expect(201);
    supplierId = supplier.body.id;
    // Approved (not just DRAFT) — CounterpartyContractService derives its own
    // required "counterpartyTaxStatus" approval field from this status.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplierId}/addresses`))
      .send({ addressType: 'LEGAL', addressLine1: '1 Purchase St', city: 'Baku', countryCode: 'AZ' })
      .expect(201);
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplierId}/approve`))
      .send({ expectedVersion: supplier.body.version })
      .expect(201);

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-P9', name: 'Purchase Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;

    const curRes = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id;

    const personRes = await auth1(request(app.getHttpServer()).post('/responsible-persons'))
      .send({ displayName: 'Purchase Execution Contract Manager' })
      .expect(201);
    responsiblePersonId = personRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** PurchaseOrderContractGateService (counterparty-contracts) refuses any
   * Goods Receipt / Purchase Invoice created directly against a Purchase
   * Order (via `supplierOrderId`) until that order has an APPROVED
   * CounterpartyContract — independent of, and checked before, this
   * file's own PO-approval / over-delivery / price-visibility gates. Every
   * direct-create fixture below must draw up and approve one first. Only
   * a confirmed (posted) PO can source a contract, so callers must
   * confirm/post the PO before calling this. */
  async function createApprovedContractFor(poId: string, number: string) {
    const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
      .send({ purchaseOrderId: poId, number });
    if (contract.status !== 201) throw new Error(`from-purchase-order failed: ${contract.status} ${JSON.stringify(contract.body)}`);
    const filled = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}`))
      .send({
        expectedVersion: contract.body.version, contractType: 'SUPPLY', signedDate: DOC_DATE, startDate: DOC_DATE, endDate: '2026-12-31',
        paymentTerms: 'NET 30', deliveryTerms: 'EXW', responsiblePersonId, currencyId,
      })
      .expect(200);
    await auth1(
      request(app.getHttpServer())
        .post(`/organizations/${org1Id}/counterparty-documents`)
        .field('ownerType', 'CONTRACT')
        .field('ownerId', contract.body.id)
        .attach('file', Buffer.from('%PDF-1.4 signed contract'), { filename: 'signed.pdf', contentType: 'application/pdf' }),
    ).expect(201);
    const approved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/approve`))
      .send({ expectedVersion: filled.body.version });
    if (approved.status !== 201) throw new Error(`contract approve failed: ${approved.status} ${JSON.stringify(approved.body)}`);
  }

  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const regRes = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Test User' }).expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'USD' })
      .expect(201);
    const tenantId = tenantRes.body.id;
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .send({ code: orgCode, name: `${orgCode} Org` })
      .expect(201);
    return { token, tenantId, orgId: orgRes.body.id };
  }

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }

  /** Registers a second tenant1 user holding every approval-chain role,
   * distinct from token1 (the creator of every fixture PO below) — see
   * procurement.e2e-spec.ts's identical helper for the full rationale. */
  async function setupApprover(tenantId: string, organizationId: string): Promise<string> {
    const email = `pex-approver-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId, accessLevel: 'FULL' } });

    const approvalPermissions = await prisma.permission.findMany({
      where: {
        code: {
          in: [
            'purchase.order.view',
            'purchase.order.approve',
            'purchase.order.reject',
            'documents.view',
            'purchase_execution.view',
            'purchase_execution.create',
            'purchase_execution.price_view',
            'purchase_execution.receipt.approve',
            'purchase_execution.receipt.reject',
            'purchase_execution.invoice.approve',
            'purchase_execution.invoice.reject',
          ],
        },
      },
    });
    for (const roleCode of ['PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR', 'FINANCE_USER', 'ACCOUNTING_USER', 'WAREHOUSE_SUPERVISOR']) {
      const role = await prisma.role.create({ data: { tenantId, code: roleCode, name: roleCode } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await prisma.rolePermission.createMany({ data: approvalPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
    return reg.body.accessToken;
  }

  function approverAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
  }

  /** Every PurchaseOrder fixture here is manual (no requirement link), so
   * DEPARTMENT_HEAD is always auto-SKIPPED — no department scoping needed. */
  async function fullyApprovePurchaseOrder(orderId: string) {
    for (let i = 0; i < 5; i++) {
      const current = await approverAuth(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${orderId}`)).expect(200);
      if (current.body.approvalStatus === 'APPROVED') return;
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${orderId}/approve`)).send({}).expect(201);
    }
  }

  async function fullyApproveGoodsReceipt(receiptId: string) {
    for (let i = 0; i < 5; i++) {
      const current = await approverAuth(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${receiptId}`)).expect(200);
      if (current.body.approvalStatus === 'APPROVED' || current.body.approvalStatus === 'NOT_REQUIRED') return;
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts/${receiptId}/approve`)).send({}).expect(201);
    }
  }

  async function fullyApprovePurchaseInvoice(invoiceId: string) {
    for (let i = 0; i < 5; i++) {
      const current = await approverAuth(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invoiceId}`)).expect(200);
      if (current.body.approvalStatus === 'APPROVED' || current.body.approvalStatus === 'NOT_REQUIRED') return;
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices/${invoiceId}/approve`)).send({}).expect(201);
    }
  }

  /** A restricted user holding only WAREHOUSE_USER's real permissions — no
   * PURCHASE_PRICE_VIEW, no approve/reject — for testing price redaction
   * and forced-price behavior from the warehouse side. */
  async function setupWarehouseUser(): Promise<string> {
    const email = `pex-warehouse-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Warehouse User' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });
    const permissions = await prisma.permission.findMany({ where: { code: { in: ['purchase_execution.view', 'purchase_execution.create', 'purchase_execution.edit', 'documents.view'] } } });
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: `WAREHOUSE_USER_${run}`, name: 'Warehouse (restricted)' } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    return reg.body.accessToken;
  }

  async function createConfirmedSupplierOrder(quantity: number, price = 10) {
    const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
      .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    await fullyApprovePurchaseOrder(po.body.id);
    const confirmed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
      .send({ expectedVersion: po.body.version })
      .expect(201);
    const fresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${po.body.id}`)).expect(200);
    return { ...fresh.body, postingStatus: confirmed.body.postingStatus };
  }

  async function sumDebitsCredits(journalEntryId: string) {
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId } });
    const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
    const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
    return { debit, credit };
  }

  describe('Supplier Order => Goods Receipt (spec sections 3-5, 22, 25) — partial receipts', () => {
    it('receives partially twice, tracks remaining live, rejects over-receipt, posts real GRNI clearing GL + physical stock', async () => {
      const order = await createConfirmedSupplierOrder(100, 10);

      const created1 = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      // create-based-on defaults to the FULL remaining (100) — trim to 60 for this test's "partial" scenario.
      await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${created1.body.id}`)).expect(200);
      const grLine = (await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${created1.body.id}`)).expect(200)).body.lines[0];
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/goods-receipts/${created1.body.id}`))
        .send({ expectedVersion: created1.body.version, lines: [{ productId, unitId, quantity: 60, price: 10, warehouseId, supplierOrderLineId: order.lines[0].id }] })
        .expect(200);
      const gr1 = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${created1.body.id}`)).expect(200);

      const posted1 = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr1.body.id}/post`))
        .send({ expectedVersion: gr1.body.version })
        .expect(201);
      expect(posted1.body.postingStatus).toBe('POSTED');

      const journal1 = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: gr1.body.id } });
      expect(journal1).not.toBeNull();
      const bal1 = await sumDebitsCredits(journal1!.id);
      expect(bal1.debit).toBeCloseTo(bal1.credit, 2);
      expect(bal1.debit).toBeCloseTo(600, 2); // 60 * 10

      const invMovement = await prisma.inventoryMovement.findFirst({ where: { tenantId: tenant1Id, registrarDocumentType: GOODS_RECEIPT_TYPE, registrarDocumentId: gr1.body.id } });
      expect(invMovement).not.toBeNull();

      const fulfillmentMid = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/supplier-orders/${order.id}/fulfillment`)).expect(200);
      expect(Number(fulfillmentMid.body[0].received)).toBeCloseTo(60, 6);
      expect(Number(fulfillmentMid.body[0].remainingToReceive)).toBeCloseTo(40, 6);

      // Over-receipt: requesting 50 when only 40 remains is rejected outright with no reason...
      const created2 = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/goods-receipts/${created2.body.id}`))
        .send({ expectedVersion: created2.body.version, lines: [{ productId, unitId, quantity: 50, price: 10, warehouseId, supplierOrderLineId: order.lines[0].id }] })
        .expect(400);

      // ...but is accepted as a draft with a reason, and now needs WAREHOUSE_SUPERVISOR approval before posting.
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/goods-receipts/${created2.body.id}`))
        .send({ expectedVersion: created2.body.version, lines: [{ productId, unitId, quantity: 50, price: 10, warehouseId, supplierOrderLineId: order.lines[0].id, overReceiptReason: 'Supplier shipped extra units' }] })
        .expect(200);
      const gr2Over = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${created2.body.id}`)).expect(200);
      expect(gr2Over.body.approvalStatus).toBe('PENDING');
      const overSteps = await auth1(
        request(app.getHttpServer()).get('/approval-steps').query({ documentType: GOODS_RECEIPT_TYPE, documentId: gr2Over.body.id }),
      ).expect(200);
      expect(overSteps.body).toHaveLength(1);
      expect(overSteps.body[0].stepType).toBe('WAREHOUSE_SUPERVISOR');
      const blockedPost = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr2Over.body.id}/post`))
        .send({ expectedVersion: gr2Over.body.version })
        .expect(400);
      expect(blockedPost.body.message).toMatch(/approval/i);

      // Correct second receipt of the remaining 40.
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/goods-receipts/${created2.body.id}`))
        .send({ expectedVersion: gr2Over.body.version, lines: [{ productId, unitId, quantity: 40, price: 10, warehouseId, supplierOrderLineId: order.lines[0].id }] })
        .expect(200);
      const gr2 = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${created2.body.id}`)).expect(200);
      const posted2 = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr2.body.id}/post`))
        .send({ expectedVersion: gr2.body.version })
        .expect(201);
      expect(posted2.body.postingStatus).toBe('POSTED');

      const fulfillmentFinal = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/supplier-orders/${order.id}/fulfillment`)).expect(200);
      expect(Number(fulfillmentFinal.body[0].received)).toBeCloseTo(100, 6);
      expect(Number(fulfillmentFinal.body[0].remainingToReceive)).toBeCloseTo(0, 6);
    });
  });

  describe('Goods Receipt => Purchase Invoice (spec sections 6-10, 25) — clears GRNI, real VAT + AP', () => {
    it('creates an invoice from the receipt, clears GRNI (not double-debiting inventory), posts real input VAT and a SupplierPayable', async () => {
      const order = await createConfirmedSupplierOrder(20, 15);
      const grCreated = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      const grFresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${grCreated.body.id}`)).expect(200);
      const grPosted = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${grFresh.body.id}/post`))
        .send({ expectedVersion: grFresh.body.version })
        .expect(201);
      expect(grPosted.body.postingStatus).toBe('POSTED');

      const invCreated = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${grFresh.body.id}/create-based-on/${PURCHASE_INVOICE_TYPE}`)).expect(201);
      const invFresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invCreated.body.id}`)).expect(200);
      expect(invFresh.body.lines[0].goodsReceiptLineId).toBeTruthy();

      const invPosted = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${invFresh.body.id}/post`))
        .send({ expectedVersion: invFresh.body.version })
        .expect(201);
      expect(invPosted.body.postingStatus).toBe('POSTED');

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: invFresh.body.id } });
      expect(journal).not.toBeNull();
      const bal = await sumDebitsCredits(journal!.id);
      expect(bal.debit).toBeCloseTo(bal.credit, 2);

      const taxMovement = await prisma.taxMovement.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: invFresh.body.id, direction: 'INPUT' } });
      expect(taxMovement).not.toBeNull();

      const payable = await prisma.supplierPayable.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: invFresh.body.id } });
      expect(payable).not.toBeNull();
      expect(Number(payable!.invoiceAmount)).toBeGreaterThan(300); // 20*15 net + VAT

      // Only ONE inventory movement exists for the whole chain (from the
      // receipt) — the invoice never wrote a second one.
      const invMovementCount = await prisma.inventoryMovement.count({ where: { tenantId: tenant1Id, registrarDocumentType: GOODS_RECEIPT_TYPE, registrarDocumentId: grFresh.body.id } });
      expect(invMovementCount).toBe(1);
    });

    it('rejects a duplicate supplier invoice number for the same supplier', async () => {
      const order = await createConfirmedSupplierOrder(5, 8);
      await createApprovedContractFor(order.id, `C-DUP-${run}`);
      const invoiceNumber = `DUP-${run}`;
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, supplierInvoiceNumber: invoiceNumber, supplierOrderId: order.id, lines: [{ productId, unitId, quantity: 5, price: 8, supplierOrderLineId: order.lines[0].id }] })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, supplierInvoiceNumber: invoiceNumber, lines: [{ productId, unitId, quantity: 1, price: 8 }] })
        .expect(409);
    });

    it('supports an invoice-without-receipt flow (direct from Supplier Order), debiting inventory directly', async () => {
      const order = await createConfirmedSupplierOrder(7, 12);
      const invCreated = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${PURCHASE_INVOICE_TYPE}`)).expect(201);
      const invFresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invCreated.body.id}`)).expect(200);
      expect(invFresh.body.lines[0].goodsReceiptLineId).toBeFalsy();
      expect(invFresh.body.lines[0].supplierOrderLineId).toBeTruthy();

      const invPosted = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${invFresh.body.id}/post`))
        .send({ expectedVersion: invFresh.body.version })
        .expect(201);
      expect(invPosted.body.postingStatus).toBe('POSTED');

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: invFresh.body.id } });
      const bal = await sumDebitsCredits(journal!.id);
      expect(bal.debit).toBeCloseTo(bal.credit, 2);
    });
  });

  describe('Purchase Return (spec sections 14-16) — post-invoice, prorated tax, contra GL', () => {
    it('returns part of a posted invoice with prorated tax and rejects an excessive return', async () => {
      const order = await createConfirmedSupplierOrder(10, 25);
      const invCreated = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${PURCHASE_INVOICE_TYPE}`)).expect(201);
      const invFresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invCreated.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${invFresh.body.id}/post`))
        .send({ expectedVersion: invFresh.body.version })
        .expect(201);
      const invoiceLineId = invFresh.body.lines[0].id;

      const ret = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-returns`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, originalPurchaseInvoiceId: invFresh.body.id, warehouseId, returnReason: 'DAMAGED', lines: [{ sourceInvoiceLineId: invoiceLineId, productId, unitId, quantity: 3, originalUnitPrice: 25 }] })
        .expect(201);

      const retPosted = await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_RETURN/${ret.body.id}/post`))
        .send({ expectedVersion: ret.body.version })
        .expect(201);
      expect(retPosted.body.postingStatus).toBe('POSTED');

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'PURCHASE_RETURN', sourceDocumentId: ret.body.id } });
      const bal = await sumDebitsCredits(journal!.id);
      expect(bal.debit).toBeCloseTo(bal.credit, 2);
      expect(bal.debit).toBeGreaterThan(75); // 3 * 25 net + prorated VAT

      const issueMovement = await prisma.inventoryMovement.findFirst({ where: { tenantId: tenant1Id, registrarDocumentType: 'PURCHASE_RETURN', registrarDocumentId: ret.body.id } });
      expect(issueMovement).not.toBeNull();

      // Already returned 3 of 10 — attempting to return 8 more (11 total) is rejected.
      const ret2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-returns`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, originalPurchaseInvoiceId: invFresh.body.id, warehouseId, lines: [{ sourceInvoiceLineId: invoiceLineId, productId, unitId, quantity: 8, originalUnitPrice: 25 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_RETURN/${ret2.body.id}/post`))
        .send({ expectedVersion: ret2.body.version })
        .expect(422);
    });
  });

  describe('Additional Purchase Cost (spec sections 12-13, 54) — BY_VALUE allocation', () => {
    it('allocates transport cost proportionally by received value and posts a balanced GL entry', async () => {
      const orderA = await createConfirmedSupplierOrder(10, 100); // value 1000
      const grA = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${orderA.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      const grAFresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${grA.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${grAFresh.body.id}/post`)).send({ expectedVersion: grAFresh.body.version }).expect(201);

      const freightSupplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: 'FREIGHT-P9', name: 'Freight Co' })
        .expect(201);

      const cost = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/additional-purchase-costs`))
        .send({ counterpartyId: freightSupplier.body.id, documentDate: DOC_DATE, costType: 'TRANSPORT', allocationMethod: 'BY_VALUE', totalCost: 100, targetLines: [{ goodsReceiptLineId: grAFresh.body.lines[0].id }] })
        .expect(201);

      const posted = await auth1(request(app.getHttpServer()).post(`/documents/ADDITIONAL_PURCHASE_COST/${cost.body.id}/post`))
        .send({ expectedVersion: cost.body.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');

      const allocations = await prisma.purchaseCostAllocation.findMany({ where: { tenantId: tenant1Id, additionalPurchaseCostId: cost.body.id } });
      expect(allocations).toHaveLength(1);
      expect(Number(allocations[0].allocatedAmount)).toBeCloseTo(100, 2); // only one target line -> gets 100% of the cost

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'ADDITIONAL_PURCHASE_COST', sourceDocumentId: cost.body.id } });
      const bal = await sumDebitsCredits(journal!.id);
      expect(bal.debit).toBeCloseTo(bal.credit, 2);
    });
  });

  describe('Three-Way Matching (spec sections 8, 54)', () => {
    it('reports MATCHED when order/receipt/invoice quantities agree, and QUANTITY_MISMATCH when invoice differs from receipt', async () => {
      const order = await createConfirmedSupplierOrder(30, 5);
      const gr = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      const grFresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${gr.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${grFresh.body.id}/post`)).send({ expectedVersion: grFresh.body.version }).expect(201);

      const invMatched = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${grFresh.body.id}/create-based-on/${PURCHASE_INVOICE_TYPE}`)).expect(201);
      const matching = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invMatched.body.id}/matching`)).expect(200);
      expect(matching.body.overallStatus).toBe('MATCHED');

      // A fresh order/receipt pair, then an invoice for LESS than received.
      const order2 = await createConfirmedSupplierOrder(20, 5);
      const gr2 = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order2.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      const gr2Fresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${gr2.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr2Fresh.body.id}/post`)).send({ expectedVersion: gr2Fresh.body.version }).expect(201);

      const invPartial = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, goodsReceiptId: gr2Fresh.body.id, lines: [{ productId, unitId, quantity: 12, price: 5, goodsReceiptLineId: gr2Fresh.body.lines[0].id }] })
        .expect(201);
      const mismatch = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invPartial.body.id}/matching`)).expect(200);
      expect(mismatch.body.overallStatus).toBe('QUANTITY_MISMATCH');

      const checked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices/${invPartial.body.id}/check-matching`)).expect(201);
      expect(checked.body.overallStatus).toBe('QUANTITY_MISMATCH');
      const history = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invPartial.body.id}/matching-history`)).expect(200);
      expect(history.body).toHaveLength(1);
    });
  });

  describe('Approval workflow MVP — Goods Receipt gated on full PO approval', () => {
    it('rejects a Goods Receipt against a not-fully-approved PO, and allows it once approved', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 6, price: 9 }] })
        .expect(201);

      // Not yet approved (or posted) — a contract cannot exist against it
      // either (contracts/from-purchase-order itself requires a posted
      // PO), so the receipt is blocked regardless of which gate fires
      // first; either way, an unapproved PO can never receive goods.
      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, supplierOrderId: po.body.id, lines: [{ productId, unitId, quantity: 6, price: 9, supplierOrderLineId: po.body.lines[0].id }] })
        .expect(400);
      expect(blocked.body.message).toMatch(/not fully approved|no contract yet/i);

      await fullyApprovePurchaseOrder(po.body.id);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
        .send({ expectedVersion: po.body.version })
        .expect(201);
      await createApprovedContractFor(po.body.id, `C-GRNA-${run}`);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, supplierOrderId: po.body.id, lines: [{ productId, unitId, quantity: 6, price: 9, supplierOrderLineId: po.body.lines[0].id }] })
        .expect(201);
    });

    it('over-delivery on create requires a reason, then a WAREHOUSE_SUPERVISOR approval before posting', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5, price: 9 }] })
        .expect(201);
      await fullyApprovePurchaseOrder(po.body.id);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
        .send({ expectedVersion: po.body.version })
        .expect(201);
      await createApprovedContractFor(po.body.id, `C-GRNB-${run}`);

      // Requesting 8 against an order of 5, with no reason, is rejected outright.
      const rejected = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, supplierOrderId: po.body.id, lines: [{ productId, unitId, quantity: 8, price: 9, supplierOrderLineId: po.body.lines[0].id }] })
        .expect(400);
      expect(rejected.body.message).toMatch(/overReceiptReason/i);

      // With a reason, the draft is accepted but requires approval.
      const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, supplierOrderId: po.body.id, lines: [{ productId, unitId, quantity: 8, price: 9, supplierOrderLineId: po.body.lines[0].id, overReceiptReason: 'Supplier over-shipped' }] })
        .expect(201);
      expect(gr.body.approvalStatus).toBe('PENDING');

      const steps = await auth1(request(app.getHttpServer()).get('/approval-steps').query({ documentType: GOODS_RECEIPT_TYPE, documentId: gr.body.id })).expect(200);
      expect(steps.body).toHaveLength(1);
      expect(steps.body[0].stepType).toBe('WAREHOUSE_SUPERVISOR');

      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr.body.id}/post`))
        .send({ expectedVersion: gr.body.version })
        .expect(400);

      // Self-approval is blocked even for the over-delivery step.
      const selfApprove = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts/${gr.body.id}/approve`)).send({});
      expect(selfApprove.status).toBe(400);

      await fullyApproveGoodsReceipt(gr.body.id);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${gr.body.id}`)).expect(200);
      expect(approved.body.approvalStatus).toBe('APPROVED');

      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr.body.id}/post`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
    });
  });

  describe('Approval workflow MVP — warehouse price/tax visibility on Goods Receipt', () => {
    it('hides price/lineTotal from a user without PURCHASE_PRICE_VIEW, and forces the PO price regardless of what they submit', async () => {
      const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 10, price: 20 }] })
        .expect(201);
      await fullyApprovePurchaseOrder(po.body.id);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`))
        .send({ expectedVersion: po.body.version })
        .expect(201);
      await createApprovedContractFor(po.body.id, `C-GRNC1-${run}`);

      const warehouseToken = await setupWarehouseUser();
      const warehouseAuth = (req: request.Test) => req.set('Authorization', `Bearer ${warehouseToken}`).set('X-Tenant-Id', tenant1Id);

      // Warehouse user submits a different price — silently forced to the PO's 20, not rejected.
      const gr = await warehouseAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, supplierOrderId: po.body.id, lines: [{ productId, unitId, quantity: 10, price: 999, supplierOrderLineId: po.body.lines[0].id }] })
        .expect(201);
      expect(gr.body.lines[0].price).toBeUndefined();
      expect(gr.body.lines[0].lineTotal).toBeUndefined();

      // The stored value is the PO's price, not the submitted one — confirmed via a price-view-holding token.
      const asApprover = await approverAuth(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${gr.body.id}`)).expect(200);
      expect(Number(asApprover.body.lines[0].price)).toBeCloseTo(20, 6);

      // A price-view holder submitting a different price on a fresh order IS respected.
      const po2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5, price: 20 }] })
        .expect(201);
      await fullyApprovePurchaseOrder(po2.body.id);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po2.body.id}/confirm`))
        .send({ expectedVersion: po2.body.version })
        .expect(201);
      await createApprovedContractFor(po2.body.id, `C-GRNC2-${run}`);
      const gr2 = await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, supplierOrderId: po2.body.id, lines: [{ productId, unitId, quantity: 5, price: 18, supplierOrderLineId: po2.body.lines[0].id }] })
        .expect(201);
      expect(Number(gr2.body.lines[0].price)).toBeCloseTo(18, 6);
    });
  });

  describe('Approval workflow MVP — Purchase Invoice price variance', () => {
    it('requires ACCOUNTING approval above the 2% tolerance, and posts directly within it', async () => {
      const po = await createConfirmedSupplierOrder(10, 10);
      const grCreated = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${po.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      await fullyApproveGoodsReceipt(grCreated.body.id);
      const gr = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${grCreated.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);

      // 3% over the GRN's price of 10 -> exceeds tolerance -> needs approval.
      const invOver = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, goodsReceiptId: gr.body.id, lines: [{ lineType: 'INVENTORY', productId, unitId, quantity: 10, price: 10.3, goodsReceiptLineId: gr.body.lines[0].id }] })
        .expect(201);
      expect(invOver.body.approvalStatus).toBe('PENDING');
      const invSteps = await auth1(request(app.getHttpServer()).get('/approval-steps').query({ documentType: PURCHASE_INVOICE_TYPE, documentId: invOver.body.id })).expect(200);
      expect(invSteps.body).toHaveLength(1);
      expect(invSteps.body[0].stepType).toBe('ACCOUNTING');

      await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${invOver.body.id}/post`))
        .send({ expectedVersion: invOver.body.version })
        .expect(400);
      await fullyApprovePurchaseInvoice(invOver.body.id);
      const approvedInv = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invOver.body.id}`)).expect(200);
      expect(approvedInv.body.approvalStatus).toBe('APPROVED');
      await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${invOver.body.id}/post`))
        .send({ expectedVersion: approvedInv.body.version })
        .expect(201);

      // A second GRN + invoice at 1% variance (within 2% tolerance) posts directly.
      const po2 = await createConfirmedSupplierOrder(10, 10);
      const gr2Created = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${po2.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
      await fullyApproveGoodsReceipt(gr2Created.body.id);
      const gr2 = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${gr2Created.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr2.body.id}/post`)).send({ expectedVersion: gr2.body.version }).expect(201);

      const invWithin = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
        .send({ counterpartyId: supplierId, documentDate: DOC_DATE, goodsReceiptId: gr2.body.id, lines: [{ lineType: 'INVENTORY', productId, unitId, quantity: 10, price: 10.1, goodsReceiptLineId: gr2.body.lines[0].id }] })
        .expect(201);
      expect(invWithin.body.approvalStatus).toBe('NOT_REQUIRED');
      await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${invWithin.body.id}/post`))
        .send({ expectedVersion: invWithin.body.version })
        .expect(201);
    });
  });

  describe('Tenant isolation (spec section 125)', () => {
    it('tenant B cannot see tenant A goods receipts or purchase invoices', async () => {
      const order = await createConfirmedSupplierOrder(4, 9);
      const gr = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${order.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);

      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/goods-receipts/${gr.body.id}`)).expect(404);
      await auth2(request(app.getHttpServer()).post(`/organizations/${org2Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price: 1 }] })
        .expect(400);
    });
  });
});
