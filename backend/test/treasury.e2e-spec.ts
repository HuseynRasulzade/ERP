/**
 * Treasury / payment chain E2E tests (docs/APPROVALS.md).
 *
 * Covers: Purchase Invoice -> Payment Request -> Payment Order, FINANCE
 * approval required to post, segregation of duties (the approver cannot
 * also be the one who posts/executes the payment), posting clears the
 * SupplierPayable and reduces its remaining balance, and reconciliation
 * against a bank statement amount reports the difference.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { GOODS_RECEIPT_TYPE } from '../src/purchase-execution/goods-receipt.repository';
import { PURCHASE_ORDER_TYPE } from '../src/procurement/purchase-order.repository';
import { PURCHASE_INVOICE_TYPE } from '../src/purchase-execution/purchase-invoice.repository';
import { PAYMENT_ORDER_TYPE } from '../src/treasury/payment-order.repository';
import * as request from 'supertest';

describe('Treasury (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let approverToken: string;
  let tenant1Id: string;
  let org1Id: string;
  let productId: string;
  let unitId: string;
  let supplierId: string;
  let warehouseId: string;
  let bankAccountId: string;

  const DOC_DATE = '2026-09-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const localization = app.get(AzTaxLocalizationService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`treas1-${run}@e2e.test`, `treas-t1-${run}`, 'TR1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    approverToken = await setupApprover(tenant1Id, org1Id);

    await charts.ensureAdopted(tenant1Id);
    await localization.ensureSeeded();

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS-TR', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'TR-PROD-001', name: 'Treasury Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: 'SUP-TR', name: 'Treasury Supply Co', paymentTerms: 30 })
      .expect(201);
    supplierId = supplier.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-TR', name: 'Treasury Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;

    const currencies = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    const azn = currencies.body.find((c: any) => c.code === 'AZN');
    const bank = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-accounts`))
      .send({ bankName: 'Test Bank', accountName: 'Main AZN account', iban: 'AZ21NABZ00000000137010001944', currencyId: azn.id, isDefault: true })
      .expect(201);
    bankAccountId = bank.body.id;
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
      .send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'AZN' })
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

  /** A second tenant1 user holding every approval-chain role (including
   * FINANCE_USER) — distinct from token1, the creator/executor of every
   * fixture document below. See procurement.e2e-spec.ts's identical
   * helper for the full rationale. */
  async function setupApprover(tenantId: string, organizationId: string): Promise<string> {
    const email = `treas-approver-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId, accessLevel: 'FULL' } });

    const permissions = await prisma.permission.findMany({
      where: {
        code: {
          in: [
            'purchase.order.view', 'purchase.order.approve', 'purchase.order.reject',
            'documents.view', 'documents.post', 'documents.unpost', 'documents.cancel',
            'purchase_execution.view', 'purchase_execution.create', 'purchase_execution.price_view',
            'purchase_execution.invoice.approve', 'purchase_execution.invoice.reject',
            'treasury.payment_order.view', 'treasury.payment_order.approve', 'treasury.payment_order.reject', 'treasury.payment_order.reconcile',
          ],
        },
      },
    });
    for (const roleCode of ['PROCUREMENT_OFFICER', 'DEPARTMENT_HEAD', 'DIRECTOR', 'FINANCE_USER', 'ACCOUNTING_USER']) {
      const role = await prisma.role.create({ data: { tenantId, code: roleCode, name: roleCode } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
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

  /** Builds a fully-posted Purchase Invoice (PO -> GRN -> Invoice, each
   * approved/posted along the way) so its SupplierPayable is real and
   * OPEN — the fixture every test in this file starts from. */
  async function postedInvoice(quantity: number, price: number) {
    const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
      .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    await fullyApprovePurchaseOrder(po.body.id);
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/confirm`)).send({ expectedVersion: po.body.version }).expect(201);

    const grCreated = await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_ORDER_TYPE}/${po.body.id}/create-based-on/${GOODS_RECEIPT_TYPE}`)).expect(201);
    await fullyApproveGoodsReceipt(grCreated.body.id);
    const gr = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/goods-receipts/${grCreated.body.id}`)).expect(200);
    await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);

    const invCreated = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${gr.body.id}/create-based-on/${PURCHASE_INVOICE_TYPE}`)).expect(201);
    await fullyApprovePurchaseInvoice(invCreated.body.id);
    const inv = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${invCreated.body.id}`)).expect(200);
    await auth1(request(app.getHttpServer()).post(`/documents/${PURCHASE_INVOICE_TYPE}/${inv.body.id}/post`)).send({ expectedVersion: inv.body.version }).expect(201);

    return (await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/purchase-invoices/${inv.body.id}`))).body;
  }

  describe('Purchase Invoice -> Payment Request -> Payment Order', () => {
    it('creates a payment request from an open payable, then a payment order requiring FINANCE approval before it can post', async () => {
      const invoice = await postedInvoice(10, 25);
      // `grandTotal` on the header is only the draft PREVIEW — posting
      // recomputes real tax into `amountDue` without rewriting it (see
      // purchase-invoice.posting-handler.ts) — that's the authoritative
      // gross total SupplierPayable/PaymentRequest are built from.
      const grandTotal = Number(invoice.amountDue);
      expect(grandTotal).toBeGreaterThan(0);

      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE })
        .expect(201);
      expect(payreq.body.number).toMatch(/^PAYREQ-2026-\d+$/);
      expect(Number(payreq.body.amount)).toBeCloseTo(grandTotal, 2);

      const payord = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId })
        .expect(201);
      expect(payord.body.number).toMatch(/^PAYORD-2026-\d+$/);
      expect(payord.body.approvalStatus).toBe('PENDING');

      // The source payment request is now FULFILLED, can't be reused.
      const reqAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-requests/${payreq.body.id}`)).expect(200);
      expect(reqAfter.body.status).toBe('FULFILLED');

      // Blocked until FINANCE approves.
      await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: payord.body.version })
        .expect(400);

      // Self-approval blocked (token1 created it).
      const selfApprove = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)).send({});
      expect(selfApprove.status).toBe(400);

      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)).send({}).expect(201);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);
      expect(approved.body.approvalStatus).toBe('APPROVED');

      // Executor (token1, the creator — distinct from the FINANCE approver) posts it: the "Bank Ödənişi" event.
      const posted = await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');

      const final = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);
      expect(final.body.bankPaymentStatus).toBe('CLEARED');

      // SupplierPayable is now fully paid.
      const payable = await prisma.supplierPayable.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: invoice.id } });
      expect(payable).not.toBeNull();
      expect(Number(payable!.paidAmount)).toBeCloseTo(grandTotal, 2);
      expect(payable!.status).toBe('PAID');

      // Balanced GL entry: Dr Supplier Payable / Cr Bank.
      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: PAYMENT_ORDER_TYPE, sourceDocumentId: payord.body.id } });
      expect(journal).not.toBeNull();
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journal!.id } });
      const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(grandTotal, 2);
    });

    it('rejects the executor posting a payment order they themselves approved (segregation of duties)', async () => {
      const invoice = await postedInvoice(4, 25);
      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE })
        .expect(201);
      const payord = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId })
        .expect(201);

      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)).send({}).expect(201);

      // The SAME user (approverToken) who approved now tries to post/execute it — blocked.
      const blocked = await approverAuth(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: payord.body.version })
        .expect(400);
      expect(blocked.body.message).toMatch(/executor/i);

      // A different executor (token1) succeeds.
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
    });

    it('reconciles a posted payment order against a bank statement amount and reports the difference', async () => {
      const invoice = await postedInvoice(5, 25);
      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE })
        .expect(201);
      const payord = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId })
        .expect(201);
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)).send({}).expect(201);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);

      // Reconciliation before posting is rejected.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/reconcile`))
        .send({ expectedVersion: approved.body.version, bankStatementAmount: Number(approved.body.amount) })
        .expect(400);

      // The generic /documents/.../post response is a minimal
      // {documentId, postingStatus, movementCount, version} shape (not the
      // full document) — re-fetch for the fields reconcile() needs.
      await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
      const posted = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);
      expect(posted.body.postingStatus).toBe('POSTED');

      const bankAmount = Number(posted.body.amount) - 0.5; // bank statement shows slightly less (fees, etc.)
      const reconciled = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/reconcile`))
        .send({ expectedVersion: posted.body.version, bankStatementAmount: bankAmount, bankReference: 'STMT-0001' })
        .expect(201);
      expect(reconciled.body.reconciled).toBe(true);
      expect(Number(reconciled.body.reconciliationDifference)).toBeCloseTo(-0.5, 2);
      expect(reconciled.body.bankReference).toBe('STMT-0001');
    });
  });

  describe('Counterparty bank-account-change control', () => {
    it('refuses to create a payment order against an unapproved counterparty bank account, and refuses to post one that was approved-then-changed', async () => {
      const invoice = await postedInvoice(6, 25);
      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE })
        .expect(201);

      const cpAccount = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplierId}/bank-accounts`))
        .send({ bankName: "Supplier's Bank", accountNumber: `SUP-ACC-${run}` })
        .expect(201);
      expect(cpAccount.body.status).toBe('PENDING');

      // Blocked at creation while PENDING.
      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId, counterpartyBankAccountId: cpAccount.body.id });
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(/not APPROVED/i);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplierId}/bank-accounts/${cpAccount.body.id}/approve`))
        .send({ expectedVersion: cpAccount.body.version })
        .expect(201);

      const payord = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId, counterpartyBankAccountId: cpAccount.body.id })
        .expect(201);

      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)).send({}).expect(201);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);

      // The counterparty's bank account is changed AFTER the payment order was created/approved — reopens PENDING.
      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/counterparties/${supplierId}/bank-accounts/${cpAccount.body.id}`))
        .send({ iban: 'AZ00NABZ00000000000000005555', expectedVersion: cpAccount.body.version + 1 })
        .expect(200);

      // Posting is re-checked at posting time, not just at creation — still blocked.
      const repostBlocked = await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: approved.body.version });
      expect(repostBlocked.status).toBe(400);
      expect(repostBlocked.body.message).toMatch(/counterparty bank account/i);

      // Re-approving the account allows posting to proceed.
      const reApproved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${supplierId}`)).expect(200);
      const reApprovedAccount = reApproved.body.bankAccounts.find((a: any) => a.id === cpAccount.body.id);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${supplierId}/bank-accounts/${cpAccount.body.id}/approve`))
        .send({ expectedVersion: reApprovedAccount.version })
        .expect(201);

      const posted = await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');
    });
  });

  describe('Accounting entries viewer ("Mühasibat yazılışlarına bax")', () => {
    it('GET .../accounting/journal-entries?sourceDocumentType=&sourceDocumentId= returns the balanced entry behind a posted payment order', async () => {
      const invoice = await postedInvoice(3, 25);
      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE })
        .expect(201);
      const payord = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId })
        .expect(201);
      await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)).send({}).expect(201);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-orders/${payord.body.id}`)).expect(200);
      await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/post`)).send({ expectedVersion: approved.body.version }).expect(201);

      const entries = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=${PAYMENT_ORDER_TYPE}&sourceDocumentId=${payord.body.id}`),
      ).expect(200);
      expect(entries.body).toHaveLength(1);
      const [entry] = entries.body;
      expect(entry.journalEntry.sourceDocumentType).toBe(PAYMENT_ORDER_TYPE);
      expect(entry.journalEntry.sourceDocumentId).toBe(payord.body.id);
      const debit = entry.lines.filter((l: any) => l.side === 'DEBIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
      const credit = entry.lines.filter((l: any) => l.side === 'CREDIT').reduce((s: number, l: any) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);

      // A different, unrelated document type/id returns nothing.
      const empty = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=${PAYMENT_ORDER_TYPE}&sourceDocumentId=nonexistent`),
      ).expect(200);
      expect(empty.body).toHaveLength(0);
    });
  });
});
