/**
 * "Kontragentlər" contract commercial/delivery terms + nomenclature +
 * tax + calculation E2E tests (spec sections 10-14).
 *
 * Covers: creating a contract from a confirmed Purchase Order, correct
 * nomenclature data transfer, partial-quantity contracting + remaining
 * quantity tracking, over-allocation beyond the PO's remaining quantity
 * blocked, VAT-payer vs non-VAT-payer calculations, resident vs non-
 * resident tax handling, tax-included-in-price vs not, discount/tax/
 * advance/remaining-payable calculations, incomplete-terms approval
 * blocked, and contract total vs line-total-sum consistency.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import * as request from 'supertest';

describe('Kontragentlər — Contract terms, nomenclature & tax (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let approverToken: string; // holds every approval-chain role, distinct from token1 (the creator)
  let tenant1Id: string;
  let org1Id: string;
  let unitId: string;
  let productId: string;
  let warehouseId: string;
  let currencyId: string;
  let responsiblePersonId: string;

  const DOC_DATE = '2026-09-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await app.get(ChartOfAccountsService); // not used to adopt here — POs post no GL
    const localization = app.get(AzTaxLocalizationService);
    await localization.ensureSeeded();

    const s1 = await setupTenant(`cct1-${run}@e2e.test`, `cct-t1-${run}`, 'CCT1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    approverToken = await setupApprover(tenant1Id, org1Id);

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: `PCS-CCT-${run}`, name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: `CCT-PROD-${run}`, name: 'Contract Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: `CCT-WH-${run}`, name: 'Contract Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;

    const curRes = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id;

    const personRes = await auth1(request(app.getHttpServer()).post('/responsible-persons'))
      .send({ displayName: 'Contract Manager' })
      .expect(201);
    responsiblePersonId = personRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

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

  /** Registers a second tenant1 user holding every approval-chain role,
   * distinct from token1 (the creator of every fixture requirement/PO
   * below) — see procurement.e2e-spec.ts's identical helper for the full
   * rationale. No requirement in this file carries an explicit department,
   * so DEPARTMENT_HEAD resolves tenant-wide with no extra scoping needed. */
  async function setupApprover(tenantId: string, organizationId: string): Promise<string> {
    const email = `cct-approver-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId, accessLevel: 'FULL' } });

    const approvalPermissions = await prisma.permission.findMany({
      where: { code: { in: ['purchase.order.view', 'purchase.order.approve', 'purchase.order.reject', 'purchase.requirement.view', 'purchase.requirement.approve', 'purchase.requirement.reject', 'documents.view'] } },
    });
    for (const roleCode of ['PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR', 'FINANCE_USER', 'ACCOUNTING_USER']) {
      const role = await prisma.role.create({ data: { tenantId, code: roleCode, name: roleCode } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await prisma.rolePermission.createMany({ data: approvalPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
    return reg.body.accessToken;
  }

  function approverAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
  }

  async function fullyApprovePurchaseOrder(orderId: string) {
    for (let i = 0; i < 5; i++) {
      const current = await approverAuth(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${orderId}`)).expect(200);
      if (current.body.approvalStatus === 'APPROVED') return;
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${orderId}/approve`)).send({}).expect(201);
    }
  }

  async function approveRequirement(requirementId: string) {
    await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements/${requirementId}/approve`)).send({}).expect(201);
  }

  let taxIdCounter = 0;
  function nextTaxId(): string {
    // Exactly 10 digits, unique per call within this run.
    taxIdCounter += 1;
    return String(1000000000 + ((run + taxIdCounter) % 9000000000)).padStart(10, '0').slice(-10);
  }

  async function createApprovedSupplier(opts: { vatPayer: boolean; residencyStatus?: string; suffix: string }) {
    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({
        counterpartyType: 'SUPPLIER', code: `SUP-CCT-${opts.suffix}-${run}`, name: `Supplier ${opts.suffix}`,
        residencyStatus: opts.residencyStatus ?? 'RESIDENT',
        taxId: opts.residencyStatus === 'NON_RESIDENT' ? undefined : nextTaxId(),
        foreignTaxId: opts.residencyStatus === 'NON_RESIDENT' ? `FOREIGN-${opts.suffix}` : undefined,
        vatPayer: opts.vatPayer, countryCode: opts.residencyStatus === 'NON_RESIDENT' ? 'DE' : 'AZ',
      })
      .expect(201);
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplier.body.id}/addresses`))
      .send({ addressType: 'LEGAL', addressLine1: '1 Test St', city: 'Baku', countryCode: 'AZ' })
      .expect(201);
    const approved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplier.body.id}/approve`))
      .send({ expectedVersion: supplier.body.version })
      .expect(201);
    return approved.body;
  }

  async function createConfirmedPO(supplierId: string, quantity: number, price: number, priceIncludesTax = false) {
    const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
      .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, currencyId, priceIncludesTax, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    await fullyApprovePurchaseOrder(po.body.id);
    await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${po.body.id}/post`))
      .send({ expectedVersion: po.body.version })
      .expect(201);
    return (await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${po.body.id}`))).body;
  }

  describe('Create from Purchase Order + nomenclature transfer (spec section 11)', () => {
    it('creates a contract from a confirmed PO and copies product/quantity/unit/price/currency/tax onto the line', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'A' });
      const po = await createConfirmedPO(supplier.id, 20, 15);
      const poLineId = po.lines[0].id;

      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-XFER-${run}` })
        .expect(201);

      expect(contract.body.counterpartyId).toBe(supplier.id);
      expect(contract.body.sourcePurchaseOrderId).toBe(po.id);
      expect(contract.body.lines).toHaveLength(1);
      const line = contract.body.lines[0];
      expect(line.productId).toBe(productId);
      expect(line.unitId).toBe(unitId);
      expect(Number(line.quantity)).toBe(20);
      expect(Number(line.unitPrice)).toBe(15);
      expect(line.sourceOrderLineId).toBe(poLineId);
      expect(Number(line.lineAmount)).toBeCloseTo(300, 2); // 20 * 15
      expect(line.taxCategoryCode).toBe('STANDARD_VAT');
      expect(Number(line.taxRatePercent)).toBeCloseTo(18, 2);
      expect(Number(line.taxAmount)).toBeCloseTo(54, 2); // 300 * 18%
      expect(Number(line.lineTotal)).toBeCloseTo(354, 2);
      expect(Number(contract.body.amount)).toBeCloseTo(354, 2);
    });
  });

  describe('Partial quantity + remaining-quantity tracking, over-allocation blocked (spec section 11)', () => {
    it('contracts part of a PO line and tracks the remaining quantity, then blocks exceeding it', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'B' });
      const po = await createConfirmedPO(supplier.id, 100, 10);
      const poLineId = po.lines[0].id;

      const partial = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-PART-${run}`, lines: [{ purchaseOrderLineId: poLineId, quantity: 60 }] })
        .expect(201);
      expect(Number(partial.body.lines[0].quantity)).toBe(60);

      const remaining = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${partial.body.id}`)).expect(200);
      void remaining;

      // Exceeding the PO line's remaining 40 units is blocked.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-OVER-${run}`, lines: [{ purchaseOrderLineId: poLineId, quantity: 41 }] })
        .expect(400);

      // Exactly the remaining 40 succeeds.
      const rest = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-REST-${run}`, lines: [{ purchaseOrderLineId: poLineId, quantity: 40 }] })
        .expect(201);
      expect(Number(rest.body.lines[0].quantity)).toBe(40);

      // Now fully allocated — even 1 more unit is rejected.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-NONE-${run}`, lines: [{ purchaseOrderLineId: poLineId, quantity: 1 }] })
        .expect(400);
    });
  });

  describe('VAT-payer vs non-VAT-payer calculations (spec section 12)', () => {
    it('applies the standard VAT rate for a VAT-payer supplier and zero tax for a non-VAT-payer supplier', async () => {
      const vatPayerSupplier = await createApprovedSupplier({ vatPayer: true, suffix: 'VP' });
      const poVat = await createConfirmedPO(vatPayerSupplier.id, 10, 100);
      const contractVat = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poVat.id, number: `C-VATPAYER-${run}` })
        .expect(201);
      expect(Number(contractVat.body.lines[0].taxRatePercent)).toBeCloseTo(18, 2);
      expect(Number(contractVat.body.lines[0].taxAmount)).toBeCloseTo(180, 2); // 1000 * 18%

      const nonVatSupplier = await createApprovedSupplier({ vatPayer: false, suffix: 'NVP' });
      const poNonVat = await createConfirmedPO(nonVatSupplier.id, 10, 100);
      const contractNonVat = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poNonVat.id, number: `C-NONVATPAYER-${run}` })
        .expect(201);
      expect(contractNonVat.body.lines[0].taxCategoryCode).toBe('VAT_EXEMPT');
      expect(Number(contractNonVat.body.lines[0].taxRatePercent)).toBe(0);
      expect(Number(contractNonVat.body.lines[0].taxAmount)).toBe(0);
      expect(Number(contractNonVat.body.amount)).toBeCloseTo(1000, 2);
    });
  });

  describe('Resident vs non-resident suppliers (spec section 12)', () => {
    it('computes tax consistently for both residency statuses when both are VAT payers (residency is tracked and gates counterparty approval; this build keys VAT category on vat-payer status, not residency — no reverse-charge rule is seeded)', async () => {
      const resident = await createApprovedSupplier({ vatPayer: true, residencyStatus: 'RESIDENT', suffix: 'RES' });
      const nonResident = await createApprovedSupplier({ vatPayer: true, residencyStatus: 'NON_RESIDENT', suffix: 'NRS' });
      expect(resident.residencyStatus).toBe('RESIDENT');
      expect(nonResident.residencyStatus).toBe('NON_RESIDENT');
      expect(nonResident.taxId).toBeNull();
      expect(nonResident.foreignTaxId).toBeTruthy();

      const poResident = await createConfirmedPO(resident.id, 5, 50);
      const poNonResident = await createConfirmedPO(nonResident.id, 5, 50);
      const cResident = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poResident.id, number: `C-RES-${run}` })
        .expect(201);
      const cNonResident = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poNonResident.id, number: `C-NRS-${run}` })
        .expect(201);

      expect(Number(cResident.body.lines[0].taxRatePercent)).toBeCloseTo(18, 2);
      expect(Number(cNonResident.body.lines[0].taxRatePercent)).toBeCloseTo(18, 2);
    });
  });

  describe('Tax included vs excluded from price (spec section 13)', () => {
    it('correctly separates tax out of a tax-inclusive price, vs adding it on top of a tax-exclusive price', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'TX' });

      const poExclusive = await createConfirmedPO(supplier.id, 1, 118, false);
      const cExclusive = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poExclusive.id, number: `C-EXCL-${run}` })
        .expect(201);
      expect(Number(cExclusive.body.lines[0].taxBase)).toBeCloseTo(118, 2);
      expect(Number(cExclusive.body.lines[0].taxAmount)).toBeCloseTo(21.24, 2); // 118 * 18%
      expect(Number(cExclusive.body.lines[0].lineTotal)).toBeCloseTo(139.24, 2);

      const poInclusive = await createConfirmedPO(supplier.id, 1, 118, true);
      const cInclusive = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poInclusive.id, number: `C-INCL-${run}` })
        .expect(201);
      // 118 gross -> net = 118 / 1.18 = 100.00, tax = 18.00
      expect(Number(cInclusive.body.lines[0].taxBase)).toBeCloseTo(100, 2);
      expect(Number(cInclusive.body.lines[0].taxAmount)).toBeCloseTo(18, 2);
      expect(Number(cInclusive.body.lines[0].lineTotal)).toBeCloseTo(118, 2);
    });
  });

  describe('Discount, tax, advance, and remaining-payable calculations (spec sections 10, 13)', () => {
    it('computes discount, tax base, advance amount (auto from percent), and the remaining payable amount', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'DA' });
      const po = await createConfirmedPO(supplier.id, 10, 100); // 1000 pre-discount

      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-DISC-${run}` })
        .expect(201);
      const lineId = contract.body.lines[0].id;

      // Apply a 10% discount to the line.
      const discounted = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}/lines/${lineId}`))
        .send({ expectedVersion: 1, discountPercent: 10 })
        .expect(200);
      expect(Number(discounted.body.discountAmount)).toBeCloseTo(100, 2); // 1000 * 10%
      expect(Number(discounted.body.taxBase)).toBeCloseTo(900, 2); // 1000 - 100
      expect(Number(discounted.body.taxAmount)).toBeCloseTo(162, 2); // 900 * 18%
      expect(Number(discounted.body.lineTotal)).toBeCloseTo(1062, 2);

      const afterDiscount = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${contract.body.id}`)).expect(200);
      expect(Number(afterDiscount.body.totalDiscount)).toBeCloseTo(100, 2);
      expect(Number(afterDiscount.body.subtotal)).toBeCloseTo(900, 2);
      expect(Number(afterDiscount.body.totalTax)).toBeCloseTo(162, 2);
      expect(Number(afterDiscount.body.amount)).toBeCloseTo(1062, 2);

      // 30% advance, auto-computed from the current grand total.
      const withAdvance = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/advance`))
        .send({ expectedVersion: afterDiscount.body.version, hasAdvance: true, advancePercent: 30 })
        .expect(201);
      expect(Number(withAdvance.body.advanceAmount)).toBeCloseTo(318.6, 2); // 1062 * 30%
      expect(Number(withAdvance.body.remainingPayableAmount)).toBeCloseTo(743.4, 2);

      // A manual override is honored and survives further recalculation.
      const manualAdvance = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/advance`))
        .send({ expectedVersion: withAdvance.body.version, advanceAmount: 400 })
        .expect(201);
      expect(Number(manualAdvance.body.advanceAmount)).toBe(400);
      expect(Number(manualAdvance.body.remainingPayableAmount)).toBeCloseTo(662, 2);
      expect(manualAdvance.body.advanceAmountManual).toBe(true);
    });
  });

  describe('Approval blocked on incomplete terms (spec section 14)', () => {
    it('blocks approval until delivery/payment terms, a document, and tax calculation are all in place — then succeeds', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'FIN' });
      const po = await createConfirmedPO(supplier.id, 4, 25);

      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-FIN-${run}` })
        .expect(201);

      // Missing header terms (contractType/dates/paymentTerms/deliveryTerms/responsiblePerson) blocks approval.
      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/approve`))
        .send({ expectedVersion: contract.body.version })
        .expect(400);
      expect(blocked.body.fieldErrors).toHaveProperty('paymentTerms');
      expect(blocked.body.fieldErrors).toHaveProperty('deliveryTerms');
      expect(blocked.body.fieldErrors).not.toHaveProperty('lines');
      expect(blocked.body.fieldErrors).not.toHaveProperty('sourcePurchaseOrderId');

      const filled = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}`))
        .send({
          expectedVersion: contract.body.version, contractType: 'SUPPLY', signedDate: DOC_DATE, startDate: DOC_DATE, endDate: '2026-12-31',
          paymentTerms: 'NET 30', deliveryTerms: 'EXW', responsiblePersonId,
        })
        .expect(200);

      // Still missing a document.
      const stillBlocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/approve`))
        .send({ expectedVersion: filled.body.version })
        .expect(400);
      expect(stillBlocked.body.message).toMatch(/missing/i);

      await auth1(
        request(app.getHttpServer())
          .post(`/organizations/${org1Id}/counterparty-documents`)
          .field('ownerType', 'CONTRACT')
          .field('ownerId', contract.body.id)
          .attach('file', Buffer.from('%PDF-1.4 signed contract'), { filename: 'signed.pdf', contentType: 'application/pdf' }),
      ).expect(201);

      const approved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/approve`))
        .send({ expectedVersion: filled.body.version })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approvedBy).toBeTruthy();
    });
  });

  describe('Contract total vs sum of line totals (spec section 14)', () => {
    it('keeps the contract amount structurally equal to the sum of line totals through edits', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'SUM' });
      const po = await createConfirmedPO(supplier.id, 3, 40);
      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-SUM-${run}` })
        .expect(201);

      const beforeAmount = Number(contract.body.amount);
      const lineTotalSum = contract.body.lines.reduce((s: number, l: any) => s + Number(l.lineTotal), 0);
      expect(beforeAmount).toBeCloseTo(lineTotalSum, 2);

      const lineId = contract.body.lines[0].id;
      const updated = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}/lines/${lineId}`))
        .send({ expectedVersion: 1, quantity: 2 })
        .expect(200);
      void updated;

      const after = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${contract.body.id}`)).expect(200);
      const afterLineTotalSum = after.body.lines.reduce((s: number, l: any) => s + Number(l.lineTotal), 0);
      expect(Number(after.body.amount)).toBeCloseTo(afterLineTotalSum, 2);
    });
  });

  describe('Requirement -> Order -> Contract traceability, PO selection restrictions, and manual-line lockdown', () => {
    it('carries the requirement -> PO -> contract line chain end to end and shows it on the contract', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'CHAIN' });
      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 10, description: 'Chain test' }] })
        .expect(201);
      await approveRequirement(req.body.id);
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/from-requirements`))
        .send({ requirementIds: [req.body.id], counterpartyId: supplier.id, documentDate: DOC_DATE })
        .expect(201);
      // Fill the price the requirement itself never carried, then confirm.
      const priced = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/purchase-orders/${order.body.id}`))
        .send({ expectedVersion: order.body.version, lines: [{ productId, unitId, quantity: 10, price: 30, requirementLineId: req.body.lines[0].id }] })
        .expect(200);
      await fullyApprovePurchaseOrder(order.body.id);
      await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${order.body.id}/post`))
        .send({ expectedVersion: priced.body.version })
        .expect(201);
      const posted = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-orders/${order.body.id}`)).expect(200);

      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: posted.body.id, number: `C-CHAIN-${run}` })
        .expect(201);

      const line = contract.body.lines[0];
      expect(line.sourceChain).toBeTruthy();
      expect(line.sourceChain.purchaseOrderId).toBe(posted.body.id);
      expect(line.sourceChain.purchaseOrderLineId).toBe(posted.body.lines[0].id);
      expect(line.sourceChain.purchaseRequirementId).toBe(req.body.id);
      expect(line.sourceChain.purchaseRequirementLineId).toBe(req.body.lines[0].id);
    });

    it('rejects a purchase order with a blank-price line as a contract source, and excludes it from the eligible-purchase-orders list', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'NOPRICE' });
      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-requirements`))
        .send({ documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);
      await approveRequirement(req.body.id);
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/from-requirements`))
        .send({ requirementIds: [req.body.id], counterpartyId: supplier.id, documentDate: DOC_DATE })
        .expect(201);
      expect(order.body.lines[0].price).toBeNull();
      // A PO stuck DRAFT with a blank price can never be POSTED, so it can
      // never reach createFromPurchaseOrder's "must be posted" gate either
      // — confirm both fail the same way a user would encounter them.
      await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_ORDER/${order.body.id}/post`))
        .send({ expectedVersion: order.body.version })
        .expect(400);
      const rejected = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: order.body.id, number: `C-NOPRICE-${run}` })
        .expect(400);
      expect(rejected.body.message).toMatch(/confirmed|posted/i);

      const eligible = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${supplier.id}/contracts/eligible-purchase-orders`)).expect(200);
      expect(eligible.body.find((o: any) => o.id === order.body.id)).toBeUndefined();
    });

    it('blocks manual nomenclature entry outside the source PO, but allows re-adding a source PO line capped at its remaining quantity', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'MANUAL' });
      const po = await createConfirmedPO(supplier.id, 50, 10);
      const otherPo = await createConfirmedPO(supplier.id, 50, 10);
      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-MANUAL-${run}` })
        .expect(201);

      // No sourceOrderLineId at all -> rejected (manual nomenclature).
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/lines`))
        .send({ quantity: 5 })
        .expect(400);

      // A line belonging to a DIFFERENT purchase order -> rejected.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/lines`))
        .send({ sourceOrderLineId: otherPo.lines[0].id, quantity: 5 })
        .expect(400);

      // Remove the auto-pulled line, then re-add it — capped at remaining.
      const lineId = contract.body.lines[0].id;
      await auth1(request(app.getHttpServer()).delete(`/organizations/${org1Id}/contracts/${contract.body.id}/lines/${lineId}`)).expect(200);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/lines`))
        .send({ sourceOrderLineId: po.lines[0].id, quantity: 999 })
        .expect(400);

      const readded = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/lines`))
        .send({ sourceOrderLineId: po.lines[0].id, quantity: 30 })
        .expect(201);
      expect(readded.body.productId).toBe(productId);
      expect(Number(readded.body.quantity)).toBe(30);

      // Quantity may only be reduced within remaining, never increased past it.
      const afterAdd = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${contract.body.id}`)).expect(200);
      const newLine = afterAdd.body.lines.find((l: any) => l.id === readded.body.id);
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}/lines/${newLine.id}`))
        .send({ expectedVersion: newLine.version, quantity: 100 })
        .expect(400);
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}/lines/${newLine.id}`))
        .send({ expectedVersion: newLine.version, quantity: 20 })
        .expect(200);
    });

    it('replaces every line when the source purchase order selection changes, and tracks linesDirty', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'SWITCH' });
      const poA = await createConfirmedPO(supplier.id, 10, 12);
      const poB = await createConfirmedPO(supplier.id, 40, 7);
      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: poA.id, number: `C-SWITCH-${run}` })
        .expect(201);
      expect(contract.body.linesDirty).toBe(false);

      const lineId = contract.body.lines[0].id;
      const dirtied = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}/lines/${lineId}`))
        .send({ expectedVersion: contract.body.lines[0].version, discountPercent: 5 })
        .expect(200);
      void dirtied;
      const afterEdit = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${contract.body.id}`)).expect(200);
      expect(afterEdit.body.linesDirty).toBe(true);

      const switched = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contract.body.id}/source-purchase-order`))
        .send({ purchaseOrderId: poB.id, expectedVersion: afterEdit.body.version })
        .expect(201);
      expect(switched.body.sourcePurchaseOrderId).toBe(poB.id);
      expect(switched.body.linesDirty).toBe(false);
      expect(switched.body.lines).toHaveLength(1);
      expect(switched.body.lines[0].sourceOrderLineId).toBe(poB.lines[0].id);
      expect(Number(switched.body.lines[0].quantity)).toBe(40);
      expect(Number(switched.body.lines[0].unitPrice)).toBe(7);
    });

    it('flags a tax mismatch and records it in the audit trail when the counterparty\'s tax status changes after contract creation', async () => {
      const supplier = await createApprovedSupplier({ vatPayer: true, suffix: 'MISMATCH' });
      const po = await createConfirmedPO(supplier.id, 10, 100);
      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/from-purchase-order`))
        .send({ purchaseOrderId: po.id, number: `C-MISMATCH-${run}` })
        .expect(201);
      expect(contract.body.lines[0].taxMismatch).toBe(false);
      const originalTaxAmount = Number(contract.body.lines[0].taxAmount);
      expect(originalTaxAmount).toBeGreaterThan(0); // 18% VAT_STANDARD on an active VAT payer

      // The supplier stops being a VAT payer -> the line's live-resolved
      // category flips to VAT_EXEMPT (0%), diverging from the PO's own
      // 18% snapshot.
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/counterparties/${supplier.id}`))
        .send({ expectedVersion: supplier.version, vatPayer: false })
        .expect(200);

      // Any tax-point-relevant contract update re-triggers recalculation.
      const recalced = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contract.body.id}`))
        .send({ expectedVersion: contract.body.version, priceIncludesTax: false })
        .expect(200);
      const line = recalced.body.lines[0];
      expect(line.taxMismatch).toBe(true);
      expect(Number(line.taxAmount)).toBe(0);

      const events = await auth1(request(app.getHttpServer()).get(`/audit-events?entityType=CounterpartyContract&entityId=${contract.body.id}`)).expect(200);
      const items = events.body.items ?? events.body;
      expect(items.some((e: any) => e.eventType === 'COUNTERPARTY_CONTRACT_LINE_TAX_MISMATCH')).toBe(true);
    });
  });
});
