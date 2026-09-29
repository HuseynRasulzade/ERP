/**
 * Inventory Costing Engine E2E tests (docx spec Phase 11). The module
 * itself (src/inventory-costing/) already existed, fully wired into
 * GoodsReceipt/Shipment/InternalConsumption/InventoryAdjustment/
 * WarehouseTransfer/SalesReturn/SalesInvoice — this suite is what was
 * missing: real end-to-end verification against PostgreSQL.
 *
 * Covers: the "no costing policy configured" no-op (and its health-check
 * signal), FIFO layer creation/consumption/exact math, weighted-average
 * (moving) receive/consume, real COGS GL posting at Sales Invoice time
 * (reading back the exact per-line cost the engine assigned at Shipment
 * time), Internal Consumption Dr Expense/Cr Inventory posting, Inventory
 * Adjustment WRITE_OFF/SURPLUS posting, unpost reversal (FIFO layers
 * reopened), a manual Inventory Cost Adjustment's GL split, backdated-
 * movement recalculation queueing + processing, costing period finalize/
 * reopen gating, the negative-stock policy never blocking the physical
 * posting, and the valuation/COGS/layer/health report endpoints.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { GOODS_RECEIPT_TYPE } from '../src/purchase-execution/goods-receipt.repository';
import { SHIPMENT_TYPE } from '../src/sales-execution/shipment.repository';
import { SALES_INVOICE_TYPE } from '../src/sales-documents/sales-invoice.repository';
import { INTERNAL_CONSUMPTION_TYPE } from '../src/warehouse-inventory/internal-consumption.repository';
import { INVENTORY_ADJUSTMENT_TYPE } from '../src/warehouse-inventory/inventory-adjustment.repository';
import { INVENTORY_COST_ADJUSTMENT_TYPE } from '../src/inventory-costing/inventory-cost-adjustment.repository';
import * as request from 'supertest';

describe('Inventory Costing Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let unitId: string;
  let warehouseId: string;
  let supplierId: string;
  let customerId: string;

  const NO_POLICY_DATE = '2026-01-05';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`icost1-${run}@e2e.test`, `icost-t1-${run}`, 'ICOST1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;

    const charts = app.get(ChartOfAccountsService);
    await charts.ensureAdopted(tenant1Id);
    const localization = app.get(AzTaxLocalizationService);
    await localization.ensureSeeded();

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: `PCS-IC-${run}`, name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: `WH-IC-${run}`, name: 'Costing Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: `SUP-IC-${run}`, name: 'Costing Supply Co' })
      .expect(201);
    supplierId = supplier.body.id;

    const customer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: `CUST-IC-${run}`, name: 'Costing Customer Co' })
      .expect(201);
    customerId = customer.body.id;
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

  async function createProduct(code: string) {
    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code, name: `Product ${code}`, productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    return p.body.id as string;
  }

  async function receiveGoods(productId: string, quantity: number, price: number, documentDate: string) {
    const receipt = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
      .send({ counterpartyId: supplierId, warehouseId, documentDate, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    const posted = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${receipt.body.id}/post`))
      .send({ expectedVersion: receipt.body.version })
      .expect(201);
    return { receiptId: receipt.body.id, lineId: receipt.body.lines[0].id, postingStatus: posted.body.postingStatus };
  }

  async function adoptPolicy(input: Record<string, unknown>) {
    return auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-costing/policy`))
      .send(input)
      .expect(201);
  }

  async function postDocument(documentType: string, id: string, expectedVersion: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/documents/${documentType}/${id}/post`)).send({ expectedVersion });
    if (res.status !== 201) console.log('DOC POST FAILED', documentType, JSON.stringify(res.body));
    return res;
  }

  async function journalFor(documentType: string, documentId: string) {
    const journal = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: documentType, sourceDocumentId: documentId } });
    if (!journal) return null;
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journal.id } });
    const debit = lines.reduce((s, l) => (l.side === 'DEBIT' ? s + Number(l.amountBase) : s), 0);
    const credit = lines.reduce((s, l) => (l.side === 'CREDIT' ? s + Number(l.amountBase) : s), 0);
    return { journal, lines, debit, credit };
  }

  // ---------------------------------------------------------------------
  // No costing policy configured — complete no-op, never fabricated
  // ---------------------------------------------------------------------

  it('is a complete no-op when no costing policy is configured, and the health check flags it as an EXPECTED (not unhealthy) state', async () => {
    const productId = await createProduct(`NOPOLICY-${run}`);
    const { receiptId } = await receiveGoods(productId, 10, 25, NO_POLICY_DATE);

    const movement = await prisma.inventoryMovement.findFirst({ where: { tenantId: tenant1Id, registrarDocumentType: GOODS_RECEIPT_TYPE, registrarDocumentId: receiptId } });
    expect(movement).not.toBeNull();
    expect(movement!.costingStatus).toBeNull();
    expect(movement!.provisionalCost).toBeNull();

    const costMovements = await prisma.inventoryCostMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: receiptId } });
    expect(costMovements).toHaveLength(0);

    const health = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-costing/health`)).expect(200);
    expect(health.body.uncostedMovementsBeforeAnyPolicy).toBeGreaterThanOrEqual(1);
    expect(health.body.uncostedMovementsWithActivePolicy).toBe(0);
    expect(health.body.healthy).toBe(true);
  });

  // ---------------------------------------------------------------------
  // FIFO — layer creation, exact consumption math, never blind averaging
  // ---------------------------------------------------------------------

  describe('FIFO costing', () => {
    it('adopts a FIFO policy, opens layers on receipt, and consumes strictly oldest-first with exact math', async () => {
      await adoptPolicy({ effectiveFrom: '2026-02-01', costingMethod: 'FIFO', costByWarehouse: true, costByBatch: false });

      const productId = await createProduct(`FIFO-${run}`);
      const r1 = await receiveGoods(productId, 100, 10, '2026-02-05'); // layer 1: 100 @ 10 = 1000
      const r2 = await receiveGoods(productId, 50, 12, '2026-02-06'); // layer 2: 50 @ 12 = 600

      const layersAfterReceipt = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-costing/layers?productId=${productId}`),
      ).expect(200);
      expect(layersAfterReceipt.body).toHaveLength(2);
      expect(layersAfterReceipt.body[0].originalUnitCost).toBe('10');
      expect(layersAfterReceipt.body[1].originalUnitCost).toBe('12');

      const receiptMovement1 = await prisma.inventoryMovement.findFirst({ where: { tenantId: tenant1Id, registrarDocumentType: GOODS_RECEIPT_TYPE, registrarDocumentId: r1.receiptId } });
      expect(receiptMovement1!.costingStatus).toBe('FINAL');

      // Ship 120 — fully drains layer 1 (100 @ 10 = 1000) then 20 from
      // layer 2 (20 @ 12 = 240): total 1240, never a blended average.
      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: '2026-02-10', counterpartyId: customerId, warehouseId, lines: [{ productId, unitId, quantity: '120' }] })
        .expect(201);
      const shipmentLineId = shipment.body.lines[0].id;
      const postedShipment = await postDocument(SHIPMENT_TYPE, shipment.body.id, shipment.body.version);
      expect(postedShipment.body.postingStatus).toBe('POSTED');

      const consumptions = await prisma.inventoryCostConsumption.findMany({ where: { tenantId: tenant1Id, outgoingDocumentType: SHIPMENT_TYPE, outgoingDocumentId: shipment.body.id } });
      expect(consumptions).toHaveLength(2);
      const totalConsumedCost = consumptions.reduce((s, c) => s + Number(c.consumedCost), 0);
      expect(totalConsumedCost).toBeCloseTo(1240, 2);

      const layersAfterShip = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-costing/layers?productId=${productId}`),
      ).expect(200);
      const layer1 = layersAfterShip.body.find((l: any) => l.originalUnitCost === '10');
      const layer2 = layersAfterShip.body.find((l: any) => l.originalUnitCost === '12');
      expect(layer1.status).toBe('CLOSED');
      expect(Number(layer1.remainingQuantity)).toBeCloseTo(0, 6);
      expect(layer2.status).toBe('PARTIALLY_CONSUMED');
      expect(Number(layer2.remainingQuantity)).toBeCloseTo(30, 6);

      const shipmentMovement = await prisma.inventoryMovement.findFirst({ where: { tenantId: tenant1Id, registrarDocumentType: SHIPMENT_TYPE, registrarLineId: shipmentLineId } });
      expect(shipmentMovement!.costingStatus).toBe('FINAL');

      // Real COGS GL posting happens at Sales Invoice time, reading back
      // the exact per-line cost the engine just computed above — never
      // re-derived, never the gross shipment total.
      const invoiceDraft = await auth1(
        request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/create-based-on/${SALES_INVOICE_TYPE}`),
      ).expect(201);
      const withLines = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-invoices/${invoiceDraft.body.id}`))
        .send({ expectedVersion: invoiceDraft.body.version, lines: [{ productId, unitId, quantity: 120, price: 20, sourceShipmentLineId: shipmentLineId }] })
        .expect(200);
      const postedInvoice = await postDocument(SALES_INVOICE_TYPE, invoiceDraft.body.id, withLines.body.version);
      expect(postedInvoice.body.postingStatus).toBe('POSTED');

      const cogsJournal = await journalFor(SALES_INVOICE_TYPE, invoiceDraft.body.id);
      expect(cogsJournal).not.toBeNull();
      const cogsLine = cogsJournal!.lines.find((l) => l.side === 'DEBIT' && Number(l.amountBase) === 1240);
      const inventoryCreditLine = cogsJournal!.lines.find((l) => l.side === 'CREDIT' && Number(l.amountBase) === 1240);
      expect(cogsLine).toBeDefined();
      expect(inventoryCreditLine).toBeDefined();
      expect(cogsJournal!.debit).toBeCloseTo(cogsJournal!.credit, 2);
    });

    it('reopens FIFO layers exactly on unpost, restoring remaining quantity/value', async () => {
      const productId = await createProduct(`FIFOUNPOST-${run}`);
      await receiveGoods(productId, 40, 5, '2026-02-15'); // layer: 40 @ 5 = 200

      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: '2026-02-16', counterpartyId: customerId, warehouseId, lines: [{ productId, unitId, quantity: '15' }] })
        .expect(201);
      const posted = await postDocument(SHIPMENT_TYPE, shipment.body.id, shipment.body.version);
      expect(posted.body.postingStatus).toBe('POSTED');

      const layerAfterShip = await prisma.inventoryCostLayer.findFirst({ where: { tenantId: tenant1Id, productId } });
      expect(Number(layerAfterShip!.remainingQuantity)).toBeCloseTo(25, 6);
      expect(layerAfterShip!.status).toBe('PARTIALLY_CONSUMED');

      await auth1(request(app.getHttpServer()).post(`/documents/${SHIPMENT_TYPE}/${shipment.body.id}/unpost`))
        .send({ expectedVersion: posted.body.version })
        .expect(201);

      const layerAfterUnpost = await prisma.inventoryCostLayer.findFirst({ where: { tenantId: tenant1Id, productId } });
      expect(Number(layerAfterUnpost!.remainingQuantity)).toBeCloseTo(40, 6);
      expect(layerAfterUnpost!.status).toBe('OPEN');

      const consumptionsAfterUnpost = await prisma.inventoryCostConsumption.findMany({ where: { tenantId: tenant1Id, outgoingDocumentType: SHIPMENT_TYPE, outgoingDocumentId: shipment.body.id, reversed: false } });
      expect(consumptionsAfterUnpost).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Weighted average (moving)
  // ---------------------------------------------------------------------

  describe('Weighted-average costing', () => {
    it('adopts a MOVING_AVERAGE policy and consumes at the exact running average — no per-receipt layers', async () => {
      await adoptPolicy({ effectiveFrom: '2026-03-01', costingMethod: 'WEIGHTED_AVERAGE', averageMethod: 'MOVING_AVERAGE', costByWarehouse: true });

      const productId = await createProduct(`WAVG-${run}`);
      await receiveGoods(productId, 50, 10, '2026-03-05'); // 50 @ 10 = 500
      await receiveGoods(productId, 50, 20, '2026-03-06'); // +50 @ 20 = 1000 -> pool 100 @ avg 15

      const layers = await prisma.inventoryCostLayer.findMany({ where: { tenantId: tenant1Id, productId } });
      expect(layers).toHaveLength(0); // weighted average never opens layers

      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: '2026-03-10', counterpartyId: customerId, warehouseId, lines: [{ productId, unitId, quantity: '60' }] })
        .expect(201);
      const posted = await postDocument(SHIPMENT_TYPE, shipment.body.id, shipment.body.version);
      expect(posted.body.postingStatus).toBe('POSTED');

      const consumption = await prisma.inventoryCostMovement.findFirst({
        where: { tenantId: tenant1Id, sourceDocumentType: SHIPMENT_TYPE, sourceDocumentId: shipment.body.id, quantity: { lt: 0 } },
      });
      expect(Number(consumption!.unitCost)).toBeCloseTo(15, 6);
      expect(Number(consumption!.totalCost)).toBeCloseTo(-900, 2); // 60 * 15

      const valuation = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-costing/valuation?productId=${productId}`),
      ).expect(200);
      const row = valuation.body[0];
      expect(Number(row.quantity)).toBeCloseTo(40, 6); // 100 received - 60 shipped
      expect(Number(row.value)).toBeCloseTo(600, 2); // 40 remaining @ 15
    });
  });

  // ---------------------------------------------------------------------
  // Internal Consumption / Inventory Adjustment GL posting
  // ---------------------------------------------------------------------

  describe('Internal Consumption and Inventory Adjustment GL posting', () => {
    it('posts Dr Expense / Cr Inventory for an Internal Consumption at the real FIFO cost', async () => {
      const productId = await createProduct(`INTCONS-${run}`);
      await receiveGoods(productId, 30, 7, '2026-02-20'); // 30 @ 7 = 210 under the FIFO policy (effective 2026-02-01)

      const consumption = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/internal-consumptions`))
        .send({ documentDate: '2026-02-21', warehouseId, operationType: 'OFFICE_CONSUMPTION', lines: [{ productId, unitId, quantity: 10 }] })
        .expect(201);
      const posted = await postDocument(INTERNAL_CONSUMPTION_TYPE, consumption.body.id, consumption.body.version);
      expect(posted.body.postingStatus).toBe('POSTED');

      const gl = await journalFor(INTERNAL_CONSUMPTION_TYPE, consumption.body.id);
      expect(gl).not.toBeNull();
      expect(gl!.debit).toBeCloseTo(gl!.credit, 2);
      expect(gl!.debit).toBeCloseTo(70, 2); // 10 @ 7
    });

    it('posts Dr Write-off Expense / Cr Inventory for a WRITE_OFF adjustment, and Dr Inventory / Cr Other Income for a SURPLUS', async () => {
      const productId = await createProduct(`ADJ-${run}`);
      await receiveGoods(productId, 20, 9, '2026-02-22'); // 20 @ 9 = 180

      const writeOff = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-adjustments`))
        .send({ documentDate: '2026-02-23', warehouseId, adjustmentType: 'WRITE_OFF', lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);
      const postedWriteOff = await postDocument(INVENTORY_ADJUSTMENT_TYPE, writeOff.body.id, writeOff.body.version);
      expect(postedWriteOff.body.postingStatus).toBe('POSTED');

      const writeOffGl = await journalFor(INVENTORY_ADJUSTMENT_TYPE, writeOff.body.id);
      expect(writeOffGl).not.toBeNull();
      expect(writeOffGl!.debit).toBeCloseTo(writeOffGl!.credit, 2);
      expect(writeOffGl!.debit).toBeCloseTo(45, 2); // 5 @ 9

      const surplus = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-adjustments`))
        .send({ documentDate: '2026-02-24', warehouseId, adjustmentType: 'SURPLUS', lines: [{ productId, unitId, quantity: 3 }] })
        .expect(201);
      const postedSurplus = await postDocument(INVENTORY_ADJUSTMENT_TYPE, surplus.body.id, surplus.body.version);
      expect(postedSurplus.body.postingStatus).toBe('POSTED');

      const surplusGl = await journalFor(INVENTORY_ADJUSTMENT_TYPE, surplus.body.id);
      expect(surplusGl).not.toBeNull();
      expect(surplusGl!.debit).toBeCloseTo(surplusGl!.credit, 2);
      expect(surplusGl!.debit).toBeCloseTo(27, 2); // 3 @ current pool cost (9)
    });
  });

  // ---------------------------------------------------------------------
  // Manual Inventory Cost Adjustment
  // ---------------------------------------------------------------------

  it('splits a manual cost adjustment between on-hand value and COGS by remaining-vs-consumed FIFO layer quantity, and posts a balanced GL entry', async () => {
    const productId = await createProduct(`MANUALADJ-${run}`);
    const receipt = await receiveGoods(productId, 100, 10, '2026-02-25'); // layer: 100 @ 10 = 1000

    // Consume 40 — layer now 60 remaining / 40 consumed.
    const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
      .send({ documentDate: '2026-02-26', counterpartyId: customerId, warehouseId, lines: [{ productId, unitId, quantity: '40' }] })
      .expect(201);
    await postDocument(SHIPMENT_TYPE, shipment.body.id, shipment.body.version);

    // A late supplier invoice adds 100 to this receipt's landed cost —
    // 60% still on hand (raises the layer's value), 40% already sold
    // (a retroactive COGS adjustment) — spec's own critical "never dump
    // it all onto current stock when part is already sold" rule.
    const adjustment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-cost-adjustments`))
      .send({ documentDate: '2026-02-27', reason: 'LATE_INVOICE_DIFFERENCE', lines: [{ productId, warehouseId, sourceReceiptLineId: receipt.lineId, amount: 100 }] })
      .expect(201);
    const line = adjustment.body.lines[0];
    expect(Number(line.onHandAmount)).toBeCloseTo(60, 2);
    expect(Number(line.cogsAmount)).toBeCloseTo(40, 2);

    const posted = await postDocument(INVENTORY_COST_ADJUSTMENT_TYPE, adjustment.body.id, adjustment.body.version);
    expect(posted.body.postingStatus).toBe('POSTED');

    const gl = await journalFor(INVENTORY_COST_ADJUSTMENT_TYPE, adjustment.body.id);
    expect(gl).not.toBeNull();
    expect(gl!.debit).toBeCloseTo(gl!.credit, 2);
    expect(gl!.debit).toBeCloseTo(100, 2); // 60 (inventory) + 40 (COGS), both Dr sides
  });

  // ---------------------------------------------------------------------
  // Backdated recalculation
  // ---------------------------------------------------------------------

  it('queues a backdated-movement recalculation and processes it without duplicating already-correct movements', async () => {
    const productId = await createProduct(`BACKDATE-${run}`);
    await receiveGoods(productId, 50, 10, '2026-02-28'); // establishes the "later" movement

    // A goods receipt dated BEFORE the one above lands after it in wall-
    // clock/posting order — this must flag a recalculation, never silently
    // leave FIFO order wrong.
    await receiveGoods(productId, 20, 8, '2026-02-27');

    const queueEntry = await prisma.inventoryCostRecalculationQueue.findFirst({ where: { tenantId: tenant1Id } });
    expect(queueEntry).not.toBeNull();
    expect(queueEntry!.status).toBe('PENDING');

    const run1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-costing/calculations/recalculate`)).expect(201);
    expect(run1.body.processedKeys).toBeGreaterThanOrEqual(1);

    const queueAfter = await prisma.inventoryCostRecalculationQueue.findMany({ where: { tenantId: tenant1Id, id: queueEntry!.id } });
    expect(queueAfter[0].status).toBe('COMPLETED');

    // Layers rebuilt in correct chronological order: the 2026-02-27 (8/unit)
    // receipt is now the OLDEST layer, not the second one.
    const layers = await prisma.inventoryCostLayer.findMany({ where: { tenantId: tenant1Id, productId }, orderBy: [{ receiptDate: 'asc' }] });
    expect(layers).toHaveLength(2);
    expect(layers[0].originalUnitCost.toString()).toBe('8');
    expect(layers[1].originalUnitCost.toString()).toBe('10');
  });

  // ---------------------------------------------------------------------
  // Costing period finalize / reopen
  // ---------------------------------------------------------------------

  it('blocks a costing-affecting posting into an already-finalized period, then allows it again after reopen', async () => {
    const productId = await createProduct(`PERIOD-${run}`);
    await receiveGoods(productId, 10, 5, '2026-04-05');

    const finalized = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-costing/periods/2026/4/finalize`)).expect(201);
    expect(finalized.body.status).toBe('FINALIZED');

    const blockedReceipt = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
      .send({ counterpartyId: supplierId, warehouseId, documentDate: '2026-04-10', lines: [{ productId, unitId, quantity: 5, price: 5 }] })
      .expect(201);
    const blockedPost = await auth1(request(app.getHttpServer()).post(`/documents/${GOODS_RECEIPT_TYPE}/${blockedReceipt.body.id}/post`)).send({ expectedVersion: blockedReceipt.body.version });
    expect(blockedPost.status).toBe(409);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-costing/periods/2026/4/reopen`))
      .send({ reason: 'Late correction needed' })
      .expect(201);

    const allowedPost = await postDocument(GOODS_RECEIPT_TYPE, blockedReceipt.body.id, blockedReceipt.body.version);
    expect(allowedPost.body.postingStatus).toBe('POSTED');
  });

  // ---------------------------------------------------------------------
  // Negative-stock costing policy — never blocks the physical posting
  // ---------------------------------------------------------------------

  it('never blocks the physical stock-out when a costing policy allows negative-quantity costing, recording a provisional cost instead', async () => {
    const productId = await createProduct(`NEGSTOCK-${run}`);
    const whNeg = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: `WH-NEG-${run}`, name: 'Negative Stock Warehouse', allowNegativeStock: true })
      .expect(201);
    await receiveGoods(productId, 5, 4, '2026-02-28');

    const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
      .send({ documentDate: '2026-03-01', counterpartyId: customerId, warehouseId: whNeg.body.id, lines: [{ productId, unitId, quantity: '3', warehouseId: whNeg.body.id }] })
      .expect(201);
    const posted = await postDocument(SHIPMENT_TYPE, shipment.body.id, shipment.body.version);
    // No stock ever existed in whNeg for this product — the FIFO strategy
    // has no eligible layer there, so the policy's allowNegativeQuantityCosting
    // (default true) falls back to a provisional cost rather than throwing.
    expect(posted.body.postingStatus).toBe('POSTED');

    const movement = await prisma.inventoryCostMovement.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: SHIPMENT_TYPE, sourceDocumentId: shipment.body.id } });
    expect(movement).not.toBeNull();
    expect(movement!.costStatus).toBe('PROVISIONAL');
  });

  // ---------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------

  it('surfaces COGS report rows and a healthy status once every fixture above is accounted for', async () => {
    const cogs = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-costing/cogs`)).expect(200);
    expect(Array.isArray(cogs.body)).toBe(true);
    expect(cogs.body.length).toBeGreaterThan(0);

    const health = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-costing/health`)).expect(200);
    expect(health.body.uncostedMovementsWithActivePolicy).toBe(0);
  });
});
