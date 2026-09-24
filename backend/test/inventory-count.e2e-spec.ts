/**
 * Inventory Count / Reconciliation Engine E2E tests (docx spec Phase 12),
 * Task #9 slice: InventoryCountPlanService, InventoryCountScopeService
 * (post-session-start immutability), and InventorySnapshotService (built
 * from Phase 10's InventoryMovement register, valued via Phase 11's
 * InventoryCostingService).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { InventorySnapshotService } from '../src/inventory-count/inventory-snapshot.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import * as request from 'supertest';

describe('Inventory Count / Reconciliation Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let snapshotService: InventorySnapshotService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let orgId: string;
  let unitId: string;
  let supplierId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    snapshotService = app.get(InventorySnapshotService);
    const charts = app.get(ChartOfAccountsService);

    const s1 = await setupTenant(`icount1-${run}@e2e.test`, `icount-t1-${run}`, 'ICNT1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    orgId = s1.orgId;

    const s2 = await setupTenant(`icount2-${run}@e2e.test`, `icount-t2-${run}`, 'ICNT2');
    token2 = s2.token;
    tenant2Id = s2.tenantId;

    await charts.ensureAdopted(tenant1Id);

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure')).send({ code: 'PCS12', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' }).expect(201);
    unitId = u.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: 'SUP-P12', name: 'Count Supply Co', paymentTerms: 30 })
      .expect(201);
    supplierId = supplier.body.id;
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

  async function makeProduct(code: string) {
    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/products`))
      .send({ code, name: code, productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    return p.body.id as string;
  }

  async function makeWarehouse(code: string, allowNegativeStock = false) {
    const w = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/warehouses`))
      .send({ code, name: code, allowNegativeStock })
      .expect(201);
    return w.body.id as string;
  }

  async function postGoodsReceipt(warehouseId: string, productId: string, quantity: number, price: number, documentDate: string) {
    const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/goods-receipts`))
      .send({ counterpartyId: supplierId, warehouseId, documentDate, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    const posted = await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version });
    expect(posted.status).toBe(201);
    return gr.body.id as string;
  }

  describe('Plan + Scope', () => {
    it('rejects markReady on a plan with no scope defined', async () => {
      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-02-01', countType: 'FULL' })
        .expect(201);
      expect(plan.body.status).toBe('DRAFT');
      expect(plan.body.scopes).toHaveLength(0);

      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}/mark-ready`)).send({ expectedVersion: plan.body.version });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no inventory scope has been defined/);
    });

    it('accepts markReady once a scope exists, and a second tenant cannot see the plan', async () => {
      const warehouseId = await makeWarehouse(`WH-CNT1-${run}`);
      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-02-01', countType: 'FULL', scopes: [{ warehouseId }] })
        .expect(201);
      expect(plan.body.scopes).toHaveLength(1);
      expect(plan.body.number).toMatch(/^IC/);

      const ready = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}/mark-ready`)).send({ expectedVersion: plan.body.version });
      expect(ready.status).toBe(201);
      expect(ready.body.status).toBe('READY');

      const isolated = await auth2(request(app.getHttpServer()).get(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}`));
      expect(isolated.status).toBe(404);
    });

    it('blocks scope changes once a session for the plan has left DRAFT', async () => {
      const warehouseId = await makeWarehouse(`WH-CNT2-${run}`);
      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-02-01', countType: 'FULL', scopes: [{ warehouseId }] })
        .expect(201);

      // A session leaving DRAFT is Task #10's own service; simulate it
      // directly here to prove the guard itself, independent of that
      // not-yet-built service.
      await prisma.inventoryCountSession.create({
        data: { tenantId: tenant1Id, organizationId: orgId, inventoryCountPlanId: plan.body.id, status: 'COUNTING', freezePolicy: 'NO_FREEZE_WITH_MOVEMENT_TRACKING', blindCount: true },
      });

      const addRes = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}/scopes`)).send({ warehouseId });
      expect(addRes.status).toBe(409);
      expect(addRes.body.message).toMatch(/can no longer be changed/);

      const scopeId = plan.body.scopes[0].id;
      const removeRes = await auth1(request(app.getHttpServer()).delete(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}/scopes/${scopeId}`));
      expect(removeRes.status).toBe(409);
    });
  });

  describe('Snapshot generation (spec sections 8-10)', () => {
    it('builds one immutable snapshot line per full dimension tuple, valued from the costing engine when a policy exists', async () => {
      const warehouseId = await makeWarehouse(`WH-SNAP1-${run}`);
      const productA = await makeProduct(`SNAP-A-${run}`);
      const productB = await makeProduct(`SNAP-B-${run}`);

      await postGoodsReceipt(warehouseId, productA, 40, 5, '2026-02-01');
      await postGoodsReceipt(warehouseId, productB, 10, 20, '2026-02-01');

      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-02-05', countType: 'FULL', scopes: [{ warehouseId }] })
        .expect(201);

      const session = await prisma.inventoryCountSession.create({
        data: { tenantId: tenant1Id, organizationId: orgId, inventoryCountPlanId: plan.body.id, status: 'DRAFT', freezePolicy: 'NO_FREEZE_WITH_MOVEMENT_TRACKING', blindCount: true },
      });

      const written = await prisma.runInTransaction((tx) => snapshotService.generate(tenant1Id, orgId, session.id, new Date('2026-02-05'), tx));
      expect(written).toBe(2);

      const lines = await prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId: tenant1Id, sessionId: session.id }, orderBy: { productId: 'asc' } });
      expect(lines).toHaveLength(2);
      const lineA = lines.find((l) => l.productId === productA)!;
      const lineB = lines.find((l) => l.productId === productB)!;
      expect(Number(lineA.accountingQuantity)).toBeCloseTo(40, 6);
      expect(lineA.qualityStatus).toBe('AVAILABLE');
      expect(lineA.warehouseId).toBe(warehouseId);
      expect(Number(lineB.accountingQuantity)).toBeCloseTo(10, 6);

      // Regenerating the same session's snapshot is refused — it is
      // written once and never silently replaced.
      await expect(prisma.runInTransaction((tx) => snapshotService.generate(tenant1Id, orgId, session.id, new Date('2026-02-05'), tx))).rejects.toThrow(/already has a snapshot/);
    });

    it('excludes movements outside the plan scope and after the cutoff date', async () => {
      const warehouseIn = await makeWarehouse(`WH-SNAP-IN-${run}`);
      const warehouseOut = await makeWarehouse(`WH-SNAP-OUT-${run}`);
      const product = await makeProduct(`SNAP-C-${run}`);

      await postGoodsReceipt(warehouseIn, product, 25, 8, '2026-02-01');
      await postGoodsReceipt(warehouseOut, product, 99, 8, '2026-02-01');
      await postGoodsReceipt(warehouseIn, product, 5, 8, '2026-03-01'); // after cutoff

      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-02-10', countType: 'FULL', scopes: [{ warehouseId: warehouseIn }] })
        .expect(201);
      const session = await prisma.inventoryCountSession.create({
        data: { tenantId: tenant1Id, organizationId: orgId, inventoryCountPlanId: plan.body.id, status: 'DRAFT', freezePolicy: 'NO_FREEZE_WITH_MOVEMENT_TRACKING', blindCount: true },
      });

      await prisma.runInTransaction((tx) => snapshotService.generate(tenant1Id, orgId, session.id, new Date('2026-02-10'), tx));

      const lines = await prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId: tenant1Id, sessionId: session.id } });
      expect(lines).toHaveLength(1);
      expect(lines[0].warehouseId).toBe(warehouseIn);
      expect(Number(lines[0].accountingQuantity)).toBeCloseTo(25, 6);
    });
  });

  describe('Session / Sheet / Entry lifecycle (Task #10)', () => {
    async function driveSessionToCounting(warehouseId: string) {
      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-04-01', countType: 'FULL', scopes: [{ warehouseId }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}/mark-ready`)).send({ expectedVersion: plan.body.version }).expect(201);

      const session = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions`))
        .send({ inventoryCountPlanId: plan.body.id })
        .expect(201);
      expect(session.body.status).toBe('DRAFT');
      expect(session.body.sessionNumber).toMatch(/^ICS/);

      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/snapshot`)).expect(201);

      const sheets = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/sheets/generate`)).send({}).expect(201);
      expect(sheets.body.length).toBeGreaterThan(0);

      const begun = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/begin-counting`)).expect(201);
      expect(begun.body.status).toBe('COUNTING');

      return { planId: plan.body.id, sessionId: session.body.id as string, sheetId: sheets.body[0].id as string };
    }

    it('runs the full happy path: start -> snapshot -> sheets -> blind entry submission -> correction -> complete', async () => {
      const warehouseId = await makeWarehouse(`WH-SESS1-${run}`);
      const product = await makeProduct(`SESS-P1-${run}`);
      await postGoodsReceipt(warehouseId, product, 20, 4, '2026-03-01');

      const { sessionId, sheetId } = await driveSessionToCounting(warehouseId);

      const entry = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId: product, unitId, countedQuantity: 18 })
        .expect(201);
      expect(entry.body.countedQuantity).toBe('18');
      expect(entry.body.entryVersion).toBe(1);
      // Blind count: nothing in the entry response reveals the accounting quantity.
      expect(JSON.stringify(entry.body)).not.toMatch(/accountingQuantity/);

      // A second submission for the exact same tuple is a correction, not
      // a duplicate — the prior value is preserved in its version history.
      const corrected = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId: product, unitId, countedQuantity: 19, reason: 'recount by hand' })
        .expect(201);
      expect(corrected.body.id).toBe(entry.body.id);
      expect(corrected.body.countedQuantity).toBe('19');
      expect(corrected.body.entryVersion).toBe(2);

      const versions = await prisma.inventoryCountEntryVersion.findMany({ where: { tenantId: tenant1Id, entryId: entry.body.id } });
      expect(versions).toHaveLength(1);
      expect(Number(versions[0].oldQuantity)).toBeCloseTo(18, 6);
      expect(Number(versions[0].newQuantity)).toBeCloseTo(19, 6);

      // Supervisor-only comparison surfaces the book quantity the blind
      // entry endpoint never exposed.
      const compare = await auth1(request(app.getHttpServer()).get(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries/compare`)).expect(200);
      const compared = compare.body.find((c: any) => c.entry.id === entry.body.id);
      expect(Number(compared.accountingQuantity)).toBeCloseTo(20, 6);

      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/complete`)).expect(201);
      const completedSession = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/complete`)).expect(201);
      expect(completedSession.body.status).toBe('UNDER_REVIEW');
    });

    it('converts a counted quantity to the base unit via a configured unit conversion', async () => {
      const box = await auth1(request(app.getHttpServer()).post('/units-of-measure')).send({ code: `BOX-${run}`, name: 'Box', symbol: 'box', unitType: 'QUANTITY' }).expect(201);
      await auth1(request(app.getHttpServer()).post('/unit-conversions')).send({ fromUnitId: box.body.id, toUnitId: unitId, factor: 12 }).expect(201);

      const warehouseId = await makeWarehouse(`WH-SESS2-${run}`);
      const product = await makeProduct(`SESS-P2-${run}`);
      await postGoodsReceipt(warehouseId, product, 24, 4, '2026-03-01');
      const { sessionId, sheetId } = await driveSessionToCounting(warehouseId);

      const entry = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId: product, unitId: box.body.id, countedQuantity: 2 })
        .expect(201);
      expect(entry.body.countedQuantity).toBe('2');
      expect(Number(entry.body.baseQuantity)).toBeCloseTo(24, 6);
    });

    it('requires serial numbers for a serial-tracked product and rejects a serial counted twice in the same session', async () => {
      const warehouseId = await makeWarehouse(`WH-SESS3-${run}`);
      const p = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/products`))
        .send({ code: `SESS-SER-${run}`, name: `SESS-SER-${run}`, productType: 'GOODS', baseUnitId: unitId, serialTrackingMode: 'REQUIRED' })
        .expect(201);
      const productId = p.body.id;

      const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: '2026-03-01', lines: [{ productId, unitId, quantity: 2, price: 100, serialNumbers: [`SN-A-${run}`, `SN-B-${run}`] }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);

      const { sessionId, sheetId } = await driveSessionToCounting(warehouseId);

      const missingSerials = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId, unitId, countedQuantity: 2 });
      expect(missingSerials.status).toBe(400);
      expect(missingSerials.body.message).toMatch(/requires serial numbers/);

      const ok = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId, unitId, countedQuantity: 2, serialNumbers: [`SN-A-${run}`, `SN-B-${run}`] })
        .expect(201);
      expect(ok.body.serials).toHaveLength(2);

      // A second product entry in the SAME session trying to claim one of
      // those exact serials again is rejected (spec section 24).
      const otherProduct = await makeProduct(`SESS-SER2-${run}`);
      const dup = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId: otherProduct, unitId, countedQuantity: 1, serialNumbers: [`SN-A-${run}`] });
      expect(dup.status).toBe(422);
    });

    it('requires a batch for a batch-tracked product', async () => {
      const warehouseId = await makeWarehouse(`WH-SESS4-${run}`);
      const p = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/products`))
        .send({ code: `SESS-BATCH-${run}`, name: `SESS-BATCH-${run}`, productType: 'GOODS', baseUnitId: unitId, batchTrackingMode: 'REQUIRED' })
        .expect(201);
      const productId = p.body.id;

      const gr = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/goods-receipts`))
        .send({ counterpartyId: supplierId, warehouseId, documentDate: '2026-03-01', lines: [{ productId, unitId, quantity: 10, price: 5, batchNumber: `BATCH-${run}` }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/documents/GOODS_RECEIPT/${gr.body.id}/post`)).send({ expectedVersion: gr.body.version }).expect(201);
      const batch = await prisma.batch.findFirst({ where: { tenantId: tenant1Id, productId, batchNumber: `BATCH-${run}` } });

      const { sessionId, sheetId } = await driveSessionToCounting(warehouseId);

      const noBatch = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId, unitId, countedQuantity: 10 });
      expect(noBatch.status).toBe(400);

      const withBatch = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId, unitId, countedQuantity: 10, batchId: batch!.id })
        .expect(201);
      expect(withBatch.body.batchId).toBe(batch!.id);
    });

    it('a retried submission with the same clientEntryId is a no-op, not a second correction', async () => {
      const warehouseId = await makeWarehouse(`WH-SESS5-${run}`);
      const product = await makeProduct(`SESS-P5-${run}`);
      await postGoodsReceipt(warehouseId, product, 5, 2, '2026-03-01');
      const { sessionId, sheetId } = await driveSessionToCounting(warehouseId);

      const clientEntryId = `mobile-${run}`;
      const first = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId: product, unitId, countedQuantity: 5, clientEntryId })
        .expect(201);

      const retried = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${sessionId}/sheets/${sheetId}/entries`))
        .send({ warehouseId, productId: product, unitId, countedQuantity: 999, clientEntryId })
        .expect(201);
      expect(retried.body.id).toBe(first.body.id);
      expect(retried.body.countedQuantity).toBe('5');
      expect(retried.body.entryVersion).toBe(1);
    });

    it('cannot begin counting without generated sheets, and cannot complete a session with an incomplete sheet', async () => {
      const warehouseId = await makeWarehouse(`WH-SESS6-${run}`);
      const product = await makeProduct(`SESS-P6-${run}`);
      await postGoodsReceipt(warehouseId, product, 3, 1, '2026-03-01');

      const plan = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans`))
        .send({ planDate: '2026-04-01', countType: 'FULL', scopes: [{ warehouseId }] })
        .expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/plans/${plan.body.id}/mark-ready`)).send({ expectedVersion: plan.body.version }).expect(201);
      const session = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions`)).send({ inventoryCountPlanId: plan.body.id }).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/snapshot`)).expect(201);

      const tooEarly = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/begin-counting`));
      expect(tooEarly.status).toBe(400);

      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/sheets/generate`)).send({}).expect(201);
      await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/begin-counting`)).expect(201);

      const tooSoon = await auth1(request(app.getHttpServer()).post(`/organizations/${orgId}/inventory-count/sessions/${session.body.id}/complete`));
      expect(tooSoon.status).toBe(400);
    });
  });
});
