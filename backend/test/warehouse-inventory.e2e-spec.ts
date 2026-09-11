/**
 * Warehouse / Stock Engine E2E tests (docx spec Phase 10).
 *
 * Covers: instant warehouse transfer (source decrease + destination
 * increase in one post), two-step transfer (ship => IN_TRANSIT at
 * destination, partial receive => AVAILABLE, second receive completes
 * it, over-receive rejected, unpost blocked once any receive happened),
 * internal consumption (physical decrease, negative-stock blocked),
 * inventory adjustment write-off (decrease) and surplus (increase),
 * inventory status transfer (AVAILABLE -> QUARANTINE, quantity
 * unchanged), and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import * as request from 'supertest';

describe('Warehouse Inventory (e2e)', () => {
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
  let unitId: string;
  let warehouseAId: string;
  let warehouseBId: string;

  const DOC_DATE = '2026-09-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`wh1-${run}@e2e.test`, `wh-t1-${run}`, 'WH1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const s2 = await setupTenant(`wh2-${run}@e2e.test`, `wh-t2-${run}`, 'WH2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    const charts = app.get(ChartOfAccountsService);
    await charts.ensureAdopted(tenant1Id);

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS10', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'P10-PROD-001', name: 'Warehouse Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const whA = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-A10', name: 'Warehouse A' })
      .expect(201);
    warehouseAId = whA.body.id;

    const whB = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-B10', name: 'Warehouse B' })
      .expect(201);
    warehouseBId = whB.body.id;
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

  async function seedStock(warehouseId: string, qty: number, org = org1Id) {
    await prisma.inventoryMovement.create({
      data: {
        tenantId: tenant1Id,
        organizationId: org,
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

  async function availableStock(warehouseId: string) {
    const res = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/warehouses/${warehouseId}/products/${productId}/stock`)).expect(200);
    return Number(res.body.available);
  }

  describe('Warehouse Transfer', () => {
    it('INSTANT transfer decreases source and increases destination in the same post', async () => {
      await seedStock(warehouseAId, 100);
      const before = await availableStock(warehouseAId);

      const transfer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers`))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, transferType: 'INSTANT', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 20 }] })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/documents/WAREHOUSE_TRANSFER/${transfer.body.id}/post`))
        .send({ expectedVersion: transfer.body.version })
        .expect(201);

      expect(await availableStock(warehouseAId)).toBe(before - 20);
      expect(await availableStock(warehouseBId)).toBeGreaterThanOrEqual(20);
    });

    it('blocks a transfer that exceeds available stock (negative stock blocked)', async () => {
      const before = await availableStock(warehouseAId);
      const transfer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers`))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, transferType: 'INSTANT', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: before + 1000 }] })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/documents/WAREHOUSE_TRANSFER/${transfer.body.id}/post`))
        .send({ expectedVersion: transfer.body.version })
        .expect(422);
    });

    it('TWO_STEP transfer ships to IN_TRANSIT, supports partial receive, and blocks unpost after any receive', async () => {
      await seedStock(warehouseAId, 50);

      const transfer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers`))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, transferType: 'TWO_STEP', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 30 }] })
        .expect(201);
      const lineId = transfer.body.lines[0].id;
      const destAvailableBeforeShip = await availableStock(warehouseBId);

      const postResult = await auth1(request(app.getHttpServer()).post(`/documents/WAREHOUSE_TRANSFER/${transfer.body.id}/post`))
        .send({ expectedVersion: transfer.body.version })
        .expect(201);
      expect(postResult.body.postingStatus).toBe('POSTED');

      const posted = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/warehouse-transfers/${transfer.body.id}`)).expect(200);
      expect(posted.body.transferStatus).toBe('SHIPPED');

      // Shipped quantity sits in IN_TRANSIT at destination — not yet AVAILABLE there.
      expect(await availableStock(warehouseBId)).toBe(destAvailableBeforeShip);

      const partial = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers/${transfer.body.id}/receive`))
        .send({ expectedVersion: posted.body.version, lines: [{ lineId, quantity: 10 }] })
        .expect(201);
      expect(partial.body.transferStatus).toBe('PARTIALLY_RECEIVED');
      expect(await availableStock(warehouseBId)).toBe(destAvailableBeforeShip + 10);

      // Unpost is now blocked — destination has already consumed part of the in-transit stock.
      await auth1(request(app.getHttpServer()).post(`/documents/WAREHOUSE_TRANSFER/${transfer.body.id}/unpost`))
        .send({ expectedVersion: partial.body.version })
        .expect(409);

      // Over-receiving the remainder fails.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers/${transfer.body.id}/receive`))
        .send({ expectedVersion: partial.body.version, lines: [{ lineId, quantity: 9999 }] })
        .expect(422);

      const completed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers/${transfer.body.id}/receive`))
        .send({ expectedVersion: partial.body.version, lines: [{ lineId, quantity: 20 }] })
        .expect(201);
      expect(completed.body.transferStatus).toBe('RECEIVED');
      expect(await availableStock(warehouseBId)).toBe(destAvailableBeforeShip + 30);
    });
  });

  describe('Internal Consumption', () => {
    it('posts a physical decrease', async () => {
      await seedStock(warehouseAId, 40);
      const before = await availableStock(warehouseAId);

      const consumption = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/internal-consumptions`))
        .send({ warehouseId: warehouseAId, operationType: 'OFFICE_CONSUMPTION', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 5, purpose: 'Printer paper' }] })
        .expect(201);

      await auth1(request(app.getHttpServer()).post(`/documents/INTERNAL_CONSUMPTION/${consumption.body.id}/post`))
        .send({ expectedVersion: consumption.body.version })
        .expect(201);

      expect(await availableStock(warehouseAId)).toBe(before - 5);
    });
  });

  describe('Inventory Adjustment', () => {
    it('WRITE_OFF decreases stock, SURPLUS increases it', async () => {
      await seedStock(warehouseAId, 60);
      const before = await availableStock(warehouseAId);

      const writeOff = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-adjustments`))
        .send({ warehouseId: warehouseAId, adjustmentType: 'WRITE_OFF', reasonCode: 'DAMAGE', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 6 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/INVENTORY_ADJUSTMENT/${writeOff.body.id}/post`))
        .send({ expectedVersion: writeOff.body.version })
        .expect(201);
      expect(await availableStock(warehouseAId)).toBe(before - 6);

      const afterWriteOff = await availableStock(warehouseAId);
      const surplus = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-adjustments`))
        .send({ warehouseId: warehouseAId, adjustmentType: 'SURPLUS', reasonCode: 'OTHER', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 3 }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/INVENTORY_ADJUSTMENT/${surplus.body.id}/post`))
        .send({ expectedVersion: surplus.body.version })
        .expect(201);
      expect(await availableStock(warehouseAId)).toBe(afterWriteOff + 3);
    });
  });

  describe('Inventory Status Transfer', () => {
    it('moves quantity from AVAILABLE to QUARANTINE without changing physical total', async () => {
      await seedStock(warehouseAId, 25);
      const availableBefore = await availableStock(warehouseAId);
      const physicalBefore = (await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/warehouses/${warehouseAId}/products/${productId}/stock`)).expect(200)).body.physical;

      const statusTransfer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-status-transfers`))
        .send({ warehouseId: warehouseAId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 4, fromStockStatus: 'AVAILABLE', toStockStatus: 'QUARANTINE' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/INVENTORY_STATUS_TRANSFER/${statusTransfer.body.id}/post`))
        .send({ expectedVersion: statusTransfer.body.version })
        .expect(201);

      expect(await availableStock(warehouseAId)).toBe(availableBefore - 4);
      const snapshotAfter = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/warehouses/${warehouseAId}/products/${productId}/stock`)).expect(200);
      expect(Number(snapshotAfter.body.physical)).toBe(Number(physicalBefore)); // total physical stock unchanged — only its status
    });
  });

  describe('Batch/serial capture (Goods Receipt -> Shipment)', () => {
    let batchProductId: string;
    let serialProductId: string;
    let supplierId: string;
    let customerId: string;

    beforeAll(async () => {
      const batchProduct = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
        .send({ code: 'P10-BATCH-001', name: 'Batch Tracked Widget', productType: 'GOODS', baseUnitId: unitId, batchTrackingMode: 'REQUIRED' })
        .expect(201);
      batchProductId = batchProduct.body.id;

      const serialProduct = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
        .send({ code: 'P10-SERIAL-001', name: 'Serial Tracked Widget', productType: 'GOODS', baseUnitId: unitId, serialTrackingMode: 'REQUIRED' })
        .expect(201);
      serialProductId = serialProduct.body.id;

      const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: 'SUP-W10', name: 'Widget Supply Co', paymentTerms: 30 })
        .expect(201);
      supplierId = supplier.body.id;

      const customer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'CUSTOMER', code: 'CUS-W10', name: 'Widget Buyer Co', paymentTerms: 30 })
        .expect(201);
      customerId = customer.body.id;
    });

    it('rejects a Goods Receipt line for a batch-required product with no batch number', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId: warehouseAId, documentDate: DOC_DATE, lines: [{ productId: batchProductId, unitId, quantity: 10, price: 5 }] })
        .expect(400);
    });

    it('creates/reuses a Batch on receipt and the physical stock is tracked under it', async () => {
      const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId: warehouseAId, documentDate: DOC_DATE, lines: [{ productId: batchProductId, unitId, quantity: 10, price: 5, batchNumber: 'LOT-001' }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);

      const batches = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-reports/batches?productId=${batchProductId}`)).expect(200);
      const lot = batches.body.find((b: any) => b.batchNumber === 'LOT-001');
      expect(lot).toBeDefined();
      expect(Number(lot.currentQuantity)).toBe(10);
    });

    it('rejects a serial-required receipt line whose serial count does not match quantity', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId: warehouseAId, documentDate: DOC_DATE, lines: [{ productId: serialProductId, unitId, quantity: 3, price: 20, serialNumbers: ['SN-A', 'SN-B'] }] })
        .expect(400);
    });

    it('receives serials one movement per unit and later issues them on shipment, validated end to end', async () => {
      const run2 = Date.now();
      const sn1 = `SN-${run2}-1`;
      const sn2 = `SN-${run2}-2`;

      const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId: warehouseAId, documentDate: DOC_DATE, lines: [{ productId: serialProductId, unitId, quantity: 2, price: 50, serialNumbers: [sn1, sn2] }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);

      const serials = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-reports/serials?productId=${serialProductId}`)).expect(200);
      const receivedSerial = serials.body.find((s: any) => s.serialNumber === sn1);
      expect(receivedSerial.status).toBe('AVAILABLE');
      expect(receivedSerial.currentWarehouseId).toBe(warehouseAId);

      const history = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-reports/serials/${receivedSerial.id}/history`)).expect(200);
      expect(history.body.length).toBe(1);
      expect(history.body[0].movementType).toBe('PURCHASE_RECEIPT');

      // Shipping a serial not at this warehouse (or not AVAILABLE) is rejected server-side.
      const badShipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId: warehouseAId, lines: [{ productId: serialProductId, unitId, quantity: '1', serialNumbers: ['SN-DOES-NOT-EXIST'] }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/SHIPMENT/${badShipment.body.id}/post`))
        .send({ expectedVersion: badShipment.body.version })
        .expect(422);

      const shipment = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId: warehouseAId, lines: [{ productId: serialProductId, unitId, quantity: '1', serialNumbers: [sn1] }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/SHIPMENT/${shipment.body.id}/post`)).send({ expectedVersion: shipment.body.version }).expect(201);

      const afterIssue = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-reports/serials/${receivedSerial.id}/history`)).expect(200);
      expect(afterIssue.body.length).toBe(2);
      expect(afterIssue.body[1].movementType).toBe('SALES_SHIPMENT');
      expect(Number(afterIssue.body[1].quantity)).toBe(-1);

      // The other serial is still available and cannot be shipped twice for sn1.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/shipments`))
        .send({ documentDate: DOC_DATE, counterpartyId: customerId, warehouseId: warehouseAId, lines: [{ productId: serialProductId, unitId, quantity: '1', serialNumbers: [sn1] }] })
        .expect(201)
        .then(async (repeat) => {
          await auth1(request(app.getHttpServer()).post(`/documents/SHIPMENT/${repeat.body.id}/post`))
            .send({ expectedVersion: repeat.body.version })
            .expect(422);
        });
    });
  });

  describe('Tenant isolation', () => {
    it('tenant2 cannot see a tenant1 warehouse transfer through its own organization', async () => {
      const transfer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouse-transfers`))
        .send({ sourceWarehouseId: warehouseAId, destinationWarehouseId: warehouseBId, transferType: 'INSTANT', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1 }] })
        .expect(201);

      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/warehouse-transfers/${transfer.body.id}`)).expect(404);
    });
  });
});
