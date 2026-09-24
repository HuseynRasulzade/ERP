/**
 * Inventory Costing Engine E2E tests (docx spec Phase 11).
 *
 * Covers: FIFO basic (two receipts, one shipment spanning both layers) and
 * partial consumption, Weighted Average (moving), COGS posted at Sales
 * Invoice time from the Shipment's own consumption, Additional Purchase
 * Cost capitalized after part of the receipt already sold (split between
 * on-hand inventory and COGS), Sales Return restoring the original sale's
 * cost, Purchase Return consuming the exact source receipt layer (not
 * blind FIFO order), Warehouse Transfer preserving cost across
 * warehouses, backdated-receipt FIFO recalculation generating a
 * SYSTEM_RECALCULATION cost adjustment, negative-stock costing
 * (LAST_KNOWN_COST), costing period finalization (blocked while a
 * recalculation is pending, blocks further posting once finalized), and
 * tenant isolation of the costing policy.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { SHIPMENT_TYPE } from '../src/sales-execution/shipment.repository';
import * as request from 'supertest';

describe('Inventory Costing Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let orgFifoId: string;
  let orgAvgId: string;
  let orgIsoId: string;
  let unitId: string;
  let supplierId: string;
  let customerId: string;
  let supplierIdAvg: string;
  let customerIdAvg: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const localization = app.get(AzTaxLocalizationService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`icost1-${run}@e2e.test`, `icost-t1-${run}`, 'ICF1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    orgFifoId = s1.orgId;

    const orgAvgRes = await auth1(request(app.getHttpServer()).post('/organizations')).send({ code: `ICA1-${run}`, name: 'Weighted Average Org' }).expect(201);
    orgAvgId = orgAvgRes.body.id;

    const orgIsoRes = await auth1(request(app.getHttpServer()).post('/organizations')).send({ code: `ICI1-${run}`, name: 'Isolation Org' }).expect(201);
    orgIsoId = orgIsoRes.body.id;

    const s2 = await setupTenant(`icost2-${run}@e2e.test`, `icost-t2-${run}`, 'ICF2');
    token2 = s2.token;
    tenant2Id = s2.tenantId;

    await charts.ensureAdopted(tenant1Id);
    await charts.ensureAdopted(tenant2Id);
    await localization.ensureSeeded();

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure')).send({ code: 'PCS11', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' }).expect(201);
    unitId = u.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: 'SUP-P11', name: 'Costing Supply Co', paymentTerms: 30 })
      .expect(201);
    supplierId = supplier.body.id;

    const customer = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: 'CUST-P11', name: 'Costing Buyer', creditLimit: 10000000 })
      .expect(201);
    customerId = customer.body.id;

    const supplierAvg = await auth1(request(app.getHttpServer()).post(`/organizations/${orgAvgId}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: 'SUP-P11A', name: 'Costing Supply Co (Avg)', paymentTerms: 30 })
      .expect(201);
    supplierIdAvg = supplierAvg.body.id;

    const customerAvg = await auth1(request(app.getHttpServer()).post(`/organizations/${orgAvgId}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: 'CUST-P11A', name: 'Costing Buyer (Avg)', creditLimit: 10000000 })
      .expect(201);
    customerIdAvg = customerAvg.body.id;

    // Costing policy adoption (spec section 4) — the "opt in per
    // organization" step; every phase 0-10 test never does this and stays
    // completely unaffected by this module's existence.
    await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/inventory-costing/policy`))
      .send({ effectiveFrom: '2020-01-01', costingMethod: 'FIFO', costByWarehouse: true })
      .expect(201);
    await auth1(request(app.getHttpServer()).post(`/organizations/${orgAvgId}/inventory-costing/policy`))
      .send({ effectiveFrom: '2020-01-01', costingMethod: 'WEIGHTED_AVERAGE', averageMethod: 'MOVING_AVERAGE' })
      .expect(201);
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

  async function postDocument(documentType: string, id: string, expectedVersion: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/documents/${documentType}/${id}/post`)).send({ expectedVersion });
    if (res.status !== 201) {
      // eslint-disable-next-line no-console
      console.error(`${documentType} post failed`, res.status, JSON.stringify(res.body));
    }
    return res;
  }

  async function makeProduct(orgId: string, code: string) {
    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/products`))
      .send({ code, name: code, productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    return p.body.id as string;
  }

  async function makeWarehouse(orgId: string, code: string, allowNegativeStock = false) {
    const w = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/warehouses`))
      .send({ code, name: code, allowNegativeStock })
      .expect(201);
    return w.body.id as string;
  }

  async function postGoodsReceipt(orgId: string, warehouseId: string, productId: string, quantity: number, price: number, documentDate: string, supplier = supplierId) {
    const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/goods-receipts`))
      .send({ counterpartyId: supplier, warehouseId, documentDate, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    const posted = await postDocument('GOODS_RECEIPT', gr.body.id, gr.body.version);
    expect(posted.status).toBe(201);
    return { id: gr.body.id, lineId: gr.body.lines[0].id, postingStatus: posted.body.postingStatus };
  }

  async function postShipment(orgId: string, warehouseId: string, productId: string, quantity: number, documentDate: string, customer = customerId) {
    const s = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/shipments`))
      .send({ documentDate, counterpartyId: customer, warehouseId, lines: [{ productId, unitId, quantity: String(quantity) }] })
      .expect(201);
    const posted = await postDocument(SHIPMENT_TYPE, s.body.id, s.body.version);
    expect(posted.status).toBe(201);
    return { id: s.body.id, lineId: s.body.lines[0].id, postingStatus: posted.body.postingStatus };
  }

  async function postSalesInvoiceForShipmentLine(orgId: string, productId: string, shipmentLineId: string, quantity: number, price: number, documentDate: string, customer = customerId) {
    const inv = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/sales-invoices`))
      .send({ counterpartyId: customer, documentDate, lines: [{ productId, unitId, quantity, price, sourceShipmentLineId: shipmentLineId }] })
      .expect(201);
    const posted = await postDocument('SALES_INVOICE', inv.body.id, inv.body.version);
    expect(posted.status).toBe(201);
    return { id: inv.body.id, postingStatus: posted.body.postingStatus };
  }

  async function cogsDebitFor(tenantId: string, sourceDocumentId: string, expectedAmount: number) {
    const movements = await prisma.accountingMovement.findMany({ where: { tenantId, sourceDocumentType: 'SALES_INVOICE', sourceDocumentId } });
    return movements.find((m) => m.side === 'DEBIT' && Math.abs(Number(m.amountBase) - expectedAmount) < 0.01);
  }

  describe('FIFO costing (spec sections 8-11, 119-120)', () => {
    it('consumes the oldest layer first across two receipts, and COGS posts at Sales Invoice time', async () => {
      const warehouseId = await makeWarehouse(orgFifoId, `WH-FIFO-${run}`);
      const productId = await makeProduct(orgFifoId, `FIFO-P1-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 10, '2026-01-01');
      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 12, '2026-01-02');

      const valuation = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/valuation`).query({ productId, warehouseId })).expect(200);
      expect(Number(valuation.body[0].quantity)).toBeCloseTo(200, 6);
      expect(Number(valuation.body[0].value)).toBeCloseTo(2200, 2);

      const shipment = await postShipment(orgFifoId, warehouseId, productId, 150, '2026-01-03');
      const invoice = await postSalesInvoiceForShipmentLine(orgFifoId, productId, shipment.lineId, 150, 50, '2026-01-03');

      // spec section 9: 100 @ 10 + 50 @ 12 = 1,600
      const debit = await cogsDebitFor(tenant1Id, invoice.id, 1600);
      expect(debit).toBeDefined();

      const layers = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/layers`).query({ productId })).expect(200);
      const closed = layers.body.find((l: any) => Number(l.originalUnitCost) === 10);
      const partial = layers.body.find((l: any) => Number(l.originalUnitCost) === 12);
      expect(closed.status).toBe('CLOSED');
      expect(Number(partial.remainingQuantity)).toBeCloseTo(50, 6);
      expect(Number(partial.currentRemainingValue)).toBeCloseTo(600, 2);
    });

    it('a partial shipment leaves the correct remaining layer quantity/value (spec section 120)', async () => {
      const warehouseId = await makeWarehouse(orgFifoId, `WH-FIFO2-${run}`);
      const productId = await makeProduct(orgFifoId, `FIFO-P2-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 10, '2026-01-01');
      const shipment = await postShipment(orgFifoId, warehouseId, productId, 40, '2026-01-02');
      await postSalesInvoiceForShipmentLine(orgFifoId, productId, shipment.lineId, 40, 50, '2026-01-02');

      const layers = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/layers`).query({ productId })).expect(200);
      expect(Number(layers.body[0].remainingQuantity)).toBeCloseTo(60, 6);
      expect(layers.body[0].status).toBe('PARTIALLY_CONSUMED');
    });
  });

  describe('Weighted Average costing (spec sections 12-14, 121)', () => {
    it('opening + receipt averages to the expected unit cost', async () => {
      const warehouseId = await makeWarehouse(orgAvgId, `WH-AVG-${run}`);
      const productId = await makeProduct(orgAvgId, `AVG-P1-${run}`);

      await postGoodsReceipt(orgAvgId, warehouseId, productId, 100, 10, '2026-02-01', supplierIdAvg);
      await postGoodsReceipt(orgAvgId, warehouseId, productId, 100, 14, '2026-02-02', supplierIdAvg);

      const valuation = await auth1(request(app.getHttpServer()).get(`/organizations/${orgAvgId}/inventory-costing/valuation`).query({ productId, warehouseId })).expect(200);
      expect(Number(valuation.body[0].quantity)).toBeCloseTo(200, 6);
      expect(Number(valuation.body[0].value)).toBeCloseTo(2400, 2);
      expect(Number(valuation.body[0].unitCost)).toBeCloseTo(12, 6);

      const shipment = await postShipment(orgAvgId, warehouseId, productId, 50, '2026-02-03', customerIdAvg);
      const invoice = await postSalesInvoiceForShipmentLine(orgAvgId, productId, shipment.lineId, 50, 30, '2026-02-03', customerIdAvg);
      const debit = await cogsDebitFor(tenant1Id, invoice.id, 600); // 50 @ 12
      expect(debit).toBeDefined();
    });
  });

  describe('Additional Purchase Cost after partial sale (spec sections 18-20, 122-123)', () => {
    it('splits the additional cost between on-hand inventory and COGS', async () => {
      const warehouseId = await makeWarehouse(orgFifoId, `WH-APC-${run}`);
      const productId = await makeProduct(orgFifoId, `APC-P1-${run}`);

      const receipt = await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 10, '2026-03-01');
      await postShipment(orgFifoId, warehouseId, productId, 40, '2026-03-02'); // 60 remain, 40 already sold

      const apc = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/additional-purchase-costs`))
        .send({ counterpartyId: supplierId, documentDate: '2026-03-05', costType: 'FREIGHT', allocationMethod: 'BY_VALUE', totalCost: 200, targetLines: [{ goodsReceiptLineId: receipt.lineId }] })
        .expect(201);
      const posted = await postDocument('ADDITIONAL_PURCHASE_COST', apc.body.id, apc.body.version);
      expect(posted.status).toBe(201);
      expect(posted.body.postingStatus).toBe('POSTED');

      // perUnit = 200/100 = 2; on-hand 60 -> 120; already-sold 40 -> 80.
      const movements = await prisma.accountingMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: 'ADDITIONAL_PURCHASE_COST', sourceDocumentId: apc.body.id } });
      const inventoryDebit = movements.find((m) => m.side === 'DEBIT' && Math.abs(Number(m.amountBase) - 120) < 0.01);
      const cogsDebit = movements.find((m) => m.side === 'DEBIT' && Math.abs(Number(m.amountBase) - 80) < 0.01);
      expect(inventoryDebit).toBeDefined();
      expect(cogsDebit).toBeDefined();

      const layers = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/layers`).query({ productId })).expect(200);
      expect(Number(layers.body[0].currentUnitCost)).toBeCloseTo(12, 6); // 10 + 2
      expect(Number(layers.body[0].currentRemainingValue)).toBeCloseTo(720, 2); // 60 * 12
    });
  });

  describe('Sales Return restores original cost (spec sections 26-27, 124)', () => {
    it('restores the return quantity at the ORIGINAL shipment cost, not current pool cost', async () => {
      const warehouseId = await makeWarehouse(orgFifoId, `WH-SR-${run}`);
      const productId = await makeProduct(orgFifoId, `SR-P1-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseId, productId, 10, 15, '2026-04-01');
      const shipment = await postShipment(orgFifoId, warehouseId, productId, 10, '2026-04-02');
      const invoiceRes = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/sales-invoices`))
        .send({ counterpartyId: customerId, documentDate: '2026-04-02', lines: [{ productId, unitId, quantity: 10, price: 50, sourceShipmentLineId: shipment.lineId }] })
        .expect(201);
      const invPosted = await postDocument('SALES_INVOICE', invoiceRes.body.id, invoiceRes.body.version);
      expect(invPosted.status).toBe(201);

      // A NEW, much cheaper receipt arrives before the return — proves the
      // restore uses the ORIGINAL cost, never the new current pool cost.
      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 1, '2026-04-03');

      const invoiceLineId = invoiceRes.body.lines[0].id;
      const ret = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/sales-returns`))
        .send({ documentDate: '2026-04-04', counterpartyId: customerId, originalSalesInvoiceId: invoiceRes.body.id, warehouseId, returnType: 'PHYSICAL_RETURN', lines: [{ sourceInvoiceLineId: invoiceLineId, productId, unitId, quantity: '4' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/SALES_RETURN/${ret.body.id}/post`)).send({ expectedVersion: ret.body.version }).expect(201);

      const layers = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/layers`).query({ productId })).expect(200);
      // spec section 124: 4 units restored at the original 15/unit = 60, as
      // its own layer — never blended into the new 1/unit receipt.
      const restoredLayer = layers.body.find((l: any) => Number(l.originalUnitCost) === 15 && l.status !== 'CLOSED');
      expect(restoredLayer).toBeDefined();
      expect(Number(restoredLayer.remainingQuantity)).toBeCloseTo(4, 6);
    });
  });

  describe('Purchase Return consumes the exact source layer (spec sections 28, 125)', () => {
    it('returns 20 units specifically from Receipt B, never blind FIFO order', async () => {
      const warehouseId = await makeWarehouse(orgFifoId, `WH-PR-${run}`);
      const productId = await makeProduct(orgFifoId, `PR-P1-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 10, '2026-05-01'); // Receipt A
      const receiptB = await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 15, '2026-05-02'); // Receipt B

      const ret = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/purchase-returns`))
        .send({ counterpartyId: supplierId, documentDate: '2026-05-03', warehouseId, originalGoodsReceiptId: receiptB.id, lines: [{ sourceReceiptLineId: receiptB.lineId, productId, unitId, quantity: 20, originalUnitPrice: 15 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/PURCHASE_RETURN/${ret.body.id}/post`)).send({ expectedVersion: ret.body.version }).expect(201);

      const layers = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/layers`).query({ productId })).expect(200);
      const layerA = layers.body.find((l: any) => Number(l.originalUnitCost) === 10);
      const layerB = layers.body.find((l: any) => Number(l.originalUnitCost) === 15);
      expect(Number(layerA.remainingQuantity)).toBeCloseTo(100, 6); // untouched
      expect(Number(layerB.remainingQuantity)).toBeCloseTo(80, 6); // 100 - 20
    });
  });

  describe('Warehouse Transfer preserves cost (spec sections 30-31, 126)', () => {
    it('moves value with the stock — organization total unchanged', async () => {
      const warehouseA = await makeWarehouse(orgFifoId, `WH-TA-${run}`);
      const warehouseB = await makeWarehouse(orgFifoId, `WH-TB-${run}`);
      const productId = await makeProduct(orgFifoId, `TR-P1-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseA, productId, 50, 10, '2026-06-01');

      const transfer = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/warehouse-transfers`))
        .send({ sourceWarehouseId: warehouseA, destinationWarehouseId: warehouseB, transferType: 'INSTANT', documentDate: '2026-06-02', lines: [{ productId, unitId, quantity: 20 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/WAREHOUSE_TRANSFER/${transfer.body.id}/post`)).send({ expectedVersion: transfer.body.version }).expect(201);

      const valA = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/valuation`).query({ productId, warehouseId: warehouseA })).expect(200);
      const valB = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/valuation`).query({ productId, warehouseId: warehouseB })).expect(200);

      expect(Number(valA.body[0].quantity)).toBeCloseTo(30, 6);
      expect(Number(valA.body[0].value)).toBeCloseTo(300, 2);
      expect(Number(valB.body[0].quantity)).toBeCloseTo(20, 6);
      expect(Number(valB.body[0].value)).toBeCloseTo(200, 2);
    });
  });

  describe('Backdated FIFO recalculation (spec sections 46-49, 127, 131)', () => {
    let productId: string;
    let warehouseId: string;
    let shipmentInvoiceId: string;

    it('a backdated cheaper receipt changes which layer the shipment consumed, generating a cost adjustment', async () => {
      warehouseId = await makeWarehouse(orgFifoId, `WH-BD-${run}`);
      productId = await makeProduct(orgFifoId, `BD-P1-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 10, '2026-07-10'); // Layer X
      const shipment = await postShipment(orgFifoId, warehouseId, productId, 100, '2026-07-15'); // consumes X: COGS 1,000
      const invoice = await postSalesInvoiceForShipmentLine(orgFifoId, productId, shipment.lineId, 100, 50, '2026-07-15');
      shipmentInvoiceId = invoice.id;
      expect(await cogsDebitFor(tenant1Id, invoice.id, 1000)).toBeDefined();

      // Backdated receipt — EARLIER than Layer X — becomes the new oldest layer.
      await postGoodsReceipt(orgFifoId, warehouseId, productId, 100, 5, '2026-07-05'); // Layer Y

      const queueBefore = await prisma.inventoryCostRecalculationQueue.findMany({ where: { tenantId: tenant1Id, organizationId: orgFifoId, status: 'PENDING' } });
      expect(queueBefore.length).toBeGreaterThan(0);

      // Finalizing the period covering the shipment must be blocked while
      // a recalculation is pending (spec section 133).
      const blockedFinalize = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/inventory-costing/periods/2026/7/finalize`)).expect(409);
      expect(blockedFinalize.body.code).toBe('COSTING_FINALIZATION_BLOCKED');

      const result = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/inventory-costing/calculations/recalculate`)).expect(201);
      expect(result.body.processedKeys).toBeGreaterThan(0);
      expect(result.body.adjustmentsCreated).toBeGreaterThan(0);

      const queueAfter = await prisma.inventoryCostRecalculationQueue.findMany({ where: { tenantId: tenant1Id, organizationId: orgFifoId, status: 'PENDING' } });
      expect(queueAfter.length).toBe(0);

      const adjustments = await prisma.inventoryCostAdjustment.findMany({ where: { tenantId: tenant1Id, organizationId: orgFifoId, reason: 'SYSTEM_RECALCULATION' }, include: { lines: true } });
      const line = adjustments.flatMap((a) => a.lines).find((l) => l.productId === productId);
      expect(line).toBeDefined();
      // New COGS 500 (100 @ 5, the now-oldest layer) - old 1,000 = -500.
      expect(Number(line!.cogsAmount)).toBeCloseTo(-500, 2);

      // Idempotent: re-running with nothing new queued creates no more adjustments.
      const second = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/inventory-costing/calculations/recalculate`)).expect(201);
      expect(second.body.processedKeys).toBe(0);
      expect(second.body.adjustmentsCreated).toBe(0);
    });

    it('posting the generated adjustment moves 500 from COGS back to Inventory', async () => {
      const adjustments = await prisma.inventoryCostAdjustment.findMany({ where: { tenantId: tenant1Id, organizationId: orgFifoId, reason: 'SYSTEM_RECALCULATION', status: 'DRAFT' } });
      const adjustment = adjustments[0];
      expect(adjustment).toBeDefined();

      const fresh = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-cost-adjustments/${adjustment.id}`)).expect(200);
      const posted = await auth1(request(app.getHttpServer()).post(`/documents/INVENTORY_COST_ADJUSTMENT/${adjustment.id}/post`)).send({ expectedVersion: fresh.body.version }).expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');

      const movements = await prisma.accountingMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: 'INVENTORY_COST_ADJUSTMENT', sourceDocumentId: adjustment.id } });
      const inventoryDebit = movements.find((m) => m.side === 'DEBIT' && Math.abs(Number(m.amountBase) - 500) < 0.01);
      const cogsCredit = movements.find((m) => m.side === 'CREDIT' && Math.abs(Number(m.amountBase) - 500) < 0.01);
      expect(inventoryDebit).toBeDefined();
      expect(cogsCredit).toBeDefined();
      void shipmentInvoiceId;
    });

    it('finalizing the period now succeeds, and blocks a further cost-affecting post into it', async () => {
      const finalized = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/inventory-costing/periods/2026/7/finalize`)).expect(201);
      expect(finalized.body.status).toBe('FINALIZED');

      // A new Goods Receipt dated inside the finalized month must be
      // blocked at posting time (spec section 111) — the whole document
      // fails, never a silent historical modification.
      const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: '2026-07-20', lines: [{ productId, unitId, quantity: 5, price: 9 }] })
        .expect(201);
      const rejected = await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(409);
      expect(rejected.body.code).toBe('COSTING_PERIOD_FINALIZED');

      // Reopen releases the block (spec section 59).
      await auth1(request(app.getHttpServer()).post(`/organizations/${orgFifoId}/inventory-costing/periods/2026/7/reopen`)).send({ reason: 'test reopen' }).expect(201);
      const nowAllowed = await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);
      expect(nowAllowed.body.postingStatus).toBe('POSTED');
    });
  });

  describe('Negative stock costing (spec sections 52-54, 128)', () => {
    it('a shipment beyond available stock costs at LAST_KNOWN_COST, provisionally', async () => {
      const warehouseId = await makeWarehouse(orgFifoId, `WH-NEG-${run}`, true);
      const productId = await makeProduct(orgFifoId, `NEG-P1-${run}`);

      await postGoodsReceipt(orgFifoId, warehouseId, productId, 10, 12, '2026-08-01');
      const first = await postShipment(orgFifoId, warehouseId, productId, 10, '2026-08-02'); // fully consumes the layer
      await postSalesInvoiceForShipmentLine(orgFifoId, productId, first.lineId, 10, 50, '2026-08-02');

      const second = await postShipment(orgFifoId, warehouseId, productId, 10, '2026-08-03'); // no stock left — negative
      const movement = await prisma.inventoryCostMovement.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'SHIPMENT', sourceDocumentId: second.id } });
      expect(movement?.costStatus).toBe('PROVISIONAL');
      expect(Math.abs(Number(movement!.totalCost))).toBeCloseTo(120, 2); // 10 @ 12 (last known cost)
    });
  });

  describe('Costing health & valuation reporting', () => {
    it('returns a well-formed health report', async () => {
      const health = await auth1(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/health`)).expect(200);
      expect(typeof health.body.healthy).toBe('boolean');
      expect(Array.isArray(health.body.unresolvedErrors)).toBe(true);
    });
  });

  describe('Tenant isolation of the costing policy (spec section 4)', () => {
    it('tenant 2 has no visibility into tenant 1s costing policy or organizations', async () => {
      await auth2(request(app.getHttpServer()).get(`/organizations/${orgFifoId}/inventory-costing/policy`)).expect(404);
    });
  });
});
