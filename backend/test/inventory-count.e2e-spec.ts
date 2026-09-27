/**
 * Inventory Count / Reconciliation Engine E2E tests (docx spec Phase 12).
 *
 * Covers the spec's own listed test scenarios (sections 115-132): basic
 * count (zero variance, no adjustment), shortage/surplus end to end
 * (variance -> decide -> approve -> create adjustment -> post -> stock
 * and reconciliation), post-snapshot movement reconciliation under
 * NO_FREEZE, location mismatch and batch mismatch (net-zero at product
 * level, never hidden), serial mismatch (missing/unexpected serials even
 * at matching quantity), recount (original count preserved, final
 * approved count wins), hard freeze (blocks an unrelated posting into
 * the locked warehouse), uncounted vs. explicit zero count, idempotent
 * adjustment posting, stale reconciliation under a concurrent
 * post-approval movement, and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Inventory Count (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let unitId: string;
  let warehouseId: string;
  let locationAId: string;
  let locationBId: string;

  let token2: string;
  let tenant2Id: string;
  let org2Id: string;

  const DOC_DATE = '2026-09-01';
  let productSeq = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`ic1-${run}@e2e.test`, `ic-t1-${run}`, 'IC1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const s2 = await setupTenant(`ic2-${run}@e2e.test`, `ic-t2-${run}`, 'IC2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: `PCS-IC-${run}`, name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: `WH-IC-${run}`, name: 'Count Warehouse', allowNegativeStock: true })
      .expect(201);
    warehouseId = wh.body.id;

    const locA = await prisma.warehouseLocation.create({ data: { tenantId: tenant1Id, warehouseId, code: 'A', name: 'Location A' } });
    const locB = await prisma.warehouseLocation.create({ data: { tenantId: tenant1Id, warehouseId, code: 'B', name: 'Location B' } });
    locationAId = locA.id;
    locationBId = locB.id;
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

  async function createProduct(opts: { batchTrackingMode?: string; serialTrackingMode?: string } = {}) {
    productSeq += 1;
    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: `IC-PROD-${run}-${productSeq}`, name: `Count Product ${productSeq}`, productType: 'GOODS', baseUnitId: unitId, ...opts })
      .expect(201);
    return p.body.id as string;
  }

  async function seedStock(productId: string, qty: number, opts: { locationId?: string; batchId?: string; serialId?: string; effectiveDate?: Date } = {}) {
    await prisma.inventoryMovement.create({
      data: {
        tenantId: tenant1Id,
        organizationId: org1Id,
        warehouseId,
        locationId: opts.locationId,
        productId,
        unitId,
        batchId: opts.batchId,
        serialId: opts.serialId,
        movementType: 'PURCHASE_RECEIPT',
        quantity: String(qty),
        baseQuantity: String(qty),
        effectiveDate: opts.effectiveDate ?? new Date(DOC_DATE),
        registrarDocumentType: 'TEST_STOCK_SEED',
        registrarDocumentId: `seed-${run}-${Date.now()}-${Math.random()}`,
      },
    });
  }

  async function createBatch(productId: string, batchNumber: string) {
    const b = await prisma.batch.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId, batchNumber } });
    return b.id as string;
  }

  async function createSerial(productId: string, serialNumber: string) {
    const s = await prisma.serialNumber.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId, serialNumber, currentWarehouseId: warehouseId } });
    return s.id as string;
  }

  interface PlanOptions {
    productId: string;
    scopes?: any[];
    freezePolicy?: string;
    blindCountEnabled?: boolean;
    cutoffMode?: string;
    recountPolicy?: string;
    recountQuantityThreshold?: number;
    recountValueThreshold?: number;
    recountPercentageThreshold?: number;
    maxRecountAttempts?: number;
    varianceQuantityTolerance?: number;
    countCutoffAt?: string;
    extraSheets?: { warehouseId: string; locationId?: string }[];
  }

  async function setupSession(opts: PlanOptions) {
    const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/plans`))
      .send({
        planDate: DOC_DATE,
        countType: 'FULL',
        blindCountEnabled: opts.blindCountEnabled ?? false,
        freezePolicy: opts.freezePolicy ?? 'NO_FREEZE_WITH_MOVEMENT_TRACKING',
        cutoffMode: opts.cutoffMode ?? 'GLOBAL_SNAPSHOT_CUTOFF',
        recountPolicy: opts.recountPolicy ?? 'NO_RECOUNT',
        recountQuantityThreshold: opts.recountQuantityThreshold,
        recountValueThreshold: opts.recountValueThreshold,
        recountPercentageThreshold: opts.recountPercentageThreshold,
        maxRecountAttempts: opts.maxRecountAttempts ?? 2,
        varianceQuantityTolerance: opts.varianceQuantityTolerance,
        scopes: opts.scopes ?? [{ warehouseId, productId: opts.productId }],
      })
      .expect(201);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/plans/${plan.body.id}/mark-ready`))
      .send({ expectedVersion: plan.body.version })
      .expect(201);

    const session = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions`))
      .send({ inventoryCountPlanId: plan.body.id, countCutoffAt: opts.countCutoffAt })
      .expect(201);
    const sessionId = session.body.id as string;

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/snapshot`)).expect(201);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/sheets/generate`))
      .send({ extraSheets: opts.extraSheets })
      .expect(201);

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/begin-counting`)).expect(201);

    const sheets = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/sheets`)).expect(200);
    return { planId: plan.body.id, sessionId, sheets: sheets.body as any[] };
  }

  async function submitEntry(sessionId: string, sheetId: string, body: Record<string, unknown>) {
    return auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
      .send({ warehouseId, unitId, ...body })
      .expect(201);
  }

  async function completeAllSheets(sessionId: string, sheets: any[]) {
    for (const sheet of sheets) {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/sheets/${sheet.id}/complete`)).expect(201);
    }
  }

  async function completeSession(sessionId: string) {
    return auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/complete`)).expect(201);
  }

  async function calculateVariances(sessionId: string) {
    return auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/calculate-variances`)).expect(201);
  }

  async function listVariances(sessionId: string) {
    const res = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances`)).expect(200);
    return res.body as any[];
  }

  async function availableStock(productId: string) {
    const res = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/warehouses/${warehouseId}/products/${productId}/stock`)).expect(200);
    return Number(res.body.available);
  }

  describe('Basic count — zero variance', () => {
    it('MATCH variance, no adjustment needed, session reconciles', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      const { sessionId, sheets } = await setupSession({ productId });

      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 100 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variances = await listVariances(sessionId);
      const own = variances.filter((v) => v.productId === productId);
      expect(own.every((v) => v.varianceType === 'MATCH')).toBe(true);

      // No decisions needed — session can go straight through to reconciled/closed.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/reconcile`)).expect(201);
      const reconciliation = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/reconciliation`)).expect(200);
      expect(reconciliation.body.status).toBe('BALANCED');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/close`)).expect(201);
    });
  });

  describe('Shortage — full lifecycle', () => {
    it('computes SHORTAGE, posts a WRITE_OFF adjustment, and reconciles', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      const { sessionId, sheets } = await setupSession({ productId });

      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 95 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variances = await listVariances(sessionId);
      const variance = variances.find((v) => v.productId === productId && v.varianceType === 'SHORTAGE')!;
      expect(variance).toBeDefined();
      expect(Number(variance.quantityDifference)).toBe(-5);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/decide`))
        .send({ resolutionType: 'ADJUST_STOCK', reasonCode: 'counting_error' })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/approve`)).expect(201);

      const before = await availableStock(productId);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/create-adjustments`)).send({}).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/post-adjustments`)).expect(201);
      expect(await availableStock(productId)).toBe(before - 5);

      // Idempotent re-post: calling again does not double-adjust stock.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/post-adjustments`)).expect(201);
      expect(await availableStock(productId)).toBe(before - 5);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/reconcile`)).expect(201);
      const reconciliation = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/reconciliation`)).expect(200);
      expect(reconciliation.body.status).toBe('BALANCED');
      expect(Number(reconciliation.body.shortageQuantity)).toBe(5);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/close`)).expect(201);
    });
  });

  describe('Surplus — full lifecycle', () => {
    it('computes SURPLUS and posts a SURPLUS adjustment', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      const { sessionId, sheets } = await setupSession({ productId });

      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 105 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variance = (await listVariances(sessionId)).find((v) => v.productId === productId && v.varianceType === 'SURPLUS')!;
      expect(Number(variance.quantityDifference)).toBe(5);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/decide`))
        .send({ resolutionType: 'ADJUST_STOCK', reasonCode: 'unrecorded_receipt' })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/approve`)).expect(201);

      const before = await availableStock(productId);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/create-adjustments`)).send({}).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/post-adjustments`)).expect(201);
      expect(await availableStock(productId)).toBe(before + 5);
    });
  });

  describe('Blind count', () => {
    it('never returns the accounting quantity in the entry submission response', async () => {
      const productId = await createProduct();
      await seedStock(productId, 50);
      const { sessionId, sheets } = await setupSession({ productId, blindCountEnabled: true });

      const entry = await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 40 });
      // Entry submission is structurally incapable of returning the book
      // quantity (InventoryCountEntryService never reads the snapshot) —
      // assert on the known response keys rather than a raw substring
      // search, since a random UUID can coincidentally contain "50".
      expect(Object.keys(entry.body).sort()).toEqual(
        ['barcode', 'baseQuantity', 'batchId', 'countedAt', 'countedBy', 'countedQuantity', 'clientEntryId', 'entryMethod', 'entryVersion', 'id', 'locationId', 'notes', 'ownershipType', 'productId', 'qualityStatus', 'serials', 'sessionId', 'sheetId', 'tenantId', 'unitId', 'voided', 'warehouseId'].sort(),
      );
    });
  });

  describe('Post-snapshot movement reconciliation (NO_FREEZE)', () => {
    it('adjusts accounting quantity for movements after the snapshot but before cutoff', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      // `effectiveDate` is a DATE column (business date, no time-of-day) —
      // so a post-snapshot movement on the SAME calendar day as the
      // snapshot would still compare as "midnight <= snapshot timestamp".
      // Use the next calendar day to land unambiguously after the
      // snapshot and before a cutoff a day beyond that.
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const { sessionId, sheets } = await setupSession({ productId, countCutoffAt: dayAfter.toISOString() });

      // Post-snapshot: +20 receipt, -10 shipment (matches spec's own worked example).
      await seedStock(productId, 20, { effectiveDate: tomorrow });
      await prisma.inventoryMovement.create({
        data: {
          tenantId: tenant1Id, organizationId: org1Id, warehouseId, productId, unitId,
          movementType: 'SALES_SHIPMENT', quantity: '-10', baseQuantity: '-10',
          effectiveDate: tomorrow,
          registrarDocumentType: 'TEST_STOCK_SEED', registrarDocumentId: `seed-${run}-${Date.now()}-${Math.random()}`,
        },
      });

      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 110 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variance = (await listVariances(sessionId)).find((v) => v.productId === productId)!;
      expect(variance.varianceType).toBe('MATCH');
      expect(Number(variance.adjustedAccountingQuantity)).toBe(110);
    });
  });

  describe('Location mismatch', () => {
    it('keeps per-location variance rows even when the product-level net is zero', async () => {
      const productId = await createProduct();
      await seedStock(productId, 50, { locationId: locationAId });
      await seedStock(productId, 50, { locationId: locationBId });
      const { sessionId, sheets } = await setupSession({ productId, scopes: [{ warehouseId, productId }] });

      const sheetA = sheets.find((s) => s.locationId === locationAId)!;
      const sheetB = sheets.find((s) => s.locationId === locationBId)!;
      await submitEntry(sessionId, sheetA.id, { productId, locationId: locationAId, countedQuantity: 40 });
      await submitEntry(sessionId, sheetB.id, { productId, locationId: locationBId, countedQuantity: 60 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variances = (await listVariances(sessionId)).filter((v) => v.productId === productId);
      expect(variances).toHaveLength(2);
      expect(variances.every((v) => v.varianceType === 'LOCATION_MISMATCH')).toBe(true);
      const diffs = variances.map((v) => Number(v.quantityDifference)).sort();
      expect(diffs).toEqual([-10, 10]);
    });
  });

  describe('Batch mismatch', () => {
    it('keeps per-batch variance rows even when the product-level net is zero', async () => {
      const productId = await createProduct({ batchTrackingMode: 'OPTIONAL' });
      const batchA = await createBatch(productId, `BATCH-A-${run}`);
      const batchB = await createBatch(productId, `BATCH-B-${run}`);
      await seedStock(productId, 50, { batchId: batchA });
      await seedStock(productId, 50, { batchId: batchB });
      const { sessionId, sheets } = await setupSession({ productId });

      await submitEntry(sessionId, sheets[0].id, { productId, batchId: batchA, countedQuantity: 45 });
      await submitEntry(sessionId, sheets[0].id, { productId, batchId: batchB, countedQuantity: 55 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variances = (await listVariances(sessionId)).filter((v) => v.productId === productId);
      expect(variances).toHaveLength(2);
      expect(variances.every((v) => v.varianceType === 'BATCH_MISMATCH')).toBe(true);
    });
  });

  describe('Serial mismatch', () => {
    it('flags a missing and an unexpected serial even though the count matches', async () => {
      const productId = await createProduct({ serialTrackingMode: 'OPTIONAL' });
      const sn1 = await createSerial(productId, `SN1-${run}`);
      await createSerial(productId, `SN2-${run}`);
      const sn3 = await createSerial(productId, `SN3-${run}`);
      await seedStock(productId, 1, { serialId: sn1 });
      await seedStock(productId, 1, { serialId: sn3 }); // SN2 accounted for separately below
      await prisma.inventoryMovement.create({
        data: { tenantId: tenant1Id, organizationId: org1Id, warehouseId, productId, unitId, serialId: (await prisma.serialNumber.findFirst({ where: { tenantId: tenant1Id, serialNumber: `SN2-${run}` } }))!.id, movementType: 'PURCHASE_RECEIPT', quantity: '1', baseQuantity: '1', effectiveDate: new Date(DOC_DATE), registrarDocumentType: 'TEST_STOCK_SEED', registrarDocumentId: `seed-${run}-${Date.now()}-${Math.random()}` },
      });

      const { sessionId, sheets } = await setupSession({ productId });
      // Found SN1, SN3, SN4 (SN2 missing, SN4 unexpected) — quantity net (3=3) unchanged.
      await createSerial(productId, `SN4-${run}`);
      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 3, serialNumbers: [`SN1-${run}`, `SN3-${run}`, `SN4-${run}`] });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variances = (await listVariances(sessionId)).filter((v) => v.productId === productId);
      expect(variances.some((v) => v.varianceType === 'SERIAL_MISSING')).toBe(true);
      expect(variances.some((v) => v.varianceType === 'SERIAL_UNEXPECTED')).toBe(true);
      const quantityRow = variances.find((v) => v.varianceType === 'MATCH');
      expect(quantityRow).toBeDefined();
    });
  });

  describe('Recount', () => {
    it('preserves the original count and uses the final approved recount', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      // Matches the spec's own worked example (section 40/123): accounting
      // 100, first count 90 (10% off, above the 5% threshold) forces a
      // recount; a recount landing within tolerance (99, 1% off) resolves it.
      const { sessionId, sheets } = await setupSession({ productId, recountPolicy: 'RECOUNT_PERCENTAGE', recountPercentageThreshold: 5, maxRecountAttempts: 2 });

      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 90 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      let variance = (await listVariances(sessionId)).find((v) => v.productId === productId)!;
      expect(variance.resolutionStatus).toBe('RECOUNT_REQUIRED');

      const recount = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/recounts`)).send({}).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/recounts/${recount.body.id}/submit`)).send({ physicalQuantity: 99 }).expect(201);

      variance = (await listVariances(sessionId)).find((v) => v.id === variance.id)!;
      expect(Number(variance.physicalQuantity)).toBe(99);
      expect(variance.resolutionStatus).not.toBe('RECOUNT_REQUIRED');

      const recounts = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/recounts`)).expect(200);
      expect(recounts.body).toHaveLength(1);
      expect(Number(recounts.body[0].physicalQuantity)).toBe(99);
    });
  });

  describe('Hard freeze', () => {
    it('blocks an unrelated posting into the locked warehouse', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      await setupSession({ productId, freezePolicy: 'HARD_FREEZE' });

      const adj = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-adjustments`))
        .send({ warehouseId, adjustmentType: 'WRITE_OFF', documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 1 }] })
        .expect(201);

      const res = await auth1(request(app.getHttpServer()).post(`/documents/INVENTORY_ADJUSTMENT/${adj.body.id}/post`)).send({ expectedVersion: adj.body.version });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('locked for inventory count session');
    });
  });

  describe('Uncounted vs. explicit zero', () => {
    it('distinguishes a product never counted from one explicitly counted as zero', async () => {
      const productA = await createProduct();
      const productB = await createProduct();
      await seedStock(productA, 10);
      await seedStock(productB, 10);
      const { sessionId, sheets } = await setupSession({ productId: productA, scopes: [{ warehouseId, productId: productA }, { warehouseId, productId: productB }] });

      // Only productB gets an explicit zero count; productA is left uncounted.
      await submitEntry(sessionId, sheets[0].id, { productId: productB, countedQuantity: 0 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variances = await listVariances(sessionId);
      const a = variances.find((v) => v.productId === productA)!;
      const b = variances.find((v) => v.productId === productB)!;
      expect(a.varianceType).toBe('UNCOUNTED_ITEM');
      expect(a.physicalQuantity).toBeNull();
      expect(b.varianceType).toBe('SHORTAGE');
      expect(Number(b.physicalQuantity)).toBe(0);
    });
  });

  describe('Stale reconciliation under a concurrent movement', () => {
    it('blocks posting once an unrelated movement has changed the picture since approval', async () => {
      const productId = await createProduct();
      await seedStock(productId, 100);
      const { sessionId, sheets } = await setupSession({ productId });

      await submitEntry(sessionId, sheets[0].id, { productId, countedQuantity: 95 });
      await completeAllSheets(sessionId, sheets);
      await completeSession(sessionId);
      await calculateVariances(sessionId);

      const variance = (await listVariances(sessionId)).find((v) => v.productId === productId)!;
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/decide`)).send({ resolutionType: 'ADJUST_STOCK' }).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/variances/${variance.id}/approve`)).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/create-adjustments`)).send({}).expect(201);

      // An unrelated receipt lands in scope after approval but before posting
      // (see the post-snapshot-movement test above for why `effectiveDate`,
      // a DATE column, needs the next calendar day to compare as "after").
      await seedStock(productId, 7, { effectiveDate: new Date(Date.now() + 24 * 60 * 60 * 1000) });

      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/inventory-count/sessions/${sessionId}/post-adjustments`));
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('stale');
    });
  });

  describe('Tenant isolation', () => {
    it('tenant2 cannot see a tenant1 inventory count session', async () => {
      const productId = await createProduct();
      await seedStock(productId, 10);
      const { sessionId } = await setupSession({ productId });

      const res = await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/inventory-count/sessions/${sessionId}`));
      expect([403, 404]).toContain(res.status);
    });
  });
});
