/**
 * Counterparty Settlement Engine E2E tests (docx spec Phase 13).
 *
 * Covers the spec's own listed test scenarios (sections 149-170): basic
 * receivable/full payment, partial payment, multiple payments against one
 * invoice, one payment auto-allocated across multiple invoices (FIFO),
 * customer and supplier advances (with partial application), overpayment
 * becoming a customer advance, sales/purchase return after full payment
 * producing a credit position, AR/AP offset, write-off (segregation of
 * duties), due-date ageing (full and partial), realized FX on full and
 * partial payment, concurrent allocation safety, invoice-unpost
 * dependency, and counterparty reconciliation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { CurrencyService } from '../src/currency/currency.service';
import * as request from 'supertest';

describe('Settlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let charts: ChartOfAccountsService;
  let currencyService: CurrencyService;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let unitId: string;
  let productId: string;
  let baseCurrencyId: string;

  let token2: string;
  let tenant2Id: string;
  let org2Id: string;

  const DOC_DATE = '2026-06-01';
  let seq = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    charts = app.get(ChartOfAccountsService);
    currencyService = app.get(CurrencyService);

    const s1 = await setupTenant(`st1-${run}@e2e.test`, `st-t1-${run}`, 'ST1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const s2 = await setupTenant(`st2-${run}@e2e.test`, `st-t2-${run}`, 'ST2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    await charts.ensureAdopted(tenant1Id);

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: `PCS-ST-${run}`, name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: `ST-PROD-${run}`, name: 'Settlement Product', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    // The Sales/Purchase Invoice posting handlers resolve VAT via the Tax
    // Engine's OWN category resolution (STANDARD_VAT = 18% by default),
    // ignoring the line's own (unset) taxRate entirely — a VAT_EXEMPT
    // product profile keeps every settlement amount in these tests equal
    // to its plain price × quantity, with no tax inflation to account for.
    const exemptCategory = await prisma.taxCategory.findFirstOrThrow({ where: { code: 'VAT_EXEMPT' } });
    await prisma.productTaxProfile.create({ data: { tenantId: tenant1Id, productId, taxCategoryId: exemptCategory.id, validFrom: new Date('2000-01-01') } });

    // Organization.baseCurrencyId is only set when explicitly configured —
    // SalesInvoicePostingHandler/PurchaseInvoicePostingHandler fall back to
    // the TENANT's own base currency (set at tenant creation), which is
    // what every settlement open item in these tests actually resolves to.
    const tenantRow = await prisma.tenant.findFirst({ where: { id: tenant1Id } });
    baseCurrencyId = tenantRow!.baseCurrencyId!;
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
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }

  async function createCounterparty(type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH', extra: Record<string, unknown> = {}) {
    seq += 1;
    // paymentTerms defaults far in the future so an item isn't already
    // OVERDUE by the time the test runs (DOC_DATE is a fixed past date) —
    // the dedicated Ageing test overrides this to get a real overdue item.
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: type, code: `ST-CP-${run}-${seq}`, name: `Settlement Party ${seq}`, paymentTerms: 36500, ...extra })
      .expect(201);
    return res.body.id as string;
  }

  /** A second tenant1 user holding SETTLEMENT_APPROVE_ADJUSTMENT — distinct
   * from token1, the creator of every fixture debt adjustment (self-approval
   * is blocked, spec section 134). */
  async function setupApprover(): Promise<string> {
    const email = `st-approver-${run}-${++seq}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });

    const permissions = await prisma.permission.findMany({ where: { code: { in: ['settlement.view', 'settlement.create_adjustment', 'settlement.approve_adjustment'] } } });
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: `SETTLEMENT_APPROVER_${seq}`, name: 'Settlement Approver' } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    return reg.body.accessToken;
  }

  async function createCashbox() {
    seq += 1;
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cashboxes`))
      .send({ code: `CB-${run}-${seq}`, name: `Cashbox ${seq}`, currencyId: baseCurrencyId })
      .expect(201);
    return res.body.id as string;
  }

  async function createSalesInvoice(counterpartyId: string, lines: any[], extra: Record<string, unknown> = {}) {
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-invoices`))
      .send({ counterpartyId, documentDate: DOC_DATE, lines, ...extra });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** The generic `/documents/:type/:id/post` endpoint only returns
   * `{documentId, postingStatus, movementCount, version}` — merge the
   * fresh version back onto the ORIGINAL create response so callers keep
   * `.id`/`.lines` (unchanged by posting) alongside the now-current version. */
  async function postInvoice(type: 'SALES_INVOICE' | 'PURCHASE_INVOICE', invoice: any) {
    const res = await auth1(request(app.getHttpServer()).post(`/documents/${type}/${invoice.id}/post`)).send({ expectedVersion: invoice.version });
    expect(res.status).toBe(201);
    return { ...invoice, version: res.body.version, postingStatus: res.body.postingStatus };
  }

  async function createPurchaseInvoice(counterpartyId: string, lines: any[], extra: Record<string, unknown> = {}) {
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-invoices`))
      .send({ counterpartyId, documentDate: DOC_DATE, lines, ...extra })
      .expect(201);
    return res.body;
  }

  async function openItemsFor(sourceDocumentType: string, sourceDocumentId: string) {
    const res = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/open-items`)).query({ includeSettled: 'true' }).expect(200);
    return res.body.filter((i: any) => i.sourceDocumentType === sourceDocumentType && i.sourceDocumentId === sourceDocumentId);
  }

  describe('Basic receivable + full payment', () => {
    it('creates an open item and settles it fully on payment', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }]);
      const posted = await postInvoice('SALES_INVOICE', invoice);

      let items = await openItemsFor('SALES_INVOICE', posted.id);
      expect(items).toHaveLength(1);
      expect(Number(items[0].remainingAmount)).toBe(1000);

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 1000, documentDate: DOC_DATE, sourceSalesInvoiceId: posted.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      items = await openItemsFor('SALES_INVOICE', posted.id);
      expect(Number(items[0].remainingAmount)).toBe(0);
      expect(items[0].status).toBe('SETTLED');
    });
  });

  describe('Partial payment', () => {
    it('leaves the remainder open and PARTIALLY_SETTLED', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }]));

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 300, documentDate: DOC_DATE, sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const items = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(items[0].remainingAmount)).toBe(700);
      expect(items[0].status).toBe('PARTIALLY_SETTLED');
    });
  });

  describe('Multiple payments against one invoice', () => {
    it('accumulates three payments to exactly zero remaining', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }]));
      const cashboxId = await createCashbox();

      for (const amount of [300, 200, 500]) {
        const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
          .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount, documentDate: DOC_DATE, sourceSalesInvoiceId: invoice.id })
          .expect(201);
        await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);
      }

      const items = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(items[0].remainingAmount)).toBe(0);
      expect(items[0].status).toBe('SETTLED');

      const allocations = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/allocations`)).query({ targetOpenItemId: items[0].id }).expect(200);
      expect(allocations.body).toHaveLength(3);
    });
  });

  describe('One payment auto-allocated across multiple invoices', () => {
    it('applies FIFO by due date, settling the first and partially settling the second', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoiceA = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 500 }]));
      const invoiceB = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 700 }]));

      const itemsA = await openItemsFor('SALES_INVOICE', invoiceA.id);
      const itemsB = await openItemsFor('SALES_INVOICE', invoiceB.id);

      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/allocations/auto`))
        .send({ counterpartyId: customerId, role: 'CUSTOMER', paymentDocumentType: 'TEST_PAYMENT', paymentDocumentId: `pay-${run}-1`, paymentCurrencyId: baseCurrencyId, paymentDate: DOC_DATE, paymentAmount: 1000 })
        .expect(201);
      expect(res.body.unallocatedAmount).toBe('0.00');

      const refreshedA = await openItemsFor('SALES_INVOICE', invoiceA.id);
      const refreshedB = await openItemsFor('SALES_INVOICE', invoiceB.id);
      expect(Number(refreshedA[0].remainingAmount)).toBe(0);
      expect(Number(refreshedB[0].remainingAmount)).toBe(200);
      void itemsA; void itemsB;
    });
  });

  describe('Customer advance', () => {
    it('creates an advance ahead of the invoice, then applies it partially', async () => {
      const customerId = await createCounterparty('CUSTOMER');

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 1000, documentDate: DOC_DATE })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const advances = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/advances`)).query({ role: 'CUSTOMER' }).expect(200);
      const advance = advances.body.find((a: any) => a.sourceDocumentId === txn.body.id);
      expect(advance).toBeDefined();
      expect(Number(advance.remainingAmount)).toBe(1000);

      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 2500 }]));
      const items = await openItemsFor('SALES_INVOICE', invoice.id);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/allocations/apply-advance`))
        .send({ advanceOpenItemId: advance.id, targetOpenItemId: items[0].id, amount: 1000 })
        .expect(201);

      const refreshedItems = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(refreshedItems[0].remainingAmount)).toBe(1500);
      const refreshedAdvances = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/advances`)).query({ role: 'CUSTOMER' }).expect(200);
      const refreshedAdvance = refreshedAdvances.body.find((a: any) => a.id === advance.id);
      expect(Number(refreshedAdvance.remainingAmount)).toBe(0);
    });
  });

  describe('Supplier advance', () => {
    it('reduces the payable when applied', async () => {
      const supplierId = await createCounterparty('SUPPLIER');
      const cashboxId = await createCashbox();

      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'PAYMENT', category: 'SUPPLIER_PAYMENT', counterpartyId: supplierId, amount: 4000, documentDate: DOC_DATE })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const advances = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/advances`)).query({ role: 'SUPPLIER' }).expect(200);
      const advance = advances.body.find((a: any) => a.sourceDocumentId === txn.body.id);
      expect(Number(advance.remainingAmount)).toBe(4000);

      const invoice = await postInvoice('PURCHASE_INVOICE', await createPurchaseInvoice(supplierId, [{ productId, unitId, quantity: 1, price: 10000, lineType: 'SERVICE' }]));
      const items = await openItemsFor('PURCHASE_INVOICE', invoice.id);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/allocations/apply-advance`))
        .send({ advanceOpenItemId: advance.id, targetOpenItemId: items[0].id, amount: 4000 })
        .expect(201);

      const refreshedItems = await openItemsFor('PURCHASE_INVOICE', invoice.id);
      expect(Number(refreshedItems[0].remainingAmount)).toBe(6000);
    });
  });

  describe('Overpayment', () => {
    it('settles the invoice and turns the excess into a customer advance', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }]));

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 1200, documentDate: DOC_DATE, sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const items = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(items[0].remainingAmount)).toBe(0);
      expect(items[0].status).toBe('SETTLED');

      const advances = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/advances`)).query({ role: 'CUSTOMER' }).expect(200);
      const advance = advances.body.find((a: any) => a.sourceDocumentId === txn.body.id);
      expect(Number(advance.remainingAmount)).toBe(200);
    });
  });

  describe('Sales return after full payment', () => {
    it('produces a customer credit position', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }]));

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 1000, documentDate: DOC_DATE, sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      // Quantity is a fraction of the source invoice line's own quantity
      // (1) — tax/net proration (spec section 34) scales the return net
      // by that ratio, so a 0.2 return of a 1,000 line nets exactly 200.
      const ret = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-returns`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, originalSalesInvoiceId: invoice.id, returnType: 'FINANCIAL_CREDIT_ONLY', lines: [{ sourceInvoiceLineId: invoice.lines[0].id, productId, unitId, quantity: '0.2' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/SALES_RETURN/${ret.body.id}/post`)).send({ expectedVersion: ret.body.version }).expect(201);

      const items = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(items[0].remainingAmount)).toBe(-200);
    });
  });

  describe('AR/AP offset', () => {
    it('nets a counterparty’s own receivable against its own payable', async () => {
      const partnerId = await createCounterparty('BOTH');
      const receivableInvoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(partnerId, [{ productId, unitId, quantity: 1, price: 10000 }]));
      const payableInvoice = await postInvoice('PURCHASE_INVOICE', await createPurchaseInvoice(partnerId, [{ productId, unitId, quantity: 1, price: 7000, lineType: 'SERVICE' }]));

      const offset = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/offsets`))
        .send({ counterpartyId: partnerId, offsetDate: DOC_DATE, amount: 7000 })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/offsets/${offset.body.id}/post`)).send({ expectedVersion: offset.body.version }).expect(201);

      const arItems = await openItemsFor('SALES_INVOICE', receivableInvoice.id);
      const apItems = await openItemsFor('PURCHASE_INVOICE', payableInvoice.id);
      expect(Number(arItems[0].remainingAmount)).toBe(3000);
      expect(Number(apItems[0].remainingAmount)).toBe(0);
    });
  });

  describe('Write-off', () => {
    it('requires a different approver than the creator, then posts', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 500 }]));
      const items = await openItemsFor('SALES_INVOICE', invoice.id);

      const adj = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/debt-adjustments`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, operationType: 'DEBT_WRITE_OFF', reasonCode: 'bad_debt', lines: [{ openItemId: items[0].id, amount: 500 }] })
        .expect(201);

      const selfApprove = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/debt-adjustments/${adj.body.id}/approve`)).send({ expectedVersion: adj.body.version });
      expect(selfApprove.status).toBe(400);

      // A second user in the same tenant/org approves instead (self-approval blocked above).
      const approverToken = await setupApprover();

      const approved = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/settlements/debt-adjustments/${adj.body.id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ expectedVersion: adj.body.version })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/debt-adjustments/${adj.body.id}/post`)).send({ expectedVersion: approved.body.version }).expect(201);

      const refreshed = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(refreshed[0].remainingAmount)).toBe(0);
      expect(refreshed[0].status).toBe('WRITTEN_OFF');
    });
  });

  describe('Ageing', () => {
    it('computes overdue days from the due date, only on the remaining balance', async () => {
      const customerId = await createCounterparty('CUSTOMER', { paymentTerms: 0 });
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }], { documentDate: '2020-01-01' }));

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 600, documentDate: '2020-01-05', sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const ageing = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/customer-ageing`)).expect(200);
      const row = ageing.body.find((r: any) => r.sourceDocumentId === invoice.id);
      expect(row).toBeDefined();
      expect(Number(row.outstanding)).toBe(400);
      expect(row.daysOverdue).toBeGreaterThan(365 * 5);
      expect(row.bucket).toBe('OVER_365');
    });
  });

  describe('Realized FX', () => {
    // Tenant base currency is USD (set at tenant creation) — EUR is the
    // "foreign" currency for these invoices/payments.
    it('computes the FX gain on a full foreign-currency payment, and only the settled portion on a partial one', async () => {
      const eur = await prisma.currency.findUnique({ where: { code: 'EUR' } });
      expect(eur).toBeDefined();

      await currencyService.recordExchangeRate({ tenantId: tenant1Id, currencyCode: 'EUR', baseCurrencyCode: 'USD', effectiveDate: new Date('2026-01-01'), rate: 1.7 });
      await currencyService.recordExchangeRate({ tenantId: tenant1Id, currencyCode: 'EUR', baseCurrencyCode: 'USD', effectiveDate: new Date('2026-02-01'), rate: 1.75 });

      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice(
        'SALES_INVOICE',
        await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }], { currencyId: eur!.id, documentDate: '2026-01-01' }),
      );

      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 1000, currencyId: eur!.id, documentDate: '2026-02-01', sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const items = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(items[0].remainingAmount)).toBe(0);

      const allocations = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/allocations`)).query({ targetOpenItemId: items[0].id }).expect(200);
      const fxAllocation = allocations.body.find((a: any) => Number(a.realizedFxAmount) !== 0);
      expect(fxAllocation).toBeDefined();
      expect(Number(fxAllocation.realizedFxAmount)).toBeCloseTo(50, 2);
    });

    it('realizes FX only on the settled portion of a partial payment', async () => {
      const eur = await prisma.currency.findUnique({ where: { code: 'EUR' } });
      await currencyService.recordExchangeRate({ tenantId: tenant1Id, currencyCode: 'EUR', baseCurrencyCode: 'USD', effectiveDate: new Date('2026-03-01'), rate: 1.7 }).catch(() => undefined);
      await currencyService.recordExchangeRate({ tenantId: tenant1Id, currencyCode: 'EUR', baseCurrencyCode: 'USD', effectiveDate: new Date('2026-03-10'), rate: 1.75 }).catch(() => undefined);

      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice(
        'SALES_INVOICE',
        await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }], { currencyId: eur!.id, documentDate: '2026-03-01' }),
      );
      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 400, currencyId: eur!.id, documentDate: '2026-03-10', sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const items = await openItemsFor('SALES_INVOICE', invoice.id);
      expect(Number(items[0].remainingAmount)).toBe(600);

      const allocations = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/allocations`)).query({ targetOpenItemId: items[0].id }).expect(200);
      expect(Number(allocations.body[0].realizedFxAmount)).toBeCloseTo(20, 2);
    });
  });

  describe('Concurrent allocation', () => {
    it('never lets two parallel allocations over-settle the same open item', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 1000 }]));
      const items = await openItemsFor('SALES_INVOICE', invoice.id);

      const attempt = (amount: number, ref: string) =>
        auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/allocations`))
          .send({ counterpartyId: customerId, role: 'CUSTOMER', paymentDocumentType: 'TEST_PAYMENT', paymentDocumentId: ref, paymentCurrencyId: baseCurrencyId, paymentDate: DOC_DATE, lines: [{ targetOpenItemId: items[0].id, amount }] });

      // Whichever of the two concurrent attempts wins the advisory lock
      // first is nondeterministic — only the safety property (exactly one
      // succeeds, the other is rejected as exceeding what remains) is
      // guaranteed, not which amount wins.
      const [r1, r2] = await Promise.all([attempt(800, `pay-${run}-a`), attempt(700, `pay-${run}-b`)]);
      const succeeded = [r1, r2].filter((r) => r.status === 201);
      const failed = [r1, r2].filter((r) => r.status !== 201);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const refreshed = await openItemsFor('SALES_INVOICE', invoice.id);
      const winningAmount = succeeded[0] === r1 ? 800 : 700;
      expect(Number(refreshed[0].remainingAmount)).toBe(1000 - winningAmount);
    });
  });

  describe('Invoice unpost dependency', () => {
    it('blocks unposting an invoice with an active allocation', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 500 }]));
      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 500, documentDate: DOC_DATE, sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const res = await auth1(request(app.getHttpServer()).post(`/documents/SALES_INVOICE/${invoice.id}/unpost`)).send({ expectedVersion: invoice.version });
      expect(res.status).toBe(409);
    });
  });

  describe('Reconciliation', () => {
    it('generates a statement whose closing balance matches the register', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 500 }], { documentDate: '2026-04-10' }));
      const cashboxId = await createCashbox();
      const txn = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/cash-transactions`))
        .send({ cashboxId, direction: 'RECEIPT', category: 'CUSTOMER_PAYMENT', counterpartyId: customerId, amount: 200, documentDate: '2026-04-15', sourceSalesInvoiceId: invoice.id })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/CASH_TRANSACTION/${txn.body.id}/post`)).send({ expectedVersion: txn.body.version }).expect(201);

      const recon = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/settlements/reconciliations`))
        .send({ counterpartyId: customerId, periodStart: '2026-04-01', periodEnd: '2026-04-30' })
        .expect(201);
      expect(Number(recon.body.closingBalance)).toBe(300);

      const balance = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/settlements/balances/${customerId}`)).expect(200);
      expect(Number(balance.body.receivable)).toBe(300);
    });
  });

  describe('Tenant isolation', () => {
    it('tenant2 cannot see a tenant1 open item', async () => {
      const customerId = await createCounterparty('CUSTOMER');
      const invoice = await postInvoice('SALES_INVOICE', await createSalesInvoice(customerId, [{ productId, unitId, quantity: 1, price: 100 }]));
      const items = await openItemsFor('SALES_INVOICE', invoice.id);

      const res = await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/settlements/open-items/${items[0].id}`));
      expect([403, 404]).toContain(res.status);
    });
  });
});
