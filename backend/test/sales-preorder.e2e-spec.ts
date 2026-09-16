/**
 * Sales Pre-Order & Order Management E2E tests (docx spec Phase 6).
 *
 * Covers: CustomerRequest (no price required, cancellable), CommercialOffer
 * (real price resolution + discount + Tax Preview, never a TaxMovement),
 * offer expiry/lifecycle, Request=>Offer and Offer=>SalesOrder CreateBasedOn
 * (with line price/tax preservation on the latter), order confirmation as
 * the generic post command (credit check + hold gating), the explicit
 * no-accounting/no-tax-register/no-AR/no-revenue assertion, reservations
 * (commitment only, never physical stock, oversubscription rejected),
 * shipment planning (never itself fulfillment), payment schedule
 * generation with deterministic rounding, and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { SALES_ORDER_TYPE } from '../src/sales-documents/sales-order.repository';
import { CUSTOMER_REQUEST_TYPE } from '../src/sales-preorder/customer-request.repository';
import { COMMERCIAL_OFFER_TYPE } from '../src/sales-preorder/commercial-offer.repository';
import * as request from 'supertest';

describe('Sales Pre-Order & Order Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let localization: AzTaxLocalizationService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let productId: string;
  let unitId: string;
  let customerId: string;
  let warehouseId: string;

  const DOC_DATE = '2026-06-15';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    localization = app.get(AzTaxLocalizationService);
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

  describe('Setup', () => {
    it('creates two tenants with catalog, a credit-limited customer, price list, and VAT localization', async () => {
      const s1 = await setupTenant(`pre1-${run}@e2e.test`, `pre-t1-${run}`, 'PRO1');
      token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
      const s2 = await setupTenant(`pre2-${run}@e2e.test`, `pre-t2-${run}`, 'PRO2');
      token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

      await localization.ensureSeeded();

      const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
        .send({ code: 'PCS6', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
        .expect(201);
      unitId = u.body.id;

      const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
        .send({ code: 'P6-PROD-001', name: 'Preorder Widget', productType: 'GOODS', baseUnitId: unitId })
        .expect(201);
      productId = p.body.id;

      const cust = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'CUSTOMER', code: 'CUST-006', name: 'Preorder Buyer', creditLimit: 100000 })
        .expect(201);
      customerId = cust.body.id;

      const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
        .send({ code: 'WH-MAIN', name: 'Main Warehouse' })
        .expect(201);
      warehouseId = wh.body.id;

      const curRes = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
      const currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id;

      const pl = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists`))
        .send({ priceListType: 'SALE', code: 'RETAIL-P6', name: 'Retail P6', currencyId, validFrom: '2026-01-01' })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists/${pl.body.id}/prices`))
        .send({ productId, unitId, price: 100, minQuantity: 1 })
        .expect(201);
    });
  });

  describe('Customer Request (spec sections 3-4)', () => {
    let requestId: string;
    it('creates a request with no price required, and cancels it', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/customer-requests`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, lines: [{ productId, unitId, quantity: '5' }] })
        .expect(201);
      expect(res.body.number).toMatch(/^CR-2026-\d+$/);
      expect(res.body.status).toBe('OPEN');
      requestId = res.body.id;

      const cancelled = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/customer-requests/${requestId}/cancel`))
        .send({ expectedVersion: res.body.version })
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
    });
  });

  describe('Commercial Offer — price resolution, discount, Tax Preview (spec sections 5-11, 33)', () => {
    let offerId: string;
    let offerVersion: number;

    it('resolves price from the price list, applies a line discount, and computes Tax Preview via the real Tax Engine', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/commercial-offers`))
        .send({
          documentDate: DOC_DATE,
          validUntil: '2026-12-31',
          counterpartyId: customerId,
          lines: [{ productId, unitId, quantity: '10', discountPercent: '10' }],
        })
        .expect(201);
      expect(res.body.number).toMatch(/^CO-2026-\d+$/);
      expect(res.body.status).toBe('DRAFT');
      const line = res.body.lines[0];
      expect(line.priceListId).toBeTruthy();
      expect(Number(line.discountAmount)).toBeCloseTo(100, 2); // 1000 * 10%
      expect(Number(line.taxRate)).toBeCloseTo(18, 2); // real Tax Engine standard rate
      expect(Number(line.lineTotal)).toBeCloseTo(900, 2); // (100*10) - 100 discount
      expect(Number(line.taxAmount)).toBeCloseTo(162, 2); // 900 * 18%
      expect(Number(res.body.grandTotal)).toBeCloseTo(1062, 2);

      // No Tax Register entry — this is preview only (spec section 103).
      const taxMovements = await prisma.taxMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: COMMERCIAL_OFFER_TYPE, sourceDocumentId: res.body.id } });
      expect(taxMovements).toHaveLength(0);

      offerId = res.body.id;
      offerVersion = res.body.version;
    });

    it('send -> accept lifecycle, audited', async () => {
      const sent = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/commercial-offers/${offerId}/send`))
        .send({ expectedVersion: offerVersion }).expect(201);
      expect(sent.body.status).toBe('SENT');
      const accepted = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/commercial-offers/${offerId}/accept`))
        .send({ expectedVersion: sent.body.version }).expect(201);
      expect(accepted.body.status).toBe('ACCEPTED');
      offerVersion = accepted.body.version;

      const events = await prisma.auditEvent.findMany({ where: { tenantId: tenant1Id, entityType: COMMERCIAL_OFFER_TYPE, entityId: offerId } });
      expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(['COMMERCIAL_OFFER_CREATED', 'COMMERCIAL_OFFER_SENT', 'COMMERCIAL_OFFER_ACCEPTED']));
    });

    it('an offer past validUntil reports EXPIRED without any write (spec section 12)', async () => {
      const expiring = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/commercial-offers`))
        .send({ documentDate: DOC_DATE, validUntil: '2020-01-01', counterpartyId: customerId, lines: [{ productId, unitId, quantity: '1' }] })
        .expect(201);
      const fetched = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/commercial-offers/${expiring.body.id}`)).expect(200);
      expect(fetched.body.status).toBe('EXPIRED');
    });

    describe('Offer => SalesOrder conversion (spec sections 13, 31-32, 76-77)', () => {
      it('converts an ACCEPTED offer into a SalesOrder, preserving the exact offered price/discount/tax', async () => {
        const res = await auth1(
          request(app.getHttpServer()).post(`/documents/${COMMERCIAL_OFFER_TYPE}/${offerId}/create-based-on/${SALES_ORDER_TYPE}`),
        ).expect(201);
        expect(res.body.number).toMatch(/^SO-2026-\d+$/);

        const order = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${res.body.id}`)).expect(200);
        expect(order.body.lines).toHaveLength(1);
        expect(Number(order.body.lines[0].price)).toBeCloseTo(100, 2);
        expect(Number(order.body.lines[0].taxRate)).toBeCloseTo(18, 2); // preserved, not re-resolved
        expect(Number(order.body.grandTotal)).toBeCloseTo(1062, 2); // identical to the offer's total

        const offerAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/commercial-offers/${offerId}`)).expect(200);
        expect(offerAfter.body.status).toBe('CONVERTED');
      });

      it('rejects converting a non-accepted offer', async () => {
        const draftOffer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/commercial-offers`))
          .send({ documentDate: DOC_DATE, counterpartyId: customerId, lines: [{ productId, unitId, quantity: '1' }] })
          .expect(201);
        await auth1(
          request(app.getHttpServer()).post(`/documents/${COMMERCIAL_OFFER_TYPE}/${draftOffer.body.id}/create-based-on/${SALES_ORDER_TYPE}`),
        ).expect(400);
      });
    });
  });

  describe('Customer Request => Commercial Offer conversion (spec section 31)', () => {
    it('copies the header and marks the request QUOTED', async () => {
      const req = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/customer-requests`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, lines: [{ productId, unitId, quantity: '3' }] })
        .expect(201);

      const offer = await auth1(
        request(app.getHttpServer()).post(`/documents/${CUSTOMER_REQUEST_TYPE}/${req.body.id}/create-based-on/${COMMERCIAL_OFFER_TYPE}`),
      ).expect(201);
      expect(offer.body.number).toMatch(/^CO-2026-\d+$/);

      const reqAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/customer-requests/${req.body.id}`)).expect(200);
      expect(reqAfter.body.status).toBe('QUOTED');
    });
  });

  describe('Order confirmation = post (spec section 22) — credit check + holds', () => {
    async function createOrder(quantity: number) {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity, price: 100 }] })
        .expect(201);
      return res.body;
    }

    it('confirms a within-credit-limit order with no accounting/tax consequence (spec sections 102, 125-126)', async () => {
      const order = await createOrder(2);
      const confirmed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version }).expect(201);
      expect(confirmed.body.postingStatus).toBe('POSTED');

      const journalEntries = await prisma.journalEntry.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: SALES_ORDER_TYPE, sourceDocumentId: order.id } });
      expect(journalEntries).toHaveLength(0);
      const movements = await prisma.accountingMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: SALES_ORDER_TYPE, sourceDocumentId: order.id } });
      expect(movements).toHaveLength(0);
      const taxMovements = await prisma.taxMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: SALES_ORDER_TYPE, sourceDocumentId: order.id } });
      expect(taxMovements).toHaveLength(0);

      const creditCheck = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}/check-credit`)).expect(200);
      expect(creditCheck.body.status).toBe('WITHIN_LIMIT');
    });

    it('blocks confirmation when the order amount exceeds the credit limit', async () => {
      const tightCustomer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'CUSTOMER', code: 'CUST-TIGHT', name: 'Tight Credit Buyer', creditLimit: 50 })
        .expect(201);
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: tightCustomer.body.id, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 5, price: 100 }] })
        .expect(201);

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/confirm`))
        .send({ expectedVersion: order.body.version })
        .expect(409);
      expect(blocked.body.code).toBe('CREDIT_CHECK_BLOCKED');
    });

    it('refuses to create a sales order for a blacklisted counterparty', async () => {
      const blacklistCustomer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'CUSTOMER', code: `CUST-BL-${run}`, name: 'Blacklisted Buyer' })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${blacklistCustomer.body.id}/risk-status`))
        .send({ riskStatus: 'BLACKLISTED', note: 'chronic non-payment', expectedVersion: blacklistCustomer.body.version })
        .expect(201);

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: blacklistCustomer.body.id, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price: 100 }] });
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(/blacklisted/i);
    });

    it('blocks confirmation while an active hold exists, and allows it once released', async () => {
      const order = await createOrder(1);
      const hold = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/holds`))
        .send({ holdType: 'MANUAL', reason: 'awaiting manager review' })
        .expect(201);

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version })
        .expect(409);
      expect(blocked.body.code).toBe('ORDER_ON_HOLD');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/order-holds/${hold.body.id}/release`)).expect(201);

      const confirmed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version })
        .expect(201);
      expect(confirmed.body.postingStatus).toBe('POSTED');
    });
  });

  describe('Reservation (spec sections 37-42) — commitment only, never physical stock', () => {
    it('reserves against the order line, updates reservationStatus, and rejects oversubscription', async () => {
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 10, price: 100 }] })
        .expect(201);
      const lineId = order.body.lines[0].id;

      const reserved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/reservations`))
        .send({ lines: [{ salesOrderLineId: lineId, warehouseId, quantity: '6' }] })
        .expect(201);
      expect(reserved.body).toHaveLength(1);
      expect(reserved.body[0].status).toBe('ACTIVE');

      const orderAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.body.id}`)).expect(200);
      expect(orderAfter.body.reservationStatus).toBe('PARTIALLY_RESERVED');

      const over = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/reservations`))
        .send({ lines: [{ salesOrderLineId: lineId, warehouseId, quantity: '5' }] }) // 6 already + 5 > 10
        .expect(422);
      expect(over.body.code).toBe('RESERVATION_EXCEEDS_REMAINING');

      const release = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/stock-reservations/${reserved.body[0].id}/release`))
        .send({ expectedVersion: reserved.body[0].version })
        .expect(201);
      expect(release.body.status).toBe('RELEASED');

      const orderAfterRelease = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.body.id}`)).expect(200);
      expect(orderAfterRelease.body.reservationStatus).toBe('NOT_RESERVED');

      // Never a physical stock movement (spec section 38).
      const registerMovements = await prisma.registerMovement.findMany({ where: { tenantId: tenant1Id, registerCode: { contains: 'STOCK' } } });
      expect(registerMovements).toHaveLength(0);
    });

    it('fulfillment summary reflects ordered/reserved/remaining without any Shipment execution (spec sections 27-28, 83)', async () => {
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 8, price: 100 }] })
        .expect(201);
      const lineId = order.body.lines[0].id;
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/reservations`))
        .send({ lines: [{ salesOrderLineId: lineId, warehouseId, quantity: '3' }] })
        .expect(201);

      const summary = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.body.id}/fulfillment`)).expect(200);
      expect(summary.body).toHaveLength(1);
      expect(Number(summary.body[0].ordered)).toBeCloseTo(8, 6);
      expect(Number(summary.body[0].reserved)).toBeCloseTo(3, 6);
      expect(Number(summary.body[0].fulfilled)).toBeCloseTo(0, 6);
      expect(Number(summary.body[0].remaining)).toBeCloseTo(8, 6); // reservation is not fulfillment
    });
  });

  describe('Shipment Plan (spec sections 45-48) — planning only, never fulfillment', () => {
    it('creates a plan within remaining quantity and rejects over-planning', async () => {
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 10, price: 100 }] })
        .expect(201);
      const lineId = order.body.lines[0].id;

      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/shipment-plans`))
        .send({ plannedDate: DOC_DATE, warehouseId, lines: [{ salesOrderLineId: lineId, plannedQuantity: '10' }] })
        .expect(201);
      expect(plan.body.lines).toHaveLength(1);

      const orderAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.body.id}`)).expect(200);
      expect(orderAfter.body.fulfillmentStatus).toBe('NOT_STARTED'); // planning != fulfillment

      const over = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/shipment-plans`))
        .send({ plannedDate: DOC_DATE, warehouseId, lines: [{ salesOrderLineId: lineId, plannedQuantity: '1' }] })
        .expect(422);
      expect(over.body.code).toBe('SHIPMENT_PLAN_EXCEEDS_REMAINING');
    });
  });

  describe('Payment Schedule (spec sections 49-53) — deterministic rounding', () => {
    it('generates a 50/50 schedule summing exactly to the order total', async () => {
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price: 999.99 }] })
        .expect(201);

      const schedule = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/payment-schedule`))
        .send({ installments: [{ dueDate: DOC_DATE, percentage: '50' }, { dueDate: '2026-07-15', percentage: '50' }] })
        .expect(201);
      expect(schedule.body).toHaveLength(2);
      const total = schedule.body.reduce((s: number, i: any) => s + Number(i.amount), 0);
      expect(total).toBeCloseTo(Number(order.body.grandTotal), 2);
    });

    it('rejects a mismatched externally-supplied schedule', async () => {
      const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price: 100 }] })
        .expect(201);
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/payment-schedule`))
        .send({ installments: [{ dueDate: DOC_DATE, amount: '50' }] })
        .expect(422);
      expect(res.body.code).toBe('PAYMENT_SCHEDULE_MISMATCH');
    });
  });

  describe('Tenant isolation (spec section 139)', () => {
    it('tenant 2 cannot see tenant 1 customer requests or offers', async () => {
      const anyRequest = await prisma.customerRequest.findFirst({ where: { tenantId: tenant1Id } });
      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/customer-requests/${anyRequest!.id}`)).expect(404);

      const anyOffer = await prisma.commercialOffer.findFirst({ where: { tenantId: tenant1Id } });
      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/commercial-offers/${anyOffer!.id}`)).expect(404);
    });
  });
});
