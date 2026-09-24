/**
 * Inventory Costing Engine E2E tests (docx spec Phase 11 — "maya dəyəri").
 *
 * Covers the spec's own test list (sections 119-135) end to end through
 * the real posting handlers (Goods Receipt, Shipment, Sales Invoice,
 * Sales Return, Purchase Return, Additional Purchase Cost, Purchase
 * Invoice, Warehouse Transfer, Inventory Adjustment, Internal
 * Consumption) and the costing API:
 *   FIFO basic/partial + traceability, late additional cost split between
 *   COGS and on-hand stock (+ idempotent re-run), sales return at original
 *   shipment cost, purchase return at the source layer's adjusted cost,
 *   invoice price difference, backdated FIFO recalculation with exactly one
 *   delta adjustment, negative-stock provisional cost settled by a later
 *   receipt, weighted average (moving + periodic month close), transfer
 *   cost preservation, write-off / internal consumption at actual cost,
 *   rounding, idempotency, subledger vs GL reconciliation, period
 *   finalization blocked by pending recalculation then succeeding,
 *   finalized-period protection + audited reopen, ownership scope,
 *   unpost dependency block, permissions and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { AccountingPostingEngine } from '../src/accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../src/accounting-core/accounting-mapping.service';
import { InventoryCostingService } from '../src/inventory-costing/inventory-costing.service';

describe('Inventory Costing Engine (e2e, Phase 11)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now();

  let token: string;
  let tenantId: string;
  let token2: string;
  let tenant2Id: string;
  let unitId: string;

  // FIFO organization (organization-level cost pool)
  let fifoOrg: string;
  let fifoWh: string;
  let fifoNegWh: string;
  let supplierF: string;
  let customerF: string;

  // Weighted-average (periodic) organization
  let waOrg: string;
  let waWh: string;
  let supplierW: string;
  let customerW: string;

  // FIFO by-warehouse organization (transfers, write-off, consumption, ownership)
  let whOrg: string;
  let whA: string;
  let whB: string;
  let supplierH: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`cost1-${run}@e2e.test`, `cost-t1-${run}`);
    token = s1.token;
    tenantId = s1.tenantId;
    const s2 = await setupTenant(`cost2-${run}@e2e.test`, `cost-t2-${run}`);
    token2 = s2.token;
    tenant2Id = s2.tenantId;

    await app.get(ChartOfAccountsService).ensureAdopted(tenantId);
    await app.get(AzTaxLocalizationService).ensureSeeded();

    unitId = (await auth(request(app.getHttpServer()).post('/units-of-measure')).send({ code: 'PCS11', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' }).expect(201)).body.id;

    fifoOrg = await createOrg('C11F');
    fifoWh = await createWarehouse(fifoOrg, 'WH-F');
    fifoNegWh = await createWarehouse(fifoOrg, 'WH-FNEG', true);
    supplierF = await createCounterparty(fifoOrg, 'SUPPLIER', 'SUP-F');
    customerF = await createCounterparty(fifoOrg, 'CUSTOMER', 'CUS-F');

    waOrg = await createOrg('C11W');
    waWh = await createWarehouse(waOrg, 'WH-W');
    supplierW = await createCounterparty(waOrg, 'SUPPLIER', 'SUP-W');
    customerW = await createCounterparty(waOrg, 'CUSTOMER', 'CUS-W');

    whOrg = await createOrg('C11H');
    whA = await createWarehouse(whOrg, 'WH-HA');
    whB = await createWarehouse(whOrg, 'WH-HB');
    supplierH = await createCounterparty(whOrg, 'SUPPLIER', 'SUP-H');

    await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/inventory-costing/policies`)).send({ effectiveFrom: '2026-01-01', costingMethod: 'FIFO', negativeStockCostPolicy: 'LAST_KNOWN_COST' }).expect(201);
    await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-costing/policies`))
      .send({ effectiveFrom: '2026-08-01', costingMethod: 'WEIGHTED_AVERAGE', averageMethod: 'PERIODIC_WEIGHTED_AVERAGE', recalculateBackdatedDocuments: false })
      .expect(201);
    await auth(request(app.getHttpServer()).post(`/organizations/${whOrg}/inventory-costing/policies`)).send({ effectiveFrom: '2026-01-01', costingMethod: 'FIFO', costByWarehouse: true }).expect(201);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ helpers

  async function setupTenant(email: string, code: string) {
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Cost User' }).expect(201);
    const t = await request(app.getHttpServer()).post('/tenants').set('Authorization', `Bearer ${reg.body.accessToken}`).send({ code, name: `${code} Corp`, baseCurrencyCode: 'USD' }).expect(201);
    return { token: reg.body.accessToken as string, tenantId: t.body.id as string };
  }
  function auth(req: request.Test) {
    return req.set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenantId);
  }
  async function createOrg(code: string) {
    return (await auth(request(app.getHttpServer()).post('/organizations')).send({ code: `${code}-${run % 100000}`, name: `${code} Org` }).expect(201)).body.id as string;
  }
  async function createWarehouse(orgId: string, code: string, allowNegativeStock = false) {
    return (await auth(request(app.getHttpServer()).post(`/organizations/${orgId}/warehouses`)).send({ code, name: code, allowNegativeStock }).expect(201)).body.id as string;
  }
  async function createCounterparty(orgId: string, counterpartyType: string, code: string) {
    return (await auth(request(app.getHttpServer()).post(`/organizations/${orgId}/counterparties`)).send({ counterpartyType, code, name: code, creditLimit: 100000000 }).expect(201)).body.id as string;
  }
  let productSeq = 0;
  async function createProduct(orgId: string) {
    productSeq += 1;
    return (await auth(request(app.getHttpServer()).post(`/organizations/${orgId}/products`)).send({ code: `P11-${productSeq}`, name: `Costed product ${productSeq}`, productType: 'GOODS', baseUnitId: unitId }).expect(201)).body.id as string;
  }
  async function post(type: string, id: string, version?: number, expectStatus = 201) {
    const v = version ?? (await prisma.$queryRawUnsafe<{ version: number }[]>(`SELECT version FROM ${tableOf(type)} WHERE id = $1`, id))[0].version;
    return auth(request(app.getHttpServer()).post(`/documents/${type}/${id}/post`)).send({ expectedVersion: v }).expect(expectStatus);
  }
  async function unpost(type: string, id: string, expectStatus = 201) {
    const v = (await prisma.$queryRawUnsafe<{ version: number }[]>(`SELECT version FROM ${tableOf(type)} WHERE id = $1`, id))[0].version;
    return auth(request(app.getHttpServer()).post(`/documents/${type}/${id}/unpost`)).send({ expectedVersion: v }).expect(expectStatus);
  }
  function tableOf(type: string) {
    return {
      GOODS_RECEIPT: 'goods_receipts',
      SHIPMENT: 'shipments',
      SALES_INVOICE: 'sales_invoices',
      SALES_RETURN: 'sales_returns',
      PURCHASE_RETURN: 'purchase_returns',
      PURCHASE_INVOICE: 'purchase_invoices',
      ADDITIONAL_PURCHASE_COST: 'additional_purchase_costs',
      WAREHOUSE_TRANSFER: 'warehouse_transfers',
      INVENTORY_ADJUSTMENT: 'inventory_adjustments',
      INTERNAL_CONSUMPTION: 'internal_consumptions',
    }[type]!;
  }
  async function receipt(orgId: string, warehouseId: string, supplierId: string, date: string, lines: { productId: string; quantity: number; price: number }[]) {
    const gr = await auth(request(app.getHttpServer()).post(`/organizations/${orgId}/goods-receipts`))
      .send({ counterpartyId: supplierId, warehouseId, documentDate: date, lines: lines.map((l) => ({ ...l, unitId })) })
      .expect(201);
    await post('GOODS_RECEIPT', gr.body.id, gr.body.version);
    return gr.body as { id: string; lines: { id: string; productId: string }[] };
  }
  async function shipment(orgId: string, warehouseId: string, customerId: string, date: string, lines: { productId: string; quantity: number }[], expectStatus = 201) {
    const sh = await auth(request(app.getHttpServer()).post(`/organizations/${orgId}/shipments`))
      .send({ counterpartyId: customerId, warehouseId, documentDate: date, lines: lines.map((l) => ({ productId: l.productId, unitId, quantity: String(l.quantity) })) })
      .expect(201);
    await post('SHIPMENT', sh.body.id, sh.body.version, expectStatus);
    return sh.body as { id: string; lines: { id: string }[] };
  }
  async function docCost(type: string, id: string) {
    const rows = await prisma.inventoryCostMovement.findMany({ where: { tenantId, sourceDocumentType: type, sourceDocumentId: id } });
    return rows.reduce((s, r) => s + Number(r.totalCost), 0);
  }
  async function journalByCode(type: string, id: string) {
    const entry = await prisma.journalEntry.findFirst({ where: { tenantId, sourceDocumentType: type, sourceDocumentId: id, status: 'POSTED' }, include: { lines: { include: { account: true } } } });
    const byCode: Record<string, number> = {};
    let debit = 0;
    let credit = 0;
    for (const l of entry?.lines ?? []) {
      const amt = Number(l.amountBase);
      byCode[l.account.code] = (byCode[l.account.code] ?? 0) + (l.side === 'DEBIT' ? amt : -amt);
      if (l.side === 'DEBIT') debit += amt;
      else credit += amt;
    }
    return { entry, byCode, debit, credit };
  }
  async function adjustmentsFor(sourceId: string) {
    return prisma.inventoryCostAdjustment.findMany({ where: { tenantId, sourceDocumentId: sourceId }, include: { lines: true } });
  }
  async function valuation(orgId: string, productId: string, extra = '') {
    return (await auth(request(app.getHttpServer()).get(`/organizations/${orgId}/inventory-costing/valuation?productId=${productId}${extra}`)).expect(200)).body;
  }

  // ------------------------------------------------------------------ FIFO

  describe('FIFO (spec 8-11, 119-120, 141) — layers, consumption, COGS posting, traceability', () => {
    let productId: string;
    let gr1: { id: string; lines: { id: string }[] };
    let gr2: { id: string; lines: { id: string }[] };
    let sh: { id: string; lines: { id: string }[] };

    it('Receipt 100@10 + 100@12, shipment 150 => COGS 1,600 (Dr 701 / Cr 205), remaining 50 @ 12 = 600, drill-down to both receipts', async () => {
      productId = await createProduct(fifoOrg);
      gr1 = await receipt(fifoOrg, fifoWh, supplierF, '2026-01-02', [{ productId, quantity: 100, price: 10 }]);
      gr2 = await receipt(fifoOrg, fifoWh, supplierF, '2026-01-03', [{ productId, quantity: 100, price: 12 }]);

      const layers = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/layers?productId=${productId}`)).expect(200)).body;
      expect(layers).toHaveLength(2);
      expect(layers.map((l: any) => Number(l.currentUnitCost))).toEqual([10, 12]);

      sh = await shipment(fifoOrg, fifoWh, customerF, '2026-01-05', [{ productId, quantity: 150 }]);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-1600, 2);

      const gl = await journalByCode('SHIPMENT', sh.id);
      expect(gl.debit).toBeCloseTo(gl.credit, 2);
      expect(gl.byCode['701']).toBeCloseTo(1600, 2);
      expect(gl.byCode['205']).toBeCloseTo(-1600, 2);

      const v = await valuation(fifoOrg, productId);
      expect(Number(v.rows[0].financialQuantity)).toBeCloseTo(50, 6);
      expect(Number(v.rows[0].inventoryValue)).toBeCloseTo(600, 2);

      const trace = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/trace?documentType=SHIPMENT&documentId=${sh.id}`)).expect(200)).body;
      const sources = trace[0].costSources.map((c: any) => ({ doc: c.receiptDocumentId, qty: Number(c.quantity), unit: Number(c.unitCost) }));
      expect(sources).toEqual([
        { doc: gr1.id, qty: 100, unit: 10 },
        { doc: gr2.id, qty: 50, unit: 12 },
      ]);
    });

    it('rejects unposting a receipt whose FIFO layer was already consumed (spec 110 dependency block)', async () => {
      const res = await unpost('GOODS_RECEIPT', gr1.id, 409);
      expect(res.body.code).toBe('INVENTORY_COST_DEPENDENCY');
    });

    it('late transport cost 200 (100 per receipt) is split: COGS +150 (sold units), inventory +50 (on hand) — spec 19, 72, 123, 141', async () => {
      const apc = await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/additional-purchase-costs`))
        .send({ counterpartyId: supplierF, documentDate: '2026-01-10', costType: 'TRANSPORT', allocationMethod: 'BY_QUANTITY', totalCost: 200, targetLines: [{ goodsReceiptLineId: gr1.lines[0].id }, { goodsReceiptLineId: gr2.lines[0].id }] })
        .expect(201);
      await post('ADDITIONAL_PURCHASE_COST', apc.body.id, apc.body.version);

      const layers = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/layers?productId=${productId}`)).expect(200)).body;
      expect(layers.map((l: any) => Number(l.currentUnitCost))).toEqual([11, 13]);
      expect(Number(layers[1].remainingValue)).toBeCloseTo(650, 2);

      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-1750, 2);
      const adjustments = await adjustmentsFor(apc.body.id);
      expect(adjustments).toHaveLength(1);
      expect(Number(adjustments[0].cogsImpact)).toBeCloseTo(150, 2);
      const adjGl = await journalByCode('INVENTORY_COST_ADJUSTMENT', adjustments[0].id);
      expect(adjGl.byCode['701']).toBeCloseTo(150, 2);
      expect(adjGl.byCode['205']).toBeCloseTo(-150, 2);

      // Cost component traceability (spec 23): the receipt layer shows base + transport.
      const card = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/layers/${layers[1].id}`)).expect(200)).body;
      const comps = card.costComponents.map((c: any) => [c.componentType, Number(c.allocatedAmount)]);
      expect(comps).toEqual(expect.arrayContaining([['BASE_PRICE', 1200], ['TRANSPORT', 100]]));
      expect(card.consumedBy[0].documentId).toBe(sh.id);
    });

    it('recalculating again without any source change books no additional adjustment (spec 131 idempotency)', async () => {
      const before = await prisma.inventoryCostAdjustment.count({ where: { tenantId, organizationId: fifoOrg } });
      await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/inventory-costing/calculations/recalculate`)).send({ fullRebuild: true }).expect(201);
      await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/inventory-costing/calculations/recalculate`)).send({ fullRebuild: true }).expect(201);
      const after = await prisma.inventoryCostAdjustment.count({ where: { tenantId, organizationId: fifoOrg } });
      expect(after).toBe(before);
      expect(await prisma.inventoryCostLayer.count({ where: { tenantId, sourceDocumentId: gr1.id } })).toBe(1);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-1750, 2);
    });

    it('re-delivering the same posting event creates no duplicate cost layer (spec 93, 130)', async () => {
      const costing = app.get(InventoryCostingService);
      await prisma.runInTransaction(async (tx) => {
        await costing.onDocumentPosted(tenantId, 'GOODS_RECEIPT', gr2.id, tx, 'test');
        await costing.onDocumentPosted(tenantId, 'GOODS_RECEIPT', gr2.id, tx, 'test');
      });
      expect(await prisma.inventoryCostLayer.count({ where: { tenantId, sourceDocumentId: gr2.id } })).toBe(1);
      expect(await prisma.inventoryCostMovement.count({ where: { tenantId, sourceDocumentId: gr2.id } })).toBe(1);
    });

    it('sales return restores the ORIGINAL shipment cost, not the current cost (spec 26, 124, 141)', async () => {
      const invoice = await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/sales-invoices`))
        .send({ counterpartyId: customerF, documentDate: '2026-01-11', lines: [{ productId, unitId, quantity: 150, price: 20, sourceShipmentLineId: sh.lines[0].id }] })
        .expect(201);
      await post('SALES_INVOICE', invoice.body.id, invoice.body.version);
      // No second COGS from the invoice — COGS is recognized at shipment.
      const invGl = await journalByCode('SALES_INVOICE', invoice.body.id);
      expect(invGl.byCode['701']).toBeUndefined();

      const ret = await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/sales-returns`))
        .send({ documentDate: '2026-01-12', counterpartyId: customerF, originalSalesInvoiceId: invoice.body.id, warehouseId: fifoWh, returnType: 'PHYSICAL_RETURN', lines: [{ sourceInvoiceLineId: invoice.body.lines[0].id, productId, unitId, quantity: '10' }] })
        .expect(201);
      await post('SALES_RETURN', ret.body.id, ret.body.version);

      // shipment cost 1,750 / 150 units => 10 units = 116.67 (never the current 13).
      expect(await docCost('SALES_RETURN', ret.body.id)).toBeCloseTo(116.67, 2);
      const gl = await journalByCode('SALES_RETURN', ret.body.id);
      expect(gl.debit).toBeCloseTo(gl.credit, 2);
      expect(gl.byCode['701']).toBeCloseTo(-116.67, 2);
    });

    it('COGS report joins shipment cost with invoiced revenue (spec 78)', async () => {
      const report = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/cogs?productId=${productId}`)).expect(200)).body;
      const shipRow = report.rows.find((r: any) => r.salesDocumentId === sh.id);
      expect(Number(shipRow.quantitySold)).toBeCloseTo(150, 6);
      expect(Number(shipRow.revenue)).toBeCloseTo(3000, 2);
      expect(Number(shipRow.cogs)).toBeCloseTo(1750, 2);
      expect(Number(shipRow.grossProfit)).toBeCloseTo(1250, 2);
      expect(shipRow.customerId).toBe(customerF);
    });

    it('purchase return linked to receipt #2 leaves at that layer\'s adjusted cost 20 x 13 = 260 (spec 28-29, 125), variance to 731', async () => {
      const ret = await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/purchase-returns`))
        .send({ counterpartyId: supplierF, documentDate: '2026-01-13', originalGoodsReceiptId: gr2.id, warehouseId: fifoWh, lines: [{ sourceReceiptLineId: gr2.lines[0].id, productId, unitId, quantity: 20, originalUnitPrice: 12 }] })
        .expect(201);
      await post('PURCHASE_RETURN', ret.body.id, ret.body.version);
      expect(await docCost('PURCHASE_RETURN', ret.body.id)).toBeCloseTo(-260, 2);
      const gl = await journalByCode('PURCHASE_RETURN', ret.body.id);
      expect(gl.debit).toBeCloseTo(gl.credit, 2);
      expect(gl.byCode['205']).toBeCloseTo(-260, 2);
      expect(gl.byCode['538']).toBeCloseTo(240, 2); // GRNI reversed at document price
      expect(gl.byCode['731']).toBeCloseTo(20, 2); // capitalized freight reversed proportionally
    });

    it('subledger reconciles with the GL (spec 63, 132) and flags a 50 difference as an accounting imbalance', async () => {
      const recon = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/reconciliation?asOfDate=2026-01-31`)).expect(200)).body;
      expect(recon.value.healthy).toBe(true);
      expect(Number(recon.value.subledgerValue)).toBeCloseTo(506.67, 2); // 30 @ 13 + 10 @ 11.667
      expect(recon.quantity.every((q: any) => q.quantityMatches)).toBe(true);

      const mappings = app.get(AccountingMappingService);
      const inv = await mappings.resolve(tenantId, fifoOrg, 'GOODS_INVENTORY', new Date('2026-01-31'));
      const exp = await mappings.resolve(tenantId, fifoOrg, 'OTHER_OPERATING_EXPENSE', new Date('2026-01-31'));
      await app.get(AccountingPostingEngine).postBatch(tenantId, 'test', {
        organizationId: fifoOrg,
        businessDate: new Date('2026-01-31'),
        description: 'Unreconciled manual inventory credit',
        lines: [
          { accountId: exp.id, side: 'DEBIT', amountBase: 50 },
          { accountId: inv.id, side: 'CREDIT', amountBase: 50, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: productId }, { dimensionCode: 'WAREHOUSE', referenceId: fifoWh }] },
        ],
      });
      const health = (await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/health?asOfDate=2026-01-31`)).expect(200)).body;
      expect(health.healthy).toBe(false);
      const imbalance = health.issues.find((i: any) => i.check === 'ACCOUNTING_IMBALANCE');
      expect(Number(imbalance.details.difference)).toBeCloseTo(-50, 2);
    });
  });

  describe('Purchase invoice price difference (spec 18) — GRNI cleared at receipt value, difference split sold/on-hand', () => {
    it('receipt 100 @ 10 provisional, 40 sold, invoice @ 11: inventory +100 on the invoice, COGS +40 / inventory -40 adjustment, receipt cost FINAL', async () => {
      const productId = await createProduct(fifoOrg);
      const gr = await receipt(fifoOrg, fifoWh, supplierF, '2026-01-15', [{ productId, quantity: 100, price: 10 }]);
      const grRow = await prisma.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentId: gr.id } });
      expect(grRow!.costStatus).toBe('PROVISIONAL');
      const sh = await shipment(fifoOrg, fifoWh, customerF, '2026-01-16', [{ productId, quantity: 40 }]);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-400, 2);

      const inv = await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/purchase-invoices`))
        .send({ counterpartyId: supplierF, documentDate: '2026-01-20', supplierInvoiceNumber: `INV-PD-${run}`, goodsReceiptId: gr.id, lines: [{ productId, unitId, quantity: 100, price: 11, goodsReceiptLineId: gr.lines[0].id }] })
        .expect(201);
      const fresh = await auth(request(app.getHttpServer()).get(`/organizations/${fifoOrg}/purchase-invoices/${inv.body.id}`)).expect(200);
      if (fresh.body.approvalStatus === 'PENDING') {
        await prisma.purchaseInvoice.update({ where: { id: inv.body.id }, data: { approvalStatus: 'APPROVED' } });
      }
      await post('PURCHASE_INVOICE', inv.body.id);

      const gl = await journalByCode('PURCHASE_INVOICE', inv.body.id);
      expect(gl.debit).toBeCloseTo(gl.credit, 2);
      expect(gl.byCode['538']).toBeCloseTo(1000, 2); // GRNI cleared at exactly the receipt's value
      expect(gl.byCode['205']).toBeCloseTo(100, 2); // price difference to inventory

      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-440, 2);
      const adjustments = await adjustmentsFor(inv.body.id);
      expect(adjustments.reduce((s, a) => s + Number(a.cogsImpact), 0)).toBeCloseTo(40, 2);
      const grAfter = await prisma.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentId: gr.id } });
      expect(grAfter!.costStatus).toBe('FINAL');
      expect(Number(grAfter!.totalCost)).toBeCloseTo(1100, 2);
      const v = await valuation(fifoOrg, productId);
      expect(Number(v.rows[0].inventoryValue)).toBeCloseTo(660, 2); // 60 @ 11
    });
  });

  describe('Backdated FIFO receipt (spec 46-48, 127)', () => {
    it('re-costs the later shipment from the earliest affected date and books exactly one delta adjustment', async () => {
      const productId = await createProduct(fifoOrg);
      await receipt(fifoOrg, fifoWh, supplierF, '2026-01-05', [{ productId, quantity: 100, price: 10 }]);
      const sh = await shipment(fifoOrg, fifoWh, customerF, '2026-01-10', [{ productId, quantity: 100 }]);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-1000, 2);

      const backdated = await receipt(fifoOrg, fifoWh, supplierF, '2026-01-03', [{ productId, quantity: 100, price: 5 }]);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-500, 2); // FIFO now consumes the Jan 3 layer

      const requests = await prisma.inventoryCostRecalculationRequest.findMany({ where: { tenantId, sourceDocumentId: backdated.id } });
      expect(requests).toHaveLength(1);
      expect(requests[0].earliestAffectedDate.toISOString().slice(0, 10)).toBe('2026-01-03');
      const runRow = await prisma.inventoryCostCalculationRun.findFirst({ where: { tenantId, sourceDocumentId: backdated.id } });
      expect(runRow!.calculationType).toBe('BACKDATED_RECALCULATION');

      const adjustments = await adjustmentsFor(backdated.id);
      expect(adjustments).toHaveLength(1);
      expect(Number(adjustments[0].cogsImpact)).toBeCloseTo(-500, 2);
      const gl = await journalByCode('INVENTORY_COST_ADJUSTMENT', adjustments[0].id);
      expect(gl.byCode['701']).toBeCloseTo(-500, 2);
      expect(gl.byCode['205']).toBeCloseTo(500, 2);

      const line = adjustments[0].lines[0];
      expect(Number(line.oldCost)).toBeCloseTo(1000, 2);
      expect(Number(line.newCost)).toBeCloseTo(500, 2);
    });
  });

  describe('Negative stock costing (spec 52-54, 128)', () => {
    it('issues 10 with no stock at LAST_KNOWN_COST 12 (provisional COGS 120); a later receipt 10 @ 15 books exactly +30 COGS', async () => {
      const productId = await createProduct(fifoOrg);
      await receipt(fifoOrg, fifoNegWh, supplierF, '2026-01-02', [{ productId, quantity: 10, price: 12 }]);
      await shipment(fifoOrg, fifoNegWh, customerF, '2026-01-03', [{ productId, quantity: 10 }]);
      const sh = await shipment(fifoOrg, fifoNegWh, customerF, '2026-01-04', [{ productId, quantity: 10 }]);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-120, 2);
      const row = await prisma.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentId: sh.id } });
      expect(row!.costStatus).toBe('PROVISIONAL');
      expect(Number(row!.deficitQuantity)).toBeCloseTo(10, 6);

      const gr = await receipt(fifoOrg, fifoNegWh, supplierF, '2026-01-06', [{ productId, quantity: 10, price: 15 }]);
      expect(await docCost('SHIPMENT', sh.id)).toBeCloseTo(-150, 2);
      const adjustments = await adjustmentsFor(gr.id);
      expect(adjustments).toHaveLength(1);
      expect(Number(adjustments[0].cogsImpact)).toBeCloseTo(30, 2);
      const v = await valuation(fifoOrg, productId);
      expect(Number(v.rows[0].financialQuantity)).toBeCloseTo(0, 6);
      expect(Number(v.rows[0].inventoryValue)).toBeCloseTo(0, 2);

      // Unposting the shipment reverses its own COGS entry AND the +30
      // adjustment booked on top of it (spec 109) — cost returns to stock.
      await unpost('SHIPMENT', sh.id);
      expect(await prisma.inventoryCostMovement.count({ where: { tenantId, sourceDocumentId: sh.id } })).toBe(0);
      const reversal = await prisma.inventoryCostAdjustment.findFirst({ where: { tenantId, sourceDocumentId: sh.id, reason: 'UNPOST_REVERSAL' } });
      expect(Number(reversal!.inventoryImpact)).toBeCloseTo(30, 2);
      const after = await valuation(fifoOrg, productId);
      expect(Number(after.rows[0].financialQuantity)).toBeCloseTo(10, 6);
      expect(Number(after.rows[0].inventoryValue)).toBeCloseTo(150, 2);
    });
  });

  describe('Rounding (spec 51, 129)', () => {
    it('allocates 100 across 3 equal receipt lines with no lost cent', async () => {
      const p1 = await createProduct(fifoOrg);
      const p2 = await createProduct(fifoOrg);
      const p3 = await createProduct(fifoOrg);
      const gr = await receipt(fifoOrg, fifoWh, supplierF, '2026-01-20', [
        { productId: p1, quantity: 1, price: 10 },
        { productId: p2, quantity: 1, price: 10 },
        { productId: p3, quantity: 1, price: 10 },
      ]);
      const apc = await auth(request(app.getHttpServer()).post(`/organizations/${fifoOrg}/additional-purchase-costs`))
        .send({ counterpartyId: supplierF, documentDate: '2026-01-21', costType: 'CUSTOMS', allocationMethod: 'EQUALLY', totalCost: 100, targetLines: gr.lines.map((l) => ({ goodsReceiptLineId: l.id })) })
        .expect(201);
      await post('ADDITIONAL_PURCHASE_COST', apc.body.id, apc.body.version);
      const components = await prisma.inventoryCostComponent.findMany({ where: { tenantId, componentType: 'CUSTOMS', sourceDocumentId: apc.body.id } });
      expect(components).toHaveLength(3);
      const sum = components.reduce((s, c) => s + Math.round(Number(c.allocatedAmount) * 100), 0);
      expect(sum).toBe(10000);
    });
  });

  // ------------------------------------------------------------------ Weighted average + period close

  describe('Weighted average + periodic month close (spec 12-14, 47, 57-59, 121, 133-134)', () => {
    let productId: string;
    let shEarly: { id: string };
    let shLate: { id: string };

    it('opening 100 @ 10 + receipt 100 @ 14 => quantity 200, value 2,400, average 12', async () => {
      productId = await createProduct(waOrg);
      const opening = await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-adjustments`))
        .send({ warehouseId: waWh, adjustmentType: 'OPENING_BALANCE', documentDate: '2026-08-01', lines: [{ productId, unitId, quantity: 100, costReference: 1000 }] })
        .expect(201);
      await post('INVENTORY_ADJUSTMENT', opening.body.id, opening.body.version);
      await receipt(waOrg, waWh, supplierW, '2026-08-20', [{ productId, quantity: 100, price: 14 }]);
      const v = await valuation(waOrg, productId, '&asOfDate=2026-08-20');
      expect(Number(v.rows[0].financialQuantity)).toBeCloseTo(200, 6);
      expect(Number(v.rows[0].inventoryValue)).toBeCloseTo(2400, 2);
      expect(Number(v.rows[0].unitCost)).toBeCloseTo(12, 6);
      expect(v.costingMethod).toBe('WEIGHTED_AVERAGE');

      shLate = await shipment(waOrg, waWh, customerW, '2026-08-25', [{ productId, quantity: 50 }]);
      expect(await docCost('SHIPMENT', shLate.id)).toBeCloseTo(-600, 2);
    });

    it('a backdated shipment under a deferred policy queues a recalculation; finalization is blocked until it is processed', async () => {
      shEarly = await shipment(waOrg, waWh, customerW, '2026-08-10', [{ productId, quantity: 50 }]);
      const row = await prisma.inventoryCostMovement.findFirst({ where: { tenantId, sourceDocumentId: shEarly.id } });
      expect(row!.costStatus).toBe('RECALCULATION_REQUIRED');
      expect(await prisma.inventoryCostRecalculationRequest.count({ where: { tenantId, organizationId: waOrg, status: 'PENDING' } })).toBe(1);

      const blocked = await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-costing/calculations/finalize`)).send({ period: '2026-08' }).expect(422);
      expect(blocked.body.code).toBe('INVENTORY_COSTING_FINALIZATION_BLOCKED');
      expect(JSON.stringify(blocked.body)).toContain('PENDING_RECALCULATION');

      await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-costing/calculations/provisional`)).send({}).expect(201);
      // Moving average provisionally: Aug 10 issue at 10 (before the Aug 20 receipt).
      expect(await docCost('SHIPMENT', shEarly.id)).toBeCloseTo(-500, 2);
      expect(await prisma.inventoryCostRecalculationRequest.count({ where: { tenantId, organizationId: waOrg, status: 'PENDING' } })).toBe(0);
    });

    it('finalize preview shows the projected periodic-average COGS without posting anything', async () => {
      const journalsBefore = await prisma.journalEntry.count({ where: { tenantId, organizationId: waOrg } });
      const preview = (await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-costing/calculations/finalize-preview`)).send({ period: '2026-08' }).expect(201)).body;
      expect(Number(preview.projectedFinalCogs)).toBeCloseTo(1200, 2);
      expect(await prisma.journalEntry.count({ where: { tenantId, organizationId: waOrg } })).toBe(journalsBefore);
      expect(await docCost('SHIPMENT', shEarly.id)).toBeCloseTo(-500, 2);
    });

    it('finalization re-values every August issue at the periodic average 12 and marks the period FINALIZED with a snapshot', async () => {
      const finalized = (await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-costing/calculations/finalize`)).send({ period: '2026-08' }).expect(201)).body;
      expect(finalized.status).toBe('FINALIZED');
      expect(await docCost('SHIPMENT', shEarly.id)).toBeCloseTo(-600, 2);
      expect(await docCost('SHIPMENT', shLate.id)).toBeCloseTo(-600, 2);
      expect(Number(finalized.summary.closingInventoryValue)).toBeCloseTo(1200, 2);
      expect(Number(finalized.summary.cogs)).toBeCloseTo(1200, 2);
      expect(finalized.summary.equationResidual).toBe('0.00');
      const snap = await prisma.inventoryCostBalanceSnapshot.findFirst({ where: { tenantId, organizationId: waOrg, productId } });
      expect(Number(snap!.quantity)).toBeCloseTo(100, 6);
      expect(Number(snap!.value)).toBeCloseTo(1200, 2);
      const statuses = await prisma.inventoryCostMovement.findMany({ where: { tenantId, organizationId: waOrg }, select: { costStatus: true } });
      expect(statuses.every((s) => s.costStatus === 'FINAL')).toBe(true);
    });

    it('blocks a cost-affecting document dated in the finalized period; an audited reopen allows it again (spec 59, 134)', async () => {
      const gr = await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/goods-receipts`))
        .send({ counterpartyId: supplierW, warehouseId: waWh, documentDate: '2026-08-28', lines: [{ productId, unitId, quantity: 5, price: 20 }] })
        .expect(201);
      const blocked = await post('GOODS_RECEIPT', gr.body.id, gr.body.version, 409);
      expect(blocked.body.code).toBe('INVENTORY_COSTING_PERIOD_FINALIZED');

      await auth(request(app.getHttpServer()).post(`/organizations/${waOrg}/inventory-costing/periods/2026-08/reopen`)).send({ reason: 'Late supplier delivery' }).expect(201);
      const audit = await prisma.auditEvent.findFirst({ where: { tenantId, eventType: 'INVENTORY_COSTING_PERIOD_REOPENED' } });
      expect(audit).toBeTruthy();
      await post('GOODS_RECEIPT', gr.body.id);
    });
  });

  // ------------------------------------------------------------------ by-warehouse costing

  describe('Transfers, write-off, internal consumption, ownership (spec 7, 30-35, 126, 135)', () => {
    let productId: string;

    it('transfer 20 of 50 @ 10: A -200, B +200, organization total unchanged, no GL entry', async () => {
      productId = await createProduct(whOrg);
      await receipt(whOrg, whA, supplierH, '2026-02-01', [{ productId, quantity: 50, price: 10 }]);
      const tr = await auth(request(app.getHttpServer()).post(`/organizations/${whOrg}/warehouse-transfers`))
        .send({ sourceWarehouseId: whA, destinationWarehouseId: whB, transferType: 'INSTANT', documentDate: '2026-02-02', lines: [{ productId, unitId, quantity: 20 }] })
        .expect(201);
      await post('WAREHOUSE_TRANSFER', tr.body.id, tr.body.version);

      const a = await valuation(whOrg, productId, `&warehouseId=${whA}`);
      const b = await valuation(whOrg, productId, `&warehouseId=${whB}`);
      expect(Number(a.totalValue)).toBeCloseTo(300, 2);
      expect(Number(b.totalValue)).toBeCloseTo(200, 2);
      const all = await valuation(whOrg, productId);
      expect(Number(all.totalValue)).toBeCloseTo(500, 2);
      expect(await prisma.journalEntry.count({ where: { tenantId, sourceDocumentType: 'WAREHOUSE_TRANSFER', sourceDocumentId: tr.body.id } })).toBe(0);
    });

    it('write-off uses actual FIFO cost (arbitrary costReference ignored): Dr 731 / Cr 205 = 50; internal consumption Dr 721 = 50', async () => {
      const wo = await auth(request(app.getHttpServer()).post(`/organizations/${whOrg}/inventory-adjustments`))
        .send({ warehouseId: whA, adjustmentType: 'WRITE_OFF', documentDate: '2026-02-03', lines: [{ productId, unitId, quantity: 5, costReference: 999 }] })
        .expect(201);
      await post('INVENTORY_ADJUSTMENT', wo.body.id, wo.body.version);
      const woGl = await journalByCode('INVENTORY_ADJUSTMENT', wo.body.id);
      expect(woGl.byCode['731']).toBeCloseTo(50, 2);
      expect(woGl.byCode['205']).toBeCloseTo(-50, 2);

      const ic = await auth(request(app.getHttpServer()).post(`/organizations/${whOrg}/internal-consumptions`))
        .send({ warehouseId: whB, documentDate: '2026-02-04', operationType: 'OFFICE_CONSUMPTION', lines: [{ productId, unitId, quantity: 5 }] })
        .expect(201);
      await post('INTERNAL_CONSUMPTION', ic.body.id, ic.body.version);
      const icGl = await journalByCode('INTERNAL_CONSUMPTION', ic.body.id);
      expect(icGl.byCode['721']).toBeCloseTo(50, 2);
      expect(icGl.byCode['205']).toBeCloseTo(-50, 2);
    });

    it('consignment stock is physical but not financial inventory (spec 7, 69, 135)', async () => {
      const p = await createProduct(whOrg);
      await receipt(whOrg, whA, supplierH, '2026-02-05', [{ productId: p, quantity: 100, price: 3 }]);
      await prisma.inventoryMovement.create({
        data: { tenantId, organizationId: whOrg, warehouseId: whA, productId: p, unitId, ownershipType: 'SUPPLIER_CONSIGNMENT', ownerCounterpartyId: supplierH, movementType: 'PURCHASE_RECEIPT', quantity: '50', baseQuantity: '50', effectiveDate: new Date('2026-02-05'), registrarDocumentType: 'TEST_CONSIGNMENT', registrarDocumentId: `consign-${run}` },
      });
      const v = await valuation(whOrg, p, `&warehouseId=${whA}`);
      expect(Number(v.rows[0].physicalQuantity)).toBeCloseTo(150, 6);
      expect(Number(v.rows[0].financialQuantity)).toBeCloseTo(100, 6);
      expect(Number(v.rows[0].inventoryValue)).toBeCloseTo(300, 2);
      const health = (await auth(request(app.getHttpServer()).get(`/organizations/${whOrg}/inventory-costing/health?asOfDate=2026-02-28`)).expect(200)).body;
      expect(health.issues.find((i: any) => i.check === 'UNCOSTED_MOVEMENTS')).toBeUndefined();
      expect(health.issues.find((i: any) => i.check === 'QUANTITY_VALUE_MISMATCH')).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------ security

  describe('Security (spec 97, tenant isolation)', () => {
    it('a user with inventory.view but no inventory_cost.* permission cannot see cost data', async () => {
      const email = `cost-viewer-${run}@e2e.test`;
      const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Warehouse operator' }).expect(201);
      const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
      await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: fifoOrg, accessLevel: 'FULL' } });
      const role = await prisma.role.create({ data: { tenantId, code: `WH_OPERATOR_${run}`, name: 'Warehouse operator' } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      const perm = await prisma.permission.findUnique({ where: { code: 'inventory.view' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm!.id } });

      await request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/valuation`).set('Authorization', `Bearer ${reg.body.accessToken}`).set('X-Tenant-Id', tenantId).expect(403);
    });

    it('another tenant cannot read this organization\'s costing', async () => {
      const res = await request(app.getHttpServer()).get(`/organizations/${fifoOrg}/inventory-costing/valuation`).set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
      expect([403, 404]).toContain(res.status);
    });
  });
});
