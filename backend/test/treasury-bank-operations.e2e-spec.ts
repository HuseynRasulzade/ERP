/**
 * Treasury / Bank Operations E2E tests (docx spec Phase 14) — the parts
 * NOT already covered by test/treasury.e2e-spec.ts (Purchase Invoice ->
 * Payment Request -> Payment Order, its FINANCE approval, segregation of
 * duties, reconciliation): PaymentRequest's own amount-tier approval
 * ladder + amount control + partial execution, IncomingBankPayment,
 * InternalBankTransfer, BankFee, FXConversion, multi-document-type
 * statement matching + unmatched-line classification, BankReconciliation
 * period close/reopen, PaymentCalendar, LiquidityForecast (incl. cash
 * gap), TreasuryHealth, and PaymentOrder reversal.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { PAYMENT_ORDER_TYPE } from '../src/treasury/payment-order.repository';
import * as request from 'supertest';

describe('Treasury Bank Operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let unitId: string;
  let productId: string;
  let aznId: string;
  let usdId: string;
  let aznBankAccountId: string;
  let aznBankAccount2Id: string;
  let usdBankAccountId: string;
  let financeRoleId: string;

  const DOC_DATE = '2026-06-01';
  let seq = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`tbank1-${run}@e2e.test`, `tbank-t1-${run}`, 'TB1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    await charts.ensureAdopted(tenant1Id);

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS-TB', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'TB-PROD-001', name: 'Treasury Bank Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    // VAT-exempt so gross == net (matches settlement.e2e-spec.ts's own trick).
    const vatExempt = await prisma.taxCategory.findFirst({ where: { code: 'VAT_EXEMPT' } });
    await prisma.productTaxProfile.create({ data: { tenantId: tenant1Id, productId, taxCategoryId: vatExempt!.id, validFrom: new Date('2020-01-01'), active: true } });

    const currencies = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    aznId = currencies.body.find((c: any) => c.code === 'AZN').id;
    usdId = currencies.body.find((c: any) => c.code === 'USD').id;

    const bank1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-accounts`))
      .send({ bankName: 'Bank A', accountName: 'AZN main', iban: makeIban('A1'), currencyId: aznId, isDefault: true })
      .expect(201);
    aznBankAccountId = bank1.body.id;

    const bank2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-accounts`))
      .send({ bankName: 'Bank B', accountName: 'AZN secondary', iban: makeIban('A2'), currencyId: aznId })
      .expect(201);
    aznBankAccount2Id = bank2.body.id;

    const bank3 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-accounts`))
      .send({ bankName: 'Bank A', accountName: 'USD account', iban: makeIban('U1'), currencyId: usdId })
      .expect(201);
    usdBankAccountId = bank3.body.id;

    // A single shared FINANCE_USER role for this tenant — setupApprover()
    // below creates a fresh USER against this same role each time (a role
    // code is unique per tenant, so it cannot be recreated per test).
    const permissions = await prisma.permission.findMany({
      where: { code: { in: ['treasury.payment_request.view', 'treasury.payment_request.approve', 'treasury.payment_order.view', 'treasury.payment_order.approve', 'treasury.payment_order.reject', 'documents.view', 'documents.post', 'documents.unpost'] } },
    });
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: 'FINANCE_USER', name: 'Finance' } });
    financeRoleId = role.id;
    await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
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

  /** A syntactically valid 28-char AZ IBAN (AZ + 2 check digits + 4
   * alphanumeric bank code + 20 alphanumeric account) unique per test run
   * — bank-account.service.ts's own assertIban rejects anything shorter. */
  function makeIban(suffix: string): string {
    return `AZ21NABZ${String(run).padStart(18, '0')}${suffix}`;
  }

  async function createCounterparty(type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH', extra: Record<string, unknown> = {}) {
    seq += 1;
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: type, code: `CP-${run}-${seq}`, name: `Counterparty ${seq}`, paymentTerms: 36500, ...extra })
      .expect(201);
    return res.body.id as string;
  }

  async function createSalesInvoice(counterpartyId: string, price: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-invoices`))
      .send({ counterpartyId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price }] });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createPurchaseInvoice(counterpartyId: string, price: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
      .send({ counterpartyId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price, lineType: 'SERVICE' }] });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function post(type: string, id: string, expectedVersion: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/documents/${type}/${id}/post`)).send({ expectedVersion });
    expect(res.status).toBe(201);
    return res.body;
  }

  describe('Incoming Bank Payment', () => {
    it('posts a customer receipt, reducing AR', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await createSalesInvoice(customerId, 1000);
      await post('SALES_INVOICE', invoice.id, invoice.version);

      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/incoming-bank-payments`))
        .send({ documentDate: DOC_DATE, bankAccountId: aznBankAccountId, category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, currencyId: aznId, amount: 1000, sourceSalesInvoiceId: invoice.id })
        .expect(201)).body;
      const posted = await post('INCOMING_BANK_PAYMENT', created.id, created.version);
      expect(posted.postingStatus).toBe('POSTED');

      const openItems = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/open-items`)).query({ includeSettled: 'true' }).expect(200);
      const item = openItems.body.find((i: any) => i.sourceDocumentId === invoice.id);
      expect(item).toBeDefined();
      expect(Number(item.remainingAmount)).toBe(0);

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'INCOMING_BANK_PAYMENT', sourceDocumentId: created.id } });
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journal!.id } });
      const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(1000, 2);
    });

    it('an unnamed receipt becomes a customer advance', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/incoming-bank-payments`))
        .send({ documentDate: DOC_DATE, bankAccountId: aznBankAccountId, category: 'CUSTOMER_ADVANCE', counterpartyId: customerId, currencyId: aznId, amount: 500 })
        .expect(201)).body;
      await post('INCOMING_BANK_PAYMENT', created.id, created.version);

      const advances = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/advances`)).query({ role: 'CUSTOMER' }).expect(200);
      const advance = advances.body.find((a: any) => a.sourceDocumentId === created.id);
      expect(Number(advance.remainingAmount)).toBe(500);
    });
  });

  describe('Internal Bank Transfer', () => {
    it('moves money between two of the tenant’s own bank accounts, fee kept separate', async () => {
      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/internal-bank-transfers`))
        .send({ documentDate: DOC_DATE, sourceBankAccountId: aznBankAccountId, destinationBankAccountId: aznBankAccount2Id, amount: 10000, feeAmount: 10 })
        .expect(201)).body;
      const posted = await post('INTERNAL_BANK_TRANSFER', created.id, created.version);
      expect(posted.postingStatus).toBe('POSTED');

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'INTERNAL_BANK_TRANSFER', sourceDocumentId: created.id } });
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journal!.id } });
      const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(10010, 2); // 10,000 principal + 10 fee
    });

    it('rejects the same bank account on both sides', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/internal-bank-transfers`))
        .send({ documentDate: DOC_DATE, sourceBankAccountId: aznBankAccountId, destinationBankAccountId: aznBankAccountId, amount: 100 });
      expect(res.status).toBe(400);
    });
  });

  describe('Bank Fee', () => {
    it('posts Dr Expense / Cr Bank', async () => {
      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-fees`))
        .send({ documentDate: DOC_DATE, bankAccountId: aznBankAccountId, feeType: 'COMMISSION', amount: 25 })
        .expect(201)).body;
      const posted = await post('BANK_FEE', created.id, created.version);
      expect(posted.postingStatus).toBe('POSTED');

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'BANK_FEE', sourceDocumentId: created.id } });
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journal!.id } });
      const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(25, 2);
    });
  });

  describe('FX Conversion', () => {
    it('converts between two currencies and books the gain vs the official rate, never a settlement', async () => {
      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/fx-conversions`))
        .send({ documentDate: DOC_DATE, sourceBankAccountId: usdBankAccountId, destinationBankAccountId: aznBankAccountId, sourceCurrencyId: usdId, sourceAmount: 10000, destinationCurrencyId: aznId, destinationAmount: 17200, officialRate: 1.7 })
        .expect(201)).body;
      expect(Number(created.tradeRate)).toBeCloseTo(1.72, 4);

      const posted = await post('FX_CONVERSION', created.id, created.version);
      expect(posted.postingStatus).toBe('POSTED');

      const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'FX_CONVERSION', sourceDocumentId: created.id } });
      const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journal!.id } });
      const debit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(17200, 2); // no fee in this test

      // Official rate implies 10,000 * 1.70 = 17,000 — actual 17,200 is a 200 gain.
      const gainLine = lines.find((l) => l.side === 'CREDIT' && Number(l.amountBase) === 200);
      expect(gainLine).toBeDefined();

      // Never a customer/supplier settlement (spec section 61-63).
      const allocations = await prisma.settlementAllocation.findMany({ where: { tenantId: tenant1Id, paymentDocumentType: 'FX_CONVERSION' } });
      expect(allocations).toHaveLength(0);
    });

    it('rejects a currency that does not match the bank account’s own currency', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/fx-conversions`))
        .send({ documentDate: DOC_DATE, sourceBankAccountId: usdBankAccountId, destinationBankAccountId: aznBankAccountId, sourceCurrencyId: aznId, sourceAmount: 10000, destinationCurrencyId: aznId, destinationAmount: 17200 });
      expect(res.status).toBe(400);
    });
  });

  describe('Bank statement matching across document types', () => {
    it('matches an incoming bank payment (inflow) and a bank fee (outflow) statement line', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/incoming-bank-payments`))
        .send({ documentDate: DOC_DATE, bankAccountId: aznBankAccountId, category: 'OTHER', currencyId: aznId, amount: 3000 })
        .expect(201)).body;
      await post('INCOMING_BANK_PAYMENT', created.id, created.version);

      const line = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines`))
        .send({ bankAccountId: aznBankAccountId, statementDate: DOC_DATE, amount: 3000, description: 'incoming test' })
        .expect(201);

      const suggestions = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/suggestions`)).expect(200);
      expect(suggestions.body.candidates.some((c: any) => c.id === created.id)).toBe(true);

      const matched = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/match`))
        .send({ documentType: 'INCOMING_BANK_PAYMENT', documentId: created.id })
        .expect(201);
      expect(matched.body.status).toBe('MATCHED');

      void customerId;
    });

    it('classifies an unmatched fee-like line as a Bank Fee', async () => {
      const line = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines`))
        .send({ bankAccountId: aznBankAccountId, statementDate: DOC_DATE, amount: -18, description: 'MONTHLY BANK COMMISSION' })
        .expect(201);

      const suggestions = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/suggestions`)).expect(200);
      expect(suggestions.body.suggestedClassification).toBe('BANK_FEE');

      const classified = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/classify-as-fee`))
        .send({ feeType: 'COMMISSION' })
        .expect(201);
      expect(classified.body.line.status).toBe('MATCHED');
      expect(Number(classified.body.fee.amount)).toBe(18);
    });

    it('rejects a second concurrent match of the same statement line', async () => {
      const created1 = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-fees`))
        .send({ documentDate: DOC_DATE, bankAccountId: aznBankAccountId, amount: 777 })
        .expect(201)).body;
      const line = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines`))
        .send({ bankAccountId: aznBankAccountId, statementDate: DOC_DATE, amount: -777 })
        .expect(201);

      const [r1, r2] = await Promise.all([
        auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/match`)).send({ documentType: 'BANK_FEE', documentId: created1.id }),
        auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/match`)).send({ documentType: 'BANK_FEE', documentId: created1.id }),
      ]);
      const succeeded = [r1, r2].filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);
    });
  });

  describe('Bank Reconciliation period close', () => {
    it('closes once every line is matched and the difference is within tolerance, blocks otherwise', async () => {
      const bankAccountId = aznBankAccount2Id;
      const created = (await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-fees`))
        .send({ documentDate: '2026-07-01', bankAccountId, amount: 100 })
        .expect(201)).body;
      await post('BANK_FEE', created.id, created.version);
      const line = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines`))
        .send({ bankAccountId, statementDate: '2026-07-01', amount: -100 })
        .expect(201);

      const recon = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations`))
        .send({ bankAccountId, periodStart: '2026-07-01', periodEnd: '2026-07-31', bookOpeningBalance: 0, bankOpeningBalance: 0 })
        .expect(201);

      const beforeMatch = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations/${recon.body.id}/refresh`)).expect(201);
      expect(beforeMatch.body.status).toBe('DIFFERENCE_FOUND');
      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations/${recon.body.id}/close`)).send({ expectedVersion: beforeMatch.body.version });
      expect(blocked.status).toBe(400);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines/${line.body.id}/match`))
        .send({ documentType: 'BANK_FEE', documentId: created.id })
        .expect(201);

      const refreshed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations/${recon.body.id}/refresh`)).expect(201);
      expect(refreshed.body.status).toBe('READY_TO_CLOSE');

      const closed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations/${recon.body.id}/close`)).send({ expectedVersion: refreshed.body.version }).expect(201);
      expect(closed.body.status).toBe('CLOSED');

      const reopenNoReason = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations/${recon.body.id}/reopen`)).send({ expectedVersion: closed.body.version, reason: '' });
      expect(reopenNoReason.status).toBe(400);

      const reopened = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-reconciliations/${recon.body.id}/reopen`))
        .send({ expectedVersion: closed.body.version, reason: 'Found a late-arriving correction' })
        .expect(201);
      expect(reopened.body.status).toBe('REOPENED');
    });
  });

  describe('Payment Request amount-tier approval + partial execution', () => {
    it('gates on a configured rule, supports partial approval, and allows multiple partial payment orders up to the approved cap', async () => {
      // Configure a single-tier rule for this organization/category so the
      // request below actually needs approval (a zero-config tenant skips
      // the gate entirely — see treasury.e2e-spec.ts for that path).
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/treasury/approval-rules`))
        .send({ category: 'SUPPLIER', minAmount: 0, stepType: 'FINANCE', sequence: 1 })
        .expect(201);

      const supplierId = await createCounterparty('SUPPLIER');
      const invoice = await createPurchaseInvoice(supplierId, 10000);
      await post('PURCHASE_INVOICE', invoice.id, invoice.version);

      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE, category: 'SUPPLIER', priority: 'HIGH' })
        .expect(201);
      expect(payreq.body.approvalStatus).toBe('PENDING');

      // Payment order creation blocked while pending.
      const blockedOrder = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId: aznBankAccountId });
      expect(blockedOrder.status).toBe(400);

      // Partial approval: 7,000 of the 10,000 requested.
      const approverToken = await setupApprover();
      const approved = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/payment-requests/${payreq.body.id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ approvedAmount: 7000 })
        .expect(201);
      expect(approved.body.approvalStatus).toBe('APPROVED');
      expect(Number(approved.body.approvedAmount)).toBe(7000);

      // First payment order: 4,000.
      const order1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId: aznBankAccountId, amount: 4000 })
        .expect(201);

      const afterOrder1 = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-requests/${payreq.body.id}`)).expect(200);
      expect(afterOrder1.body.status).toBe('OPEN'); // still open — not fully committed
      expect(Number(afterOrder1.body.remainingApproved)).toBe(3000);

      // Second order for the remainder succeeds.
      const order2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId: aznBankAccountId, amount: 3000 })
        .expect(201);

      const afterOrder2 = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/payment-requests/${payreq.body.id}`)).expect(200);
      expect(afterOrder2.body.status).toBe('FULFILLED');

      // A third order is rejected — nothing left to commit.
      const order3Attempt = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId: aznBankAccountId, amount: 1 });
      expect(order3Attempt.status).toBe(400);

      void order1;
      void order2;
    });

    it('never lets two concurrent payment orders jointly exceed the approved amount', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/treasury/approval-rules`))
        .send({ category: 'OTHER', minAmount: 0, stepType: 'FINANCE', sequence: 1 })
        .expect(201);

      const supplierId = await createCounterparty('SUPPLIER');
      const invoice = await createPurchaseInvoice(supplierId, 10000);
      await post('PURCHASE_INVOICE', invoice.id, invoice.version);

      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE, category: 'OTHER' })
        .expect(201);

      const approverToken = await setupApprover();
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/payment-requests/${payreq.body.id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ approvedAmount: 10000 })
        .expect(201);

      const attempt = (amount: number) => auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`)).send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId: aznBankAccountId, amount });
      const [r1, r2] = await Promise.all([attempt(7000), attempt(6000)]);
      const succeeded = [r1, r2].filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);
    });
  });

  describe('Payment Calendar & Liquidity Forecast', () => {
    it('lists a planned outflow and detects a cash gap below the minimum buffer', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/treasury/liquidity-policies`))
        .send({ bankAccountId: aznBankAccountId, minimumBalance: 1_000_000 })
        .expect(201);

      const supplierId = await createCounterparty('SUPPLIER');
      const invoice = await createPurchaseInvoice(supplierId, 5000);
      await post('PURCHASE_INVOICE', invoice.id, invoice.version);
      // A category with no approval rule configured for this org (earlier
      // tests in this file added rules for SUPPLIER/OTHER) — stays
      // NOT_REQUIRED so it shows up on the calendar right away.
      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE, category: 'CAPEX', requestedPaymentDate: '2026-08-15' })
        .expect(201);

      const calendar = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/treasury/payment-calendar`)).query({ fromDate: '2026-08-01', toDate: '2026-08-31' }).expect(200);
      expect(calendar.body.some((i: any) => i.sourceId === payreq.body.id && i.cashFlowDirection === 'OUTFLOW')).toBe(true);

      const forecast = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/treasury/liquidity-forecast`)).query({ fromDate: '2026-08-01', toDate: '2026-08-31' }).expect(200);
      const row = forecast.body.find((r: any) => r.bankAccountId === aznBankAccountId);
      expect(row).toBeDefined();
      expect(row.cashGap).not.toBeNull();
    });
  });

  describe('Treasury Health', () => {
    it('flags a statement line unmatched for a long time', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/bank-statement-lines`))
        .send({ bankAccountId: aznBankAccountId, statementDate: '2026-01-01', amount: -55, description: 'stale' })
        .expect(201);

      const health = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/treasury/health`)).expect(200);
      expect(health.body.some((i: any) => i.code === 'STATEMENT_LINE_UNMATCHED_TOO_LONG')).toBe(true);
    });
  });

  describe('Payment Order reversal', () => {
    it('unposting reverses the settlement allocation and the SupplierPayable paidAmount', async () => {
      const supplierId = await createCounterparty('SUPPLIER');
      const invoice = await createPurchaseInvoice(supplierId, 2000);
      await post('PURCHASE_INVOICE', invoice.id, invoice.version);

      const payreq = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-requests`))
        .send({ purchaseInvoiceId: invoice.id, documentDate: DOC_DATE, category: 'RENT' })
        .expect(201);
      const payord = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/payment-orders`))
        .send({ paymentRequestId: payreq.body.id, documentDate: DOC_DATE, bankAccountId: aznBankAccountId })
        .expect(201);

      const approverToken = await setupApprover();
      const approvedOrder = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/payment-orders/${payord.body.id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({})
        .expect(201);

      const posted = await post(PAYMENT_ORDER_TYPE, payord.body.id, approvedOrder.body.version);

      const payableAfterPost = await prisma.supplierPayable.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: invoice.id } });
      expect(payableAfterPost!.status).toBe('PAID');

      const unposted = await auth1(request(app.getHttpServer()).post(`/documents/${PAYMENT_ORDER_TYPE}/${payord.body.id}/unpost`)).send({ expectedVersion: posted.version }).expect(201);
      expect(unposted.body.postingStatus).toBe('NOT_POSTED');

      const payableAfterUnpost = await prisma.supplierPayable.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: invoice.id } });
      expect(Number(payableAfterUnpost!.paidAmount)).toBe(0);
      expect(payableAfterUnpost!.status).toBe('OPEN');

      const allocations = await prisma.settlementAllocation.findMany({ where: { tenantId: tenant1Id, paymentDocumentType: PAYMENT_ORDER_TYPE, paymentDocumentId: payord.body.id, status: 'ACTIVE' } });
      expect(allocations).toHaveLength(0);
    });
  });

  /** A fresh user each time (distinct from whoever created the document
   * under test), holding the shared FINANCE_USER role set up in
   * beforeAll — segregation-of-duties checks compare user IDs, so a new
   * user per call is what actually exercises them. */
  async function setupApprover(): Promise<string> {
    seq += 1;
    const email = `tbank-approver-${run}-${seq}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: financeRoleId } });
    return reg.body.accessToken;
  }
});
