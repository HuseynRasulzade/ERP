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
});
