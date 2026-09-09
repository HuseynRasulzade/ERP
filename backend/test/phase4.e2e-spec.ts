/**
 * Phase 4 — Sales documents (orders + invoices) E2E tests.
 *
 * Covers the first real business documents on the DocumentFramework:
 * price snapshotting at SAVE (posting never re-resolves), explicit-price
 * overrides, customer-only validation, tenant/org isolation, optimistic
 * concurrency, the save/post/unpost/cancel lifecycle with movements,
 * closed-period blocking, and SALES_ORDER => SALES_INVOICE CreateBasedOn.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { SALES_ORDER_TYPE } from '../src/sales-documents/sales-order.repository';
import { SALES_INVOICE_TYPE } from '../src/sales-documents/sales-invoice.repository';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import * as request from 'supertest';

describe('Phase 4 — Sales documents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let charts: ChartOfAccountsService;
  let localization: AzTaxLocalizationService;
  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let unitPieceId: string;
  let productId: string;
  let unpricedProductId: string;
  let customerId: string;
  let supplierId: string;
  let currencyId: string;
  let priceListId: string;

  const DOC_DATE = '2026-06-15';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    charts = app.get(ChartOfAccountsService);
    localization = app.get(AzTaxLocalizationService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Test1234!', displayName: 'Test User' })
      .expect(201);
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

  async function createOrder(lines: any[], extra: Record<string, unknown> = {}) {
    const res = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`),
    )
      .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines, ...extra })
      .expect(201);
    return res.body;
  }

  async function createInvoice(lines: any[], extra: Record<string, unknown> = {}) {
    const res = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-invoices`),
    )
      .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines, ...extra })
      .expect(201);
    return res.body;
  }

  describe('Setup', () => {
    it('should create two isolated tenants with catalog, counterparties, and a SALE price list', async () => {
      const s1 = await setupTenant(`p4a-${run}@e2e.test`, `p4-t1-${run}`, 'P4O1');
      token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
      const s2 = await setupTenant(`p4b-${run}@e2e.test`, `p4-t2-${run}`, 'P4O2');
      token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

      // Accounting Core + Tax Engine reconciliation: posting a Sales
      // Invoice now resolves real accounting mappings (CUSTOMER_RECEIVABLE,
      // SALES_REVENUE, VAT_OUTPUT_PAYABLE), which requires the tenant to
      // have adopted the AZ chart and the shared VAT rules to be seeded —
      // same prerequisite as accounting-core.e2e-spec.ts / tax-engine.e2e-spec.ts.
      await charts.ensureAdopted(tenant1Id);
      await localization.ensureSeeded();

      const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
        .send({ code: 'PCS4', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
        .expect(201);
      unitPieceId = u.body.id;

      const p = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/products`),
      )
        .send({ code: 'P4-PROD-001', name: 'Phase4 Widget', productType: 'GOODS', baseUnitId: unitPieceId })
        .expect(201);
      productId = p.body.id;

      const p2 = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/products`),
      )
        .send({ code: 'P4-PROD-002', name: 'Unpriced Gadget', productType: 'GOODS', baseUnitId: unitPieceId })
        .expect(201);
      unpricedProductId = p2.body.id;

      const cust = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`),
      )
        .send({ counterpartyType: 'CUSTOMER', code: 'CUST-004', name: 'Acme Buyer' })
        .expect(201);
      customerId = cust.body.id;

      const supp = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`),
      )
        .send({ counterpartyType: 'SUPPLIER', code: 'SUPP-004', name: 'Supply Co' })
        .expect(201);
      supplierId = supp.body.id;

      const curRes = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
      currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id || curRes.body[0]?.id;
      expect(currencyId).toBeTruthy();

      const pl = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists`),
      )
        .send({
          priceListType: 'SALE', code: 'RETAIL-P4', name: 'Retail P4',
          currencyId, validFrom: '2026-01-01',
        })
        .expect(201);
      priceListId = pl.body.id;

      await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists/${priceListId}/prices`),
      )
        .send({ productId, unitId: unitPieceId, price: 100, minQuantity: 1 })
        .expect(201);
    });
  });

  describe('Sales order save — price snapshot', () => {
    it('should snapshot the SALE price and compute totals when no explicit price is given', async () => {
      const order = await createOrder([{ productId, unitId: unitPieceId, quantity: 2, taxRate: 20 }]);

      expect(order.number).toMatch(/^SO-2026-\d+$/);
      expect(order.postingStatus).toBe('NOT_POSTED');
      expect(Number(order.subtotal)).toBeCloseTo(200, 2);
      expect(Number(order.taxTotal)).toBeCloseTo(40, 2);
      expect(Number(order.grandTotal)).toBeCloseTo(240, 2);
      expect(order.lines).toHaveLength(1);
      expect(Number(order.lines[0].price)).toBeCloseTo(100, 2);
      expect(order.lines[0].priceListId).toBeTruthy();
      expect(order.lines[0].productPriceId).toBeTruthy();
    });

    it('should honor an explicit line price without touching price lists', async () => {
      const order = await createOrder(
        [{ productId, unitId: unitPieceId, quantity: 1, price: 50, taxRate: 10 }],
      );

      expect(Number(order.subtotal)).toBeCloseTo(50, 2);
      expect(Number(order.taxTotal)).toBeCloseTo(5, 2);
      expect(Number(order.grandTotal)).toBeCloseTo(55, 2);
      expect(order.lines[0].priceListId).toBeNull();
    });

    it('should reject a line with no price and no matching SALE price', async () => {
      const res = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`),
      )
        .send({
          counterpartyId: customerId,
          documentDate: DOC_DATE,
          lines: [{ productId: unpricedProductId, unitId: unitPieceId, quantity: 1 }],
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject a supplier as the order counterparty', async () => {
      const res = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`),
      )
        .send({
          counterpartyId: supplierId,
          documentDate: DOC_DATE,
          lines: [{ productId, unitId: unitPieceId, quantity: 1, price: 10 }],
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-positive quantities', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({
          counterpartyId: customerId,
          documentDate: DOC_DATE,
          lines: [{ productId, unitId: unitPieceId, quantity: 0, price: 10 }],
        })
        .expect(400);
    });
  });

  describe('Isolation and concurrency', () => {
    let orderId: string;

    it('should hide tenant 1 orders from tenant 2 (404, never 403)', async () => {
      const order = await createOrder([
        { productId, unitId: unitPieceId, quantity: 1, price: 10 },
      ]);
      orderId = order.id;

      await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/sales-orders/${orderId}`)
        .set('Authorization', `Bearer ${token2}`)
        .set('X-Tenant-Id', tenant2Id)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/organizations/${org2Id}/sales-orders`)
        .set('Authorization', `Bearer ${token2}`)
        .set('X-Tenant-Id', tenant2Id)
        .expect(200)
        .expect((res) => {
          if (res.body.length !== 0) throw new Error('cross-tenant rows leaked');
        });
    });

    it('should hide the order under a different organization of the same tenant', async () => {
      await auth1(request(app.getHttpServer()).get(`/organizations/${org2Id}/sales-orders`)).expect(404);
    });

    it('should reject a stale update with CONCURRENCY_CONFLICT', async () => {
      await auth1(
        request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-orders/${orderId}`),
      )
        .send({ expectedVersion: 1, description: 'first edit' })
        .expect(200);

      const stale = await auth1(
        request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-orders/${orderId}`),
      )
        .send({ expectedVersion: 1, description: 'stale edit' })
        .expect(409);
      expect(stale.body.code).toBe('CONCURRENCY_CONFLICT');
    });

    it('should replace lines wholesale and recompute totals on update', async () => {
      const updated = await auth1(
        request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-orders/${orderId}`),
      )
        .send({
          expectedVersion: 2,
          lines: [{ productId, unitId: unitPieceId, quantity: 3, taxRate: 0 }],
        })
        .expect(200);
      expect(updated.body.lines).toHaveLength(1);
      expect(Number(updated.body.subtotal)).toBeCloseTo(300, 2);
      expect(Number(updated.body.grandTotal)).toBeCloseTo(300, 2);
      expect(updated.body.version).toBe(3);
    });
  });

  describe('Sales order post/unpost/cancel lifecycle', () => {
    it('should post with one movement per line, unpost removing them, then cancel', async () => {
      const order = await createOrder([
        { productId, unitId: unitPieceId, quantity: 1, price: 10, taxRate: 5 },
        { productId, unitId: unitPieceId, quantity: 2, price: 20 },
      ]);

      const posted = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/post`),
      )
        .send({ expectedVersion: order.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');
      expect(posted.body.movementCount).toBe(2);

      const movements = await prisma.registerMovement.count({
        where: { tenantId: tenant1Id, recorderDocumentType: SALES_ORDER_TYPE, recorderDocumentId: order.id },
      });
      expect(movements).toBe(2);

      // Editing a posted document is blocked until it is unposted.
      await auth1(
        request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-orders/${order.id}`),
      )
        .send({ expectedVersion: posted.body.version, description: 'blocked edit' })
        .expect(400);

      const unposted = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/unpost`),
      )
        .send({ expectedVersion: posted.body.version })
        .expect(201);
      expect(unposted.body.postingStatus).toBe('NOT_POSTED');

      const afterUnpost = await prisma.registerMovement.count({
        where: { tenantId: tenant1Id, recorderDocumentType: SALES_ORDER_TYPE, recorderDocumentId: order.id },
      });
      expect(afterUnpost).toBe(0);

      const cancelled = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/cancel`),
      )
        .send({ expectedVersion: unposted.body.version })
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
    });

    it('should not post the same order twice', async () => {
      const order = await createOrder([
        { productId, unitId: unitPieceId, quantity: 1, price: 10 },
      ]);

      await auth1(request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/post`))
        .send({ expectedVersion: order.version })
        .expect(201);

      const second = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/post`),
      )
        .send({ expectedVersion: order.version + 1 })
        .expect(409);
      expect(second.body.code).toBe('DOCUMENT_ALREADY_POSTED');
    });
  });

  describe('Closed period blocks posting', () => {
    it('should reject posting into a closed period even with posting permission', async () => {
      const order = await createOrder(
        [{ productId, unitId: unitPieceId, quantity: 1, price: 10 }],
        { documentDate: '2026-08-10' },
      );

      const period = await auth1(request(app.getHttpServer()).post('/periods'))
        .send({ year: 2026, month: 8 })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/periods/${period.body.id}/close`)).expect(201);

      const blocked = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/post`),
      )
        .send({ expectedVersion: order.version })
        .expect(409);
      expect(blocked.body.code).toBe('PERIOD_CLOSED');

      await auth1(request(app.getHttpServer()).post(`/periods/${period.body.id}/reopen`))
        .send({ reason: 'phase4 e2e reopen' })
        .expect(201);

      const current = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`),
      ).expect(200);

      await auth1(request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/post`))
        .send({ expectedVersion: current.body.version })
        .expect(201);
    });
  });

  describe('Sales invoice standalone flow', () => {
    it('should create, post with RECEIVABLE_ACCRUAL movements, and number with the SI prefix', async () => {
      const invoice = await createInvoice([
        { productId, unitId: unitPieceId, quantity: 2, taxRate: 20 },
      ]);

      expect(invoice.number).toMatch(/^SI-2026-\d+$/);
      expect(Number(invoice.grandTotal)).toBeCloseTo(240, 2);

      const posted = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.id}/post`),
      )
        .send({ expectedVersion: invoice.version })
        .expect(201);
      expect(posted.body.movementCount).toBe(1);

      const movements = await prisma.registerMovement.findMany({
        where: {
          tenantId: tenant1Id,
          recorderDocumentType: SALES_INVOICE_TYPE,
          recorderDocumentId: invoice.id,
        },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('RECEIVABLE_ACCRUAL');

      // Accounting Core + Tax Engine reconciliation: posting also creates a
      // real, balanced Journal Entry (Dr Receivable / Cr Revenue / Cr VAT
      // Output Payable) and a Tax Register movement — using the Tax
      // Engine's resolved 18% standard rate, not the line's own taxRate:20
      // input (see sales-invoice.posting-handler.ts's documented scope).
      const entry = await prisma.journalEntry.findFirst({
        where: { tenantId: tenant1Id, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: invoice.id },
        include: { lines: true },
      });
      expect(entry?.status).toBe('POSTED');
      expect(entry!.lines).toHaveLength(3); // receivable, revenue, VAT output payable
      const glDebit = entry!.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const glCredit = entry!.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(glDebit).toBeCloseTo(glCredit, 2);
      expect(glDebit).toBeCloseTo(236, 2); // 200 net * 1.18 standard VAT

      const taxMovements = await prisma.taxMovement.findMany({
        where: { tenantId: tenant1Id, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: invoice.id },
      });
      expect(taxMovements).toHaveLength(1);
      expect(Number(taxMovements[0].taxAmount)).toBeCloseTo(36, 2); // 200 * 18%
      expect(taxMovements[0].journalEntryId).toBe(entry!.id);

      // Unposting generically cleans up the linked Journal Entry (back to
      // DRAFT, its movements removed) and the Tax Register rows for this
      // source — DocumentPostingService.unpost's new Accounting Core/Tax
      // Register hookup, exercised here for the first time.
      const unposted = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.id}/unpost`),
      )
        .send({ expectedVersion: posted.body.version })
        .expect(201);
      expect(unposted.body.postingStatus).toBe('NOT_POSTED');

      const entryAfterUnpost = await prisma.journalEntry.findUnique({ where: { id: entry!.id } });
      expect(entryAfterUnpost?.status).toBe('DRAFT');
      const glMovementsAfterUnpost = await prisma.accountingMovement.findMany({ where: { journalEntryId: entry!.id } });
      expect(glMovementsAfterUnpost).toHaveLength(0);
      const taxMovementsAfterUnpost = await prisma.taxMovement.findMany({
        where: { tenantId: tenant1Id, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: invoice.id },
      });
      expect(taxMovementsAfterUnpost).toHaveLength(0);

      // Re-posting creates a fresh Journal Entry generation rather than
      // leaving the stale DRAFT one behind (spec section 46's repost
      // contract, applied generically in DocumentPostingService.post).
      const current = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-invoices/${invoice.id}`),
      ).expect(200);
      const reposted = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.id}/post`),
      )
        .send({ expectedVersion: current.body.version })
        .expect(201);
      expect(reposted.body.postingStatus).toBe('POSTED');

      const entriesForSource = await prisma.journalEntry.findMany({
        where: { tenantId: tenant1Id, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: invoice.id },
      });
      expect(entriesForSource).toHaveLength(1); // the stale DRAFT was deleted, not left orphaned
      expect(entriesForSource[0].status).toBe('POSTED');
    });

    it('should refuse to post a zero-total invoice', async () => {
      const invoice = await createInvoice([
        { productId, unitId: unitPieceId, quantity: 1, price: 0 },
      ]);
      expect(Number(invoice.grandTotal)).toBe(0);

      await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.id}/post`),
      )
        .send({ expectedVersion: invoice.version })
        .expect(400);
    });
  });

  describe('Create Based On SALES_ORDER => SALES_INVOICE', () => {
    it('should draft a header-only invoice, link it, then post it after adding lines', async () => {
      const order = await createOrder([
        { productId, unitId: unitPieceId, quantity: 2, taxRate: 10 },
      ]);

      const targets = await auth1(
        request(app.getHttpServer()).get(`/documents/${SALES_ORDER_TYPE}/${order.id}/create-based-on/targets`),
      ).expect(200);
      expect(targets.body.targetDocumentTypes).toContain(SALES_INVOICE_TYPE);

      const draft = await auth1(
        request(app.getHttpServer()).post(
          `/documents/${SALES_ORDER_TYPE}/${order.id}/create-based-on/${SALES_INVOICE_TYPE}`,
        ),
      )
        .send({})
        .expect(201);
      expect(draft.body.number).toMatch(/^SI-2026-\d+$/);
      expect(draft.body.tenantId).toBe(tenant1Id);

      // Header copied, no lines yet — totals are zero until lines are added.
      const fetched = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-invoices/${draft.body.id}`),
      ).expect(200);
      expect(fetched.body.counterpartyId).toBe(customerId);
      expect(fetched.body.lines).toHaveLength(0);
      expect(Number(fetched.body.grandTotal)).toBe(0);

      const links = await auth1(request(app.getHttpServer()).get('/document-links'))
        .query({ documentType: SALES_ORDER_TYPE, documentId: order.id })
        .expect(200);
      expect(
        links.body.some(
          (l: any) => l.targetDocumentId === draft.body.id && l.relationType === 'CREATED_BASED_ON',
        ),
      ).toBe(true);

      // Add the order's snapshot lines, then post.
      const withLines = await auth1(
        request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-invoices/${draft.body.id}`),
      )
        .send({
          expectedVersion: fetched.body.version,
          lines: [{ productId, unitId: unitPieceId, quantity: 2, price: 100, taxRate: 10 }],
        })
        .expect(200);
      expect(Number(withLines.body.grandTotal)).toBeCloseTo(220, 2);

      const posted = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${draft.body.id}/post`),
      )
        .send({ expectedVersion: withLines.body.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');
      expect(posted.body.movementCount).toBe(1);
    });

    it('should not Create Based On across tenants', async () => {
      const order = await createOrder([
        { productId, unitId: unitPieceId, quantity: 1, price: 10 },
      ]);

      await request(app.getHttpServer())
        .post(`/documents/${SALES_ORDER_TYPE}/${order.id}/create-based-on/${SALES_INVOICE_TYPE}`)
        .set('Authorization', `Bearer ${token2}`)
        .set('X-Tenant-Id', tenant2Id)
        .send({})
        .expect(404);
    });
  });
});
