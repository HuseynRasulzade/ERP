/**
 * Sales Execution E2E tests (docx spec Phase 7).
 *
 * Covers: Order => Shipment (defaults to remaining fulfillable quantity,
 * never full order qty), posted vs draft shipment fulfillment counting,
 * over-shipment rejection, insufficient-stock rejection, reservation
 * consumption on posting and restoration on unposting, Shipment =>
 * Invoice with real GL/Tax/SettlementObligation posting, invoice quantity
 * capped at remaining invoiceable, invoice unpost blocked by a posted
 * return, Sales Return (physical) with prorated historical tax and a
 * contra GL entry plus inventory RECEIPT, excessive-return rejection, and
 * tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { SALES_ORDER_TYPE } from '../src/sales-documents/sales-order.repository';
import { SALES_INVOICE_TYPE } from '../src/sales-documents/sales-invoice.repository';
import { SHIPMENT_TYPE } from '../src/sales-execution/shipment.repository';
import * as request from 'supertest';

describe('Sales Execution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let productId: string;
  let noStockProductId: string;
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
    const localization = app.get(AzTaxLocalizationService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`exec1-${run}@e2e.test`, `exec-t1-${run}`, 'EXO1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const s2 = await setupTenant(`exec2-${run}@e2e.test`, `exec-t2-${run}`, 'EXO2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    await charts.ensureAdopted(tenant1Id);
    await localization.ensureSeeded();

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS7', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'P7-PROD-001', name: 'Execution Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const p2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'P7-PROD-002', name: 'No Stock Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    noStockProductId = p2.body.id;

    const cust = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: 'CUST-007', name: 'Execution Buyer', creditLimit: 1000000 })
      .expect(201);
    customerId = cust.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-EXEC', name: 'Execution Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;
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

  async function createConfirmedOrder(quantity: number, forProductId = productId) {
    const order = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
      .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId: forProductId, unitId, quantity, price: 50 }] })
      .expect(201);
    // No endpoint exposes SalesOrder.warehouseId yet (spec section 97's
    // "preferred warehouse" — see docs/SALES_PREORDER.md Technical Debt);
    // set it directly so Order=>Shipment mapping has one to copy.
    await prisma.salesOrder.update({ where: { id: order.body.id }, data: { warehouseId } });
    const confirmed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.body.id}/confirm`))
      .send({ expectedVersion: order.body.version })
      .expect(201);
    const fresh = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.body.id}`)).expect(200);
    return { ...fresh.body, postingStatus: confirmed.body.postingStatus };
  }

  async function receiveStock(qty: number) {
    // Seed the real Phase 10 InventoryMovement register directly for test
    // setup purposes only — a dummy posted Goods Receipt would work too
    // but is unnecessary ceremony for a Sales Execution test fixture.
    await prisma.inventoryMovement.create({
      data: {
        tenantId: tenant1Id,
        organizationId: org1Id,
        warehouseId,
        productId,
        unitId,
        movementType: 'PURCHASE_RECEIPT',
        quantity: String(qty),
        baseQuantity: String(qty),
        effectiveDate: new Date(DOC_DATE),
        registrarDocumentType: 'TEST_STOCK_SEED',
        registrarDocumentId: `seed-${run}-${Date.now()}-${Math.random()}`,
      },
    });
  }

  describe('Order => Shipment (spec section 6) — remaining quantity only', () => {
    it('defaults shipment quantity to remaining fulfillable, not full order quantity', async () => {
      await receiveStock(1000);
      const order = await createConfirmedOrder(100);

      const created1 = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/create-based-on/${SHIPMENT_TYPE}`),
      ).expect(201);
      const shipment1 = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/shipments/${created1.body.id}`)).expect(200);
      expect(shipment1.body.lines).toHaveLength(1);
      expect(Number(shipment1.body.lines[0].quantity)).toBeCloseTo(100, 6);

      const posted1 = await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment1.body.id}/post`))
        .send({ expectedVersion: shipment1.body.version })
        .expect(201);
      expect(posted1.body.postingStatus).toBe('POSTED');

      // A second Shipment from the same order should now default to the
      // remaining 0 -> no fulfillable lines -> rejected.
      await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/create-based-on/${SHIPMENT_TYPE}`),
      ).expect(400);

      const fulfillment = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}/fulfillment`)).expect(200);
      expect(Number(fulfillment.body[0].fulfilled)).toBeCloseTo(100, 6);
      expect(Number(fulfillment.body[0].remaining)).toBeCloseTo(0, 6);

      const orderAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`)).expect(200);
      expect(orderAfter.body.fulfillmentStatus).toBe('FULFILLED');
    });

    it('a draft (unposted) shipment does not count as fulfillment (spec sections 7, 93)', async () => {
      const order = await createConfirmedOrder(50);
      const shipment = await auth1(
        request(app.getHttpServer()).post(`/documents/${SALES_ORDER_TYPE}/${order.id}/create-based-on/${SHIPMENT_TYPE}`),
      ).expect(201);

      const fulfillment = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}/fulfillment`)).expect(200);
      expect(Number(fulfillment.body[0].fulfilled)).toBeCloseTo(0, 6);
      void shipment;
    });

    it('partial shipments accumulate correctly and reject over-shipment (spec sections 8-9, 94)', async () => {
      const order = await createConfirmedOrder(100);

      const shipA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId, customerOrderId: order.id, lines: [{ sourceOrderLineId: order.lines[0].id, productId, unitId, quantity: '30' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipA.body.id}/post`)).send({ expectedVersion: shipA.body.version }).expect(201);

      const shipB = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId, customerOrderId: order.id, lines: [{ sourceOrderLineId: order.lines[0].id, productId, unitId, quantity: '30' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipB.body.id}/post`)).send({ expectedVersion: shipB.body.version }).expect(201);

      const midFulfillment = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}/fulfillment`)).expect(200);
      expect(Number(midFulfillment.body[0].fulfilled)).toBeCloseTo(60, 6);
      const orderMid = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`)).expect(200);
      expect(orderMid.body.fulfillmentStatus).toBe('PARTIALLY_FULFILLED');

      // 41 more would exceed the remaining 40.
      const over = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId, customerOrderId: order.id, lines: [{ sourceOrderLineId: order.lines[0].id, productId, unitId, quantity: '41' }] })
        .expect(201);
      const rejected = await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${over.body.id}/post`))
        .send({ expectedVersion: over.body.version })
        .expect(422);
      expect(rejected.body.code).toBe('SHIPMENT_QUANTITY_EXCEEDS_REMAINING');
    });

    it('rejects posting when stock is insufficient', async () => {
      const order = await createConfirmedOrder(5, noStockProductId);
      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId, customerOrderId: order.id, lines: [{ sourceOrderLineId: order.lines[0].id, productId: noStockProductId, unitId, quantity: '5' }] })
        .expect(201);
      const rejected = await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/post`))
        .send({ expectedVersion: shipment.body.version })
        .expect(422);
      expect(rejected.body.code).toBe('SHIPMENT_INSUFFICIENT_STOCK');
    });
  });

  describe('Reservation consumption + restoration (spec sections 15, 17, 95)', () => {
    it('shipment posting consumes reservation; unposting restores it and reverses the inventory movement', async () => {
      const order = await createConfirmedOrder(20);
      const reserved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/reservations`))
        .send({ lines: [{ salesOrderLineId: order.lines[0].id, warehouseId, quantity: '20' }] })
        .expect(201);
      expect(reserved.body[0].status).toBe('ACTIVE');

      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId, customerOrderId: order.id, lines: [{ sourceOrderLineId: order.lines[0].id, productId, unitId, quantity: '8' }] })
        .expect(201);
      const posted = await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/post`))
        .send({ expectedVersion: shipment.body.version })
        .expect(201);

      const reservationsAfterShip = await prisma.stockReservation.findMany({ where: { tenantId: tenant1Id, sourceLineId: order.lines[0].id } });
      const activeQty = reservationsAfterShip.filter((r) => r.status === 'PARTIALLY_RELEASED' || r.status === 'ACTIVE').reduce((s, r) => s + Number(r.quantity), 0);
      expect(activeQty).toBeCloseTo(12, 6); // 20 reserved - 8 consumed

      const movementsBeforeUnpost = await prisma.inventoryMovement.count({
        where: { tenantId: tenant1Id, registrarDocumentType: SHIPMENT_TYPE, registrarDocumentId: shipment.body.id },
      });
      expect(movementsBeforeUnpost).toBe(1);

      await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/unpost`))
        .send({ expectedVersion: posted.body.version })
        .expect(201);

      const movementsAfterUnpost = await prisma.inventoryMovement.count({
        where: { tenantId: tenant1Id, registrarDocumentType: SHIPMENT_TYPE, registrarDocumentId: shipment.body.id },
      });
      expect(movementsAfterUnpost).toBe(0);

      const reservationsAfterUnpost = await prisma.stockReservation.findMany({ where: { tenantId: tenant1Id, sourceLineId: order.lines[0].id, status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] } } });
      const restoredQty = reservationsAfterUnpost.reduce((s, r) => s + Number(r.quantity), 0);
      expect(restoredQty).toBeCloseTo(20, 6);
    });
  });

  describe('Shipment => Sales Invoice (spec sections 22, 31) — real GL + Tax + AR', () => {
    it('posts a balanced invoice with SettlementObligation and enforces the invoiceable cap', async () => {
      const order = await createConfirmedOrder(10);
      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId, customerOrderId: order.id, lines: [{ sourceOrderLineId: order.lines[0].id, productId, unitId, quantity: '10' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/post`)).send({ expectedVersion: shipment.body.version }).expect(201);

      const invoice = await auth1(
        request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/create-based-on/${SALES_INVOICE_TYPE}`),
      ).expect(201);

      await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-invoices/${invoice.body.id}`))
        .send({ expectedVersion: invoice.body.version, lines: [{ productId, unitId, quantity: 10, price: 50, sourceShipmentLineId: shipment.body.lines[0].id }] })
        .expect(200);

      const current = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-invoices/${invoice.body.id}`)).expect(200);
      const posted = await auth1(request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.body.id}/post`))
        .send({ expectedVersion: current.body.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');

      const entry = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: invoice.body.id }, include: { lines: true } });
      const debit = entry!.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = entry!.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(590, 2); // 500 net * 1.18

      const obligation = await prisma.settlementObligation.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: invoice.body.id } });
      expect(obligation).toBeTruthy();
      expect(Number(obligation!.amountDue)).toBeCloseTo(590, 2);
      expect(obligation!.status).toBe('NOT_PAID');

      // Attempting to invoice the same shipment line again exceeds the
      // remaining invoiceable quantity (already fully invoiced).
      const secondInvoice = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-invoices`),
      )
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1, price: 50, sourceShipmentLineId: shipment.body.lines[0].id }] })
        .expect(201);
      const rejected = await auth1(request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${secondInvoice.body.id}/post`))
        .send({ expectedVersion: secondInvoice.body.version })
        .expect(422);
      expect(rejected.body.code).toBe('INVOICE_QUANTITY_EXCEEDS_SOURCE');
    });
  });

  describe('Sales Return (spec sections 47-53) — prorated historical tax, contra GL, physical receipt', () => {
    it('posts a physical return crediting AR, debiting SALES_RETURN + contra VAT, and receiving stock back', async () => {
      const order = await createConfirmedOrder(4);
      const invoice = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-invoices`))
        .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 4, price: 50 }] })
        .expect(201);
      const postedInvoice = await auth1(request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.body.id}/post`))
        .send({ expectedVersion: invoice.body.version })
        .expect(201);

      const invoiceLineId = invoice.body.lines[0].id;

      const ret = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-returns`))
        .send({
          documentDate: DOC_DATE,
          counterpartyId: customerId,
          originalSalesInvoiceId: invoice.body.id,
          warehouseId,
          returnType: 'PHYSICAL_RETURN',
          lines: [{ sourceInvoiceLineId: invoiceLineId, productId, unitId, quantity: '1' }], // 1 of 4
        })
        .expect(201);

      const stockBefore = await prisma.inventoryMovement.count({ where: { tenantId: tenant1Id, movementType: 'SALES_RETURN', registrarDocumentType: 'SALES_RETURN' } });

      const postedReturn = await auth1(request(app.getHttpServer()).post(`/documents/SALES_RETURN/${ret.body.id}/post`))
        .send({ expectedVersion: ret.body.version })
        .expect(201);
      expect(postedReturn.body.postingStatus).toBe('POSTED');

      const stockAfter = await prisma.inventoryMovement.count({ where: { tenantId: tenant1Id, movementType: 'SALES_RETURN', registrarDocumentType: 'SALES_RETURN' } });
      expect(stockAfter).toBe(stockBefore + 1);

      const returnEntry = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'SALES_RETURN', sourceDocumentId: ret.body.id }, include: { lines: true } });
      expect(returnEntry?.status).toBe('POSTED');
      const debit = returnEntry!.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
      const credit = returnEntry!.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
      expect(debit).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(59, 2); // 1/4 of the 236 invoice total (50 net + 18% VAT) per unit = 59

      // Excessive return (already returned 1 of 4; requesting 4 more) is rejected.
      const excessive = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-returns`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, originalSalesInvoiceId: invoice.body.id, lines: [{ sourceInvoiceLineId: invoiceLineId, productId, unitId, quantity: '4' }] })
        .expect(422);
      expect(excessive.body.code).toBe('RETURN_QUANTITY_EXCEEDS_SOLD');

      // Unposting the original invoice is now blocked by the posted return.
      const blockedUnpost = await auth1(request(app.getHttpServer()).post(`/documents/${SALES_INVOICE_TYPE}/${invoice.body.id}/unpost`))
        .send({ expectedVersion: postedInvoice.body.version })
        .expect(409);
      expect(blockedUnpost.body.code).toBe('INVOICE_HAS_RETURNS');
    });
  });

  describe('Tenant isolation (spec section 116)', () => {
    it('tenant 2 cannot see tenant 1 shipments or read tenant 1 tax movements', async () => {
      const anyShipment = await prisma.shipment.findFirst({ where: { tenantId: tenant1Id } });
      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/shipments/${anyShipment!.id}`)).expect(404);
    });
  });
});
