/**
 * Phase 12 — Inventory Count / İnventarizasiya E2E tests.
 *
 * Covers the spec's test scenarios (sections 115-132, 138): basic count,
 * shortage, surplus, blind count, post-snapshot movements (no freeze),
 * location / batch / serial mismatch, recount, hard freeze + scope
 * control, uncounted vs explicit zero, costing failure, idempotency,
 * concurrent (stale) movement, period lock, full reconciliation + close,
 * unit conversion, barcode scanning, CSV import, segregation of duties,
 * tenant isolation, and the final end-to-end 24/7 warehouse scenario.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { InventoryMovementService } from '../src/warehouse-inventory/inventory-movement.service';

describe('Phase 12 — Inventory Count (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let pcsId: string;
  let boxId: string;
  let approverToken: string;
  let counterToken: string;
  let counterUserId: string;
  let seq = 0;

  const DOC_DATE = '2026-09-01';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`ic1-${run}@e2e.test`, `ic-t1-${run}`, 'IC1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;
    const s2 = await setupTenant(`ic2-${run}@e2e.test`, `ic-t2-${run}`, 'IC2');
    token2 = s2.token;
    tenant2Id = s2.tenantId;
    org2Id = s2.orgId;
    await app.get(ChartOfAccountsService).ensureAdopted(tenant1Id);

    pcsId = (await auth1(request(app.getHttpServer()).post('/units-of-measure')).send({ code: 'PCS12', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' }).expect(201)).body.id;
    boxId = (await auth1(request(app.getHttpServer()).post('/units-of-measure')).send({ code: 'BOX12', name: 'Box', symbol: 'box', unitType: 'QUANTITY' }).expect(201)).body.id;
    await prisma.unitConversion.create({ data: { tenantId: tenant1Id, fromUnitId: boxId, toUnitId: pcsId, factor: '12' } });

    const approver = await setupUser(`ic-approver-${run}@e2e.test`, ['inventory_count.view', 'inventory_count.approve', 'inventory_count.review', 'inventory_count.view_cost', 'inventory_count.view_accounting_qty'], ['WAREHOUSE_SUPERVISOR', 'FINANCE_USER', 'DIRECTOR']);
    approverToken = approver.token;
    const counter = await setupUser(`ic-counter-${run}@e2e.test`, ['inventory_count.view', 'inventory_count.enter', 'inventory_count.recount'], []);
    counterToken = counter.token;
    counterUserId = counter.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  // -- fixtures -----------------------------------------------------------------
  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Test User' }).expect(201);
    const token = reg.body.accessToken;
    const tenant = await request(app.getHttpServer()).post('/tenants').set('Authorization', `Bearer ${token}`).send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'USD' }).expect(201);
    const org = await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenant.body.id).send({ code: orgCode, name: `${orgCode} Org` }).expect(201);
    return { token, tenantId: tenant.body.id, orgId: org.body.id };
  }

  async function setupUser(email: string, permissionCodes: string[], roleCodes: string[]) {
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: email.split('@')[0] }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });
    const perms = await prisma.permission.findMany({ where: { code: { in: permissionCodes } } });
    const roles = roleCodes.length > 0 ? roleCodes : [`IC_CUSTOM_${run}_${Math.random().toString(36).slice(2, 8)}`];
    for (const code of roles) {
      const role = (await prisma.role.findFirst({ where: { tenantId: tenant1Id, code } })) ?? (await prisma.role.create({ data: { tenantId: tenant1Id, code, name: code } }));
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
    }
    return { token: reg.body.accessToken as string, userId: reg.body.userId as string };
  }

  const server = () => app.getHttpServer();
  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }
  function asApprover(req: request.Test) {
    return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
  }
  function asCounter(req: request.Test) {
    return req.set('Authorization', `Bearer ${counterToken}`).set('X-Tenant-Id', tenant1Id);
  }
  const base = () => `/organizations/${org1Id}/inventory-counts`;

  async function warehouse(allowNegative = false) {
    seq += 1;
    const res = await auth1(request(server()).post(`/organizations/${org1Id}/warehouses`)).send({ code: `IC-WH-${seq}`, name: `Count WH ${seq}` }).expect(201);
    if (allowNegative) await prisma.warehouse.update({ where: { id: res.body.id }, data: { allowNegativeStock: true } });
    return res.body.id as string;
  }
  async function location(warehouseId: string, code: string) {
    return (await prisma.warehouseLocation.create({ data: { tenantId: tenant1Id, warehouseId, code: `${code}-${seq}`, name: code } })).id;
  }
  async function product(extra: Record<string, unknown> = {}) {
    seq += 1;
    const res = await auth1(request(server()).post(`/organizations/${org1Id}/products`)).send({ code: `IC-P-${seq}`, name: `Count product ${seq}`, productType: 'GOODS', baseUnitId: pcsId }).expect(201);
    if (Object.keys(extra).length > 0) await prisma.product.update({ where: { id: res.body.id }, data: extra });
    return res.body.id as string;
  }
  async function seedStock(warehouseId: string, productId: string, qty: number, opts: { locationId?: string; batchId?: string; serialId?: string; stockStatus?: string; cost?: number | null } = {}) {
    await prisma.inventoryMovement.create({
      data: {
        tenantId: tenant1Id,
        organizationId: org1Id,
        warehouseId,
        productId,
        unitId: pcsId,
        locationId: opts.locationId,
        batchId: opts.batchId,
        serialId: opts.serialId,
        stockStatus: opts.stockStatus ?? 'AVAILABLE',
        movementType: 'PURCHASE_RECEIPT',
        quantity: String(qty),
        baseQuantity: String(qty),
        provisionalCost: opts.cost === null ? undefined : String(opts.cost ?? 10),
        effectiveDate: new Date(DOC_DATE),
        registrarDocumentType: 'TEST_STOCK_SEED',
        registrarDocumentId: `seed-${run}-${Math.random()}`,
      },
    });
  }
  async function balance(warehouseId: string, productId: string, where: Record<string, unknown> = {}) {
    const agg = await prisma.inventoryMovement.aggregate({ where: { tenantId: tenant1Id, warehouseId, productId, ...where }, _sum: { baseQuantity: true } });
    return Number(agg._sum.baseQuantity ?? 0);
  }
  async function recordMovement(input: Record<string, unknown>) {
    const movements = app.get(InventoryMovementService);
    await prisma.runInTransaction((tx) =>
      movements.recordMovement(tenant1Id, { organizationId: org1Id, unitId: pcsId, effectiveDate: new Date(DOC_DATE), registrarDocumentType: 'TEST_OPERATION', registrarDocumentId: `op-${Math.random()}`, ...(input as any) }, tx),
    );
  }

  /** Plan + start + snapshot + sheets. */
  async function startCount(warehouseId: string, planFields: Record<string, unknown> = {}, extraScope: { dimension: string; valueId: string; ruleType?: string }[] = []) {
    const plan = await auth1(request(server()).post(base()))
      .send({ countType: 'PARTIAL', planDate: DOC_DATE, blindCountEnabled: true, scope: [{ dimension: 'WAREHOUSE', valueId: warehouseId }, ...extraScope], ...planFields })
      .expect(201);
    const planId = plan.body.id as string;
    await auth1(request(server()).post(`${base()}/${planId}/start`)).expect(201);
    await auth1(request(server()).post(`${base()}/${planId}/snapshot`)).send({}).expect(201);
    const sheets = await auth1(request(server()).post(`${base()}/${planId}/sheets/generate`)).send({}).expect(201);
    return { planId, sheetId: sheets.body[0].id as string, documentNumber: plan.body.documentNumber as string };
  }
  async function enter(planId: string, sheetId: string, items: Record<string, unknown>[], expected = 201) {
    return auth1(request(server()).post(`${base()}/${planId}/entries`)).send({ entries: items.map((i) => ({ sheetId, ...i })) }).expect(expected);
  }
  async function completeCounting(planId: string) {
    const sheets = await auth1(request(server()).get(`${base()}/${planId}/sheets`)).expect(200);
    for (const s of sheets.body) if (s.status !== 'COMPLETED') await auth1(request(server()).post(`${base()}/${planId}/sheets/${s.id}/complete`)).expect(201);
    return auth1(request(server()).post(`${base()}/${planId}/complete-count`)).expect(201);
  }
  async function variances(planId: string) {
    return (await auth1(request(server()).get(`${base()}/${planId}/variances`)).expect(200)).body as any[];
  }
  async function approveAll(planId: string) {
    const submitted = await auth1(request(server()).post(`${base()}/${planId}/submit`)).expect(201);
    if (submitted.body.status === 'APPROVED') return submitted.body;
    for (let i = 0; i < 4; i++) {
      const r = await asApprover(request(server()).post(`${base()}/${planId}/approve`)).send({ comment: 'ok' }).expect(201);
      if (r.body.status === 'APPROVED') return r.body;
    }
    throw new Error('approval did not complete');
  }
  async function postAll(planId: string) {
    await auth1(request(server()).post(`${base()}/${planId}/create-adjustments`)).send({}).expect(201);
    return auth1(request(server()).post(`${base()}/${planId}/post-adjustments`)).expect(201);
  }
  async function reconcileAndClose(planId: string) {
    const rec = await auth1(request(server()).post(`${base()}/${planId}/reconcile`)).expect(201);
    expect(rec.body.reconciliation.status).toBe('BALANCED');
    expect(rec.body.session.status).toBe('RECONCILED');
    const closed = await auth1(request(server()).post(`${base()}/${planId}/close`)).expect(201);
    expect(closed.body.status).toBe('CLOSED');
    return rec.body.reconciliation;
  }

  // -- scenarios -------------------------------------------------------------------

  it('refuses to start a count without a scope (spec 114)', async () => {
    const plan = await auth1(request(server()).post(base())).send({ countType: 'AD_HOC', planDate: DOC_DATE }).expect(201);
    expect(plan.body.documentNumber).toMatch(/^IC-/);
    const res = await auth1(request(server()).post(`${base()}/${plan.body.id}/start`)).expect(422);
    expect(res.body.message).toBe('Count session cannot start because no inventory scope has been defined.');
  });

  it('BASIC COUNT: 100 = 100 → no variance, no adjustment, session reconciles and closes (spec 115)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100);
    const { planId, sheetId } = await startCount(wh);
    // Snapshot is immutable / not duplicated (spec 103).
    await auth1(request(server()).post(`${base()}/${planId}/snapshot`)).send({}).expect(409);
    await enter(planId, sheetId, [{ productId: p, quantity: 100 }]);
    const done = await completeCounting(planId);
    expect(done.body.variances.differences).toBe(0);
    const v = await variances(planId);
    expect(v).toHaveLength(1);
    expect(v[0].varianceType).toBe('MATCH');
    const approved = await approveAll(planId);
    expect(approved.status).toBe('APPROVED');
    const created = await auth1(request(server()).post(`${base()}/${planId}/create-adjustments`)).send({}).expect(201);
    expect(created.body.documents).toHaveLength(0);
    await auth1(request(server()).post(`${base()}/${planId}/post-adjustments`)).expect(201);
    await reconcileAndClose(planId);
    expect(await balance(wh, p)).toBe(100);
    const events = await auth1(request(server()).get(`${base()}/${planId}/events`)).expect(200);
    const types = events.body.map((e: any) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['InventoryCountPlanned', 'InventoryCountStarted', 'InventorySnapshotCreated', 'InventoryCountCompleted', 'InventoryVarianceCalculated', 'InventoryVarianceApproved', 'InventoryCountReconciled', 'InventoryCountClosed']));
  });

  it('SHORTAGE: 100 → 95, costed from inventory cost, balanced GL, idempotent posting (spec 116, 129)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100, { cost: 10 });
    const { planId, sheetId } = await startCount(wh);
    await enter(planId, sheetId, [{ productId: p, quantity: 95 }]);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(v[0].varianceType).toBe('SHORTAGE');
    expect(Number(v[0].quantityDifference)).toBe(-5);
    expect(Number(v[0].valueDifference)).toBe(-50);

    // Segregation of duties: the counter (token1 counted) cannot approve.
    await auth1(request(server()).post(`${base()}/${planId}/submit`)).expect(201);
    await auth1(request(server()).post(`${base()}/${planId}/approve`)).send({}).expect(403);
    const approved = await asApprover(request(server()).post(`${base()}/${planId}/approve`)).send({ comment: 'ok' }).expect(201);
    expect(approved.body.status).toBe('APPROVED');

    const posted = await postAll(planId);
    expect(posted.body.posted).toBe(1);
    expect(await balance(wh, p)).toBe(95);

    const docs = (await auth1(request(server()).get(`${base()}/${planId}/adjustments`)).expect(200)).body;
    expect(docs).toHaveLength(1);
    expect(docs[0].operationType).toBe('INVENTORY_SHORTAGE');
    expect(Number(docs[0].totalValue)).toBe(50);
    const je = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id, sourceDocumentType: 'INVENTORY_COUNT_ADJUSTMENT', sourceDocumentId: docs[0].id, status: 'POSTED' }, include: { lines: true } });
    expect(je).toBeTruthy();
    const debit = je!.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
    const credit = je!.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
    expect(debit).toBe(50);
    expect(credit).toBe(50);

    // Idempotency: repeating the post never duplicates stock or GL.
    const again = await auth1(request(server()).post(`${base()}/${planId}/post-adjustments`)).expect(201);
    expect(again.body.alreadyPosted).toBe(true);
    const doc = await prisma.inventoryCountAdjustment.findFirstOrThrow({ where: { id: docs[0].id } });
    await auth1(request(server()).post(`/documents/INVENTORY_COUNT_ADJUSTMENT/${doc.id}/post`)).send({ expectedVersion: doc.version }).expect(409);
    const recreate = await auth1(request(server()).post(`${base()}/${planId}/create-adjustments`)).send({}).expect(201);
    expect(recreate.body.created).toBe(false);
    expect(await balance(wh, p)).toBe(95);
    expect(await prisma.journalEntry.count({ where: { tenantId: tenant1Id, sourceDocumentType: 'INVENTORY_COUNT_ADJUSTMENT', sourceDocumentId: docs[0].id, status: 'POSTED' } })).toBe(1);

    const rec = await reconcileAndClose(planId);
    expect(rec.quantityReconciled).toBe(true);
    expect(rec.valueReconciled).toBe(true);
    expect(rec.glReconciled).toBe(true);
    expect(Number(rec.totalShortageValue)).toBe(50);
  });

  it('SURPLUS: 100 → 105, surplus valued by cost policy (spec 117)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100, { cost: 7 });
    const { planId, sheetId } = await startCount(wh, { surplusCostPolicy: 'LATEST_PURCHASE_COST' });
    await enter(planId, sheetId, [{ productId: p, quantity: 105 }]);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(v[0].varianceType).toBe('SURPLUS');
    expect(Number(v[0].valueDifference)).toBe(35);
    await approveAll(planId);
    await postAll(planId);
    expect(await balance(wh, p)).toBe(105);
    const doc = await prisma.inventoryCountAdjustment.findFirstOrThrow({ where: { tenantId: tenant1Id, sessionId: v[0].sessionId }, include: { lines: true } });
    expect(doc.operationType).toBe('INVENTORY_SURPLUS');
    expect(doc.lines[0].costSource).toBe('LATEST_PURCHASE_COST');
    const mv = await prisma.inventoryMovement.findFirstOrThrow({ where: { registrarDocumentId: doc.id } });
    expect(mv.movementType).toBe('INVENTORY_SURPLUS');
    expect(Number(mv.quantity)).toBe(5);
    expect(Number(mv.provisionalCost)).toBe(7);
    await reconcileAndClose(planId);
  });

  it('BLIND COUNT: counter never receives accounting quantity; variances only after completion (spec 18, 118)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100);
    const { planId, sheetId } = await startCount(wh, { team: [{ userId: counterUserId, role: 'COUNTER' }] });

    const counterView = await asCounter(request(server()).get(`${base()}/${planId}/sheets/${sheetId}`)).expect(200);
    expect(counterView.body.accountingQuantityVisible).toBe(false);
    expect(counterView.body.expectedLines[0].productId).toBe(p);
    expect(counterView.body.expectedLines[0]).not.toHaveProperty('accountingQuantity');
    // Even a user holding VIEW_ACCOUNTING_QTY does not get it while a blind count is counting.
    const adminView = await auth1(request(server()).get(`${base()}/${planId}/sheets/${sheetId}`)).expect(200);
    expect(adminView.body.expectedLines[0]).not.toHaveProperty('accountingQuantity');
    await asCounter(request(server()).get(`${base()}/${planId}/snapshot`)).expect(403);
    await asCounter(request(server()).get(`${base()}/${planId}/variances`)).expect(403);
    await auth1(request(server()).get(`${base()}/${planId}/variances`)).expect(409);

    await asCounter(request(server()).post(`${base()}/${planId}/entries`)).send({ entries: [{ sheetId, productId: p, quantity: 97 }] }).expect(201);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(Number(v[0].physicalQuantity)).toBe(97);
    expect(Number(v[0].adjustedAccountingQuantity)).toBe(100);
  });

  it('WAREHOUSE ACCESS: a counter not assigned to the count cannot enter quantities (spec 76)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 10);
    const { planId, sheetId } = await startCount(wh);
    const res = await asCounter(request(server()).post(`${base()}/${planId}/entries`)).send({ entries: [{ sheetId, productId: p, quantity: 10 }] }).expect(403);
    expect(res.body.code).toBe('INVENTORY_COUNT_WAREHOUSE_ACCESS');
  });

  it('POST-SNAPSHOT MOVEMENTS (no freeze): 100 +20 −10, physical 110 → zero variance (spec 63, 119)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100);
    const { planId, sheetId } = await startCount(wh, { freezePolicy: 'NO_FREEZE_WITH_MOVEMENT_TRACKING' });

    const receipt = await auth1(request(server()).post(`/organizations/${org1Id}/inventory-adjustments`)).send({ warehouseId: wh, adjustmentType: 'SURPLUS', documentDate: DOC_DATE, lines: [{ productId: p, unitId: pcsId, quantity: 20 }] }).expect(201);
    await auth1(request(server()).post(`/documents/INVENTORY_ADJUSTMENT/${receipt.body.id}/post`)).send({ expectedVersion: receipt.body.version }).expect(201);
    const issue = await auth1(request(server()).post(`/organizations/${org1Id}/inventory-adjustments`)).send({ warehouseId: wh, adjustmentType: 'WRITE_OFF', documentDate: DOC_DATE, lines: [{ productId: p, unitId: pcsId, quantity: 10 }] }).expect(201);
    await auth1(request(server()).post(`/documents/INVENTORY_ADJUSTMENT/${issue.body.id}/post`)).send({ expectedVersion: issue.body.version }).expect(201);

    await enter(planId, sheetId, [{ productId: p, quantity: 110 }]);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(v).toHaveLength(1);
    expect(Number(v[0].accountingQuantity)).toBe(100);
    expect(Number(v[0].postSnapshotInQuantity)).toBe(20);
    expect(Number(v[0].postSnapshotOutQuantity)).toBe(10);
    expect(Number(v[0].adjustedAccountingQuantity)).toBe(110);
    expect(Number(v[0].quantityDifference)).toBe(0);
    expect(v[0].varianceType).toBe('MATCH');
    const moves = await auth1(request(server()).get(`${base()}/${planId}/movements`)).expect(200);
    expect(moves.body).toHaveLength(2);
    await approveAll(planId);
    await postAll(planId);
    await reconcileAndClose(planId);
  });

  it('LOCATION MISMATCH: A 50→40, B 50→60 → location mismatch, location correction only, no financial posting (spec 26, 50, 120)', async () => {
    const wh = await warehouse();
    const locA = await location(wh, 'A');
    const locB = await location(wh, 'B');
    const p = await product();
    await seedStock(wh, p, 50, { locationId: locA });
    await seedStock(wh, p, 50, { locationId: locB });
    const { planId, sheetId } = await startCount(wh);
    await enter(planId, sheetId, [
      { productId: p, locationId: locA, quantity: 40 },
      { productId: p, locationId: locB, quantity: 60 },
    ]);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.varianceType === 'LOCATION_MISMATCH')).toBe(true);
    expect(v.every((x) => x.effectiveResolution === 'LOCATION_TRANSFER')).toBe(true);
    const loc = await auth1(request(server()).get(`${base()}/${planId}/reports/locations`)).expect(200);
    expect(loc.body[0].suggestion).toMatch(/Possible location mismatch: 10 units missing/);

    await approveAll(planId);
    await postAll(planId);
    const docs = (await auth1(request(server()).get(`${base()}/${planId}/adjustments`)).expect(200)).body;
    expect(docs.map((d: any) => d.operationType)).toEqual(['LOCATION_CORRECTION']);
    expect(await prisma.journalEntry.count({ where: { sourceDocumentId: docs[0].id } })).toBe(0);
    expect(await balance(wh, p, { locationId: locA })).toBe(40);
    expect(await balance(wh, p, { locationId: locB })).toBe(60);
    await reconcileAndClose(planId);
  });

  it('BATCH MISMATCH: two separate batch variance records despite net zero (spec 25, 33, 121)', async () => {
    const wh = await warehouse();
    const p = await product({ batchTrackingMode: 'REQUIRED' });
    const bA = await prisma.batch.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId: p, batchNumber: `BA-${run}` } });
    const bB = await prisma.batch.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId: p, batchNumber: `BB-${run}` } });
    await seedStock(wh, p, 50, { batchId: bA.id });
    await seedStock(wh, p, 50, { batchId: bB.id });
    const { planId, sheetId } = await startCount(wh);
    // Batch-controlled: a count without batch is rejected.
    await enter(planId, sheetId, [{ productId: p, quantity: 5 }], 400);
    await enter(planId, sheetId, [
      { productId: p, batchNumber: `BA-${run}`, quantity: 45 },
      { productId: p, batchId: bB.id, quantity: 55 },
    ]);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.varianceType)).toEqual(['BATCH_MISMATCH', 'BATCH_MISMATCH']);
    expect(v.map((x) => Number(x.quantityDifference)).sort()).toEqual([-5, 5]);
    const br = await auth1(request(server()).get(`${base()}/${planId}/reports/batches`)).expect(200);
    expect(br.body.every((r: any) => Number(r.potentialCrossBatchOffset) === 5)).toBe(true);
    await approveAll(planId);
    await postAll(planId);
    expect(await balance(wh, p, { batchId: bA.id })).toBe(45);
    expect(await balance(wh, p, { batchId: bB.id })).toBe(55);
  });

  it('SERIAL MISMATCH: expected SN1..SN3, found SN1, SN3, SN4 → SN2 missing, SN4 unexpected; duplicate scan blocked (spec 24, 122)', async () => {
    const wh = await warehouse();
    const p = await product({ serialTrackingMode: 'REQUIRED' });
    const serials: Record<string, string> = {};
    for (const sn of ['SN1', 'SN2', 'SN3']) {
      const s = await prisma.serialNumber.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId: p, serialNumber: `${sn}-${run}`, currentWarehouseId: wh } });
      serials[sn] = s.id;
      await seedStock(wh, p, 1, { serialId: s.id });
    }
    const { planId, sheetId } = await startCount(wh);
    await auth1(request(server()).post(`${base()}/${planId}/entries/scan`)).send({ sheetId, barcode: `SN1-${run}` }).expect(201);
    const dup = await auth1(request(server()).post(`${base()}/${planId}/entries/scan`)).send({ sheetId, barcode: `SN1-${run}` }).expect(409);
    expect(dup.body.message).toBe(`Serial SN1-${run} was counted twice.`);
    await enter(planId, sheetId, [
      { productId: p, serialNumber: `SN3-${run}`, quantity: 1 },
      { productId: p, serialNumber: `SN4-${run}`, quantity: 1 },
    ]);
    await completeCounting(planId);
    const v = await variances(planId);
    const missing = v.filter((x) => x.varianceType === 'SERIAL_MISSING');
    const unexpected = v.filter((x) => x.varianceType === 'SERIAL_UNEXPECTED');
    expect(missing.map((x) => x.serialNumber)).toEqual([`SN2-${run}`]);
    expect(unexpected.map((x) => x.serialNumber)).toEqual([`SN4-${run}`]);
    const report = await auth1(request(server()).get(`${base()}/${planId}/reports/serials`)).expect(200);
    expect(report.body.missing).toEqual([`SN2-${run}`]);
    expect(report.body.unexpected).toEqual([`SN4-${run}`]);
    expect(missing[0].effectiveResolution).toBe('SERIAL_CORRECTION');

    await approveAll(planId);
    await postAll(planId);
    const docs = (await auth1(request(server()).get(`${base()}/${planId}/adjustments`)).expect(200)).body;
    expect(docs.map((d: any) => d.operationType)).toEqual(['SERIAL_CORRECTION']);
    const sn2 = await prisma.serialNumber.findFirstOrThrow({ where: { id: serials.SN2 } });
    expect(sn2.status).toBe('MISSING');
    const sn4 = await prisma.serialNumber.findFirstOrThrow({ where: { organizationId: org1Id, productId: p, serialNumber: `SN4-${run}` } });
    expect(sn4.status).toBe('AVAILABLE');
    expect(await balance(wh, p)).toBe(3);
    await reconcileAndClose(planId);
  });

  it('RECOUNT: 100 counted 90, recount above 5% → recount 99 → variance −1; original count kept (spec 38-41, 123)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100);
    const { planId, sheetId } = await startCount(wh, { recountPolicy: 'RECOUNT_PERCENTAGE', recountPercentThreshold: 5 });
    await enter(planId, sheetId, [{ productId: p, quantity: 90 }]);
    const done = await completeCounting(planId);
    expect(done.body.variances.recountsRequested).toBe(1);
    // Posting/approval is blocked while the recount is pending.
    const blocked = await auth1(request(server()).post(`${base()}/${planId}/submit`)).expect(409);
    expect(blocked.body.message).toBe('Inventory adjustment cannot be posted because recount is still pending for 1 variance lines.');

    const recounts = await auth1(request(server()).get(`${base()}/${planId}/recounts?status=PENDING`)).expect(200);
    expect(recounts.body).toHaveLength(1);
    await auth1(request(server()).post(`${base()}/${planId}/recounts/${recounts.body[0].id}/complete`)).send({ physicalQuantity: 99 }).expect(201);
    const v = await variances(planId);
    expect(Number(v[0].countedQuantity)).toBe(90);
    expect(Number(v[0].physicalQuantity)).toBe(99);
    expect(Number(v[0].quantityDifference)).toBe(-1);
    expect(v[0].recountStatus).toBe('COMPLETED');
    const hist = await auth1(request(server()).get(`${base()}/${planId}/variances/${v[0].id}`)).expect(200);
    expect(Number(hist.body.entries[0].countedQuantity)).toBe(90);
    expect(hist.body.recounts).toHaveLength(1);
    await approveAll(planId);
    await postAll(planId);
    expect(await balance(wh, p)).toBe(99);
  });

  it('HARD FREEZE blocks in-scope stock movements; other warehouses unaffected (spec 12, 124-125)', async () => {
    const wh = await warehouse();
    const other = await warehouse();
    const p = await product();
    await seedStock(wh, p, 100);
    await seedStock(other, p, 100);
    const { planId, documentNumber } = await startCount(wh, { freezePolicy: 'HARD_FREEZE' });
    await auth1(request(server()).post(`${base()}/${planId}/freeze`)).expect(201);

    const writeOff = await auth1(request(server()).post(`/organizations/${org1Id}/inventory-adjustments`)).send({ warehouseId: wh, adjustmentType: 'WRITE_OFF', documentDate: DOC_DATE, lines: [{ productId: p, unitId: pcsId, quantity: 5 }] }).expect(201);
    const blocked = await auth1(request(server()).post(`/documents/INVENTORY_ADJUSTMENT/${writeOff.body.id}/post`)).send({ expectedVersion: writeOff.body.version }).expect(409);
    expect(blocked.body.message).toMatch(new RegExp(`^Warehouse IC-WH-\\d+ is locked for inventory count session ${documentNumber}\\.$`));
    expect(await prisma.inventoryMovement.count({ where: { registrarDocumentId: writeOff.body.id } })).toBe(0);
    expect(await balance(wh, p)).toBe(100);

    // Scope isolation: the other warehouse keeps moving.
    const otherWriteOff = await auth1(request(server()).post(`/organizations/${org1Id}/inventory-adjustments`)).send({ warehouseId: other, adjustmentType: 'WRITE_OFF', documentDate: DOC_DATE, lines: [{ productId: p, unitId: pcsId, quantity: 5 }] }).expect(201);
    await auth1(request(server()).post(`/documents/INVENTORY_ADJUSTMENT/${otherWriteOff.body.id}/post`)).send({ expectedVersion: otherWriteOff.body.version }).expect(201);
    expect(await balance(other, p)).toBe(95);

    // A second count cannot hard-freeze the same warehouse.
    const second = await startCount(wh, { freezePolicy: 'HARD_FREEZE' });
    const clash = await auth1(request(server()).post(`${base()}/${second.planId}/freeze`)).expect(409);
    expect(clash.body.message).toMatch(/is already locked by inventory count/);

    await auth1(request(server()).post(`${base()}/${planId}/unfreeze`)).send({ reason: 'done' }).expect(201);
    const after = await auth1(request(server()).post(`/organizations/${org1Id}/inventory-adjustments`)).send({ warehouseId: wh, adjustmentType: 'WRITE_OFF', documentDate: DOC_DATE, lines: [{ productId: p, unitId: pcsId, quantity: 5 }] }).expect(201);
    await auth1(request(server()).post(`/documents/INVENTORY_ADJUSTMENT/${after.body.id}/post`)).send({ expectedVersion: after.body.version }).expect(201);
  });

  it('SOFT FREEZE lets movements through with an audited session linkage (spec 13)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 50);
    const { planId } = await startCount(wh, { freezePolicy: 'SOFT_FREEZE' });
    await auth1(request(server()).post(`${base()}/${planId}/freeze`)).expect(201);
    const doc = await auth1(request(server()).post(`/organizations/${org1Id}/inventory-adjustments`)).send({ warehouseId: wh, adjustmentType: 'WRITE_OFF', documentDate: DOC_DATE, lines: [{ productId: p, unitId: pcsId, quantity: 1 }] }).expect(201);
    await auth1(request(server()).post(`/documents/INVENTORY_ADJUSTMENT/${doc.body.id}/post`)).send({ expectedVersion: doc.body.version }).expect(201);
    const plan = await prisma.inventoryCountPlan.findFirstOrThrow({ where: { id: planId } });
    const audit = await prisma.auditEvent.findFirst({ where: { tenantId: tenant1Id, eventType: 'INVENTORY_COUNT_FREEZE_OVERRIDDEN', entityId: plan.currentSessionId! } });
    expect(audit).toBeTruthy();
  });

  it('UNCOUNTED vs EXPLICIT ZERO: missing count is never zero; explicit 0 is a valid count (spec 85-86, 126-127)', async () => {
    const wh = await warehouse();
    const pA = await product();
    const pB = await product();
    await seedStock(wh, pA, 10);
    await seedStock(wh, pB, 10);
    const { planId, sheetId } = await startCount(wh);
    await enter(planId, sheetId, [{ productId: pB, quantity: 0 }]);
    await completeCounting(planId);
    const v = await variances(planId);
    const a = v.find((x) => x.productId === pA);
    const b = v.find((x) => x.productId === pB);
    expect(a.countStatus).toBe('UNCOUNTED');
    expect(a.varianceType).toBe('UNCOUNTED_ITEM');
    expect(a.physicalQuantity).toBeNull();
    expect(b.countStatus).toBe('ZERO_COUNT');
    expect(b.varianceType).toBe('SHORTAGE');
    expect(Number(b.quantityDifference)).toBe(-10);
    const progress = await auth1(request(server()).get(`${base()}/${planId}/progress`)).expect(200);
    expect(progress.body.uncountedLines).toBe(1);
    // An uncounted line blocks approval until someone decides.
    await auth1(request(server()).post(`${base()}/${planId}/submit`)).expect(409);
    await auth1(request(server()).patch(`${base()}/${planId}/variances/${a.id}`)).send({ resolutionType: 'NO_ADJUSTMENT', reasonCode: 'counting_error', comment: 'area not accessible' }).expect(200);
    await approveAll(planId);
    await postAll(planId);
    expect(await balance(wh, pA)).toBe(10);
    expect(await balance(wh, pB)).toBe(0);
    await reconcileAndClose(planId);
  });

  it('COSTING FAILURE: shortage with unresolved cost is blocked, no stock or zero-cost GL is written (spec 128)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 20, { cost: null });
    const { planId, sheetId } = await startCount(wh);
    await enter(planId, sheetId, [{ productId: p, quantity: 18 }]);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(v[0].costingStatus).toBe('UNRESOLVED');
    await approveAll(planId);
    await auth1(request(server()).post(`${base()}/${planId}/create-adjustments`)).send({}).expect(201);
    const res = await auth1(request(server()).post(`${base()}/${planId}/post-adjustments`)).expect(422);
    expect(res.body.message).toMatch(/^Shortage adjustment cannot be costed because inventory costing for the item .* is unresolved\.$/);
    expect(await balance(wh, p)).toBe(20);
    const docs = await prisma.inventoryCountAdjustment.findMany({ where: { tenantId: tenant1Id, sessionId: v[0].sessionId } });
    expect(docs[0].postingStatus).toBe('NOT_POSTED');
    expect(await prisma.journalEntry.count({ where: { sourceDocumentId: docs[0].id } })).toBe(0);
  });

  it('CONCURRENT MOVEMENT: a movement after approval makes the result stale and blocks posting (spec 59-60, 130)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 30);
    const { planId, sheetId } = await startCount(wh);
    await enter(planId, sheetId, [{ productId: p, quantity: 28 }]);
    await completeCounting(planId);
    await approveAll(planId);
    await recordMovement({ warehouseId: wh, productId: p, movementType: 'SALES_SHIPMENT', quantity: -3 });
    const res = await auth1(request(server()).post(`${base()}/${planId}/post-adjustments`)).expect(409);
    expect(res.body.message).toBe('Inventory count result is stale because new stock movements occurred after variance approval.');
    expect(await balance(wh, p)).toBe(27);
  });

  it('PERIOD LOCK: adjustment into a closed period is blocked (spec 61, 131)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 40);
    const period = await auth1(request(server()).post('/periods')).send({ organizationId: org1Id, year: 2026, month: 6 }).expect(201);
    await auth1(request(server()).post(`/periods/${period.body.id}/close`)).expect(201);
    const { planId, sheetId } = await startCount(wh, { adjustmentDatePolicy: 'EXPLICIT_DATE' });
    await enter(planId, sheetId, [{ productId: p, quantity: 39 }]);
    await completeCounting(planId);
    await approveAll(planId);
    await auth1(request(server()).post(`${base()}/${planId}/create-adjustments`)).send({}).expect(400);
    await auth1(request(server()).post(`${base()}/${planId}/create-adjustments`)).send({ adjustmentDate: '2026-06-30' }).expect(201);
    const res = await auth1(request(server()).post(`${base()}/${planId}/post-adjustments`)).expect(409);
    expect(res.body.code).toBe('PERIOD_CLOSED');
    expect(await balance(wh, p)).toBe(40);
  });

  it('UNIT CONVERSION + BARCODE + IDEMPOTENT ENTRIES: 3 boxes + 2 pcs = 38 base; scans increment (spec 22-23, 81, 104)', async () => {
    const wh = await warehouse();
    const p = await product({ barcode: `BC-${run}` });
    await seedStock(wh, p, 40);
    const { planId, sheetId } = await startCount(wh);
    await enter(planId, sheetId, [
      { productId: p, unitId: boxId, quantity: 3, clientEntryId: `m-${run}-1` },
      { productId: p, quantity: 2, clientEntryId: `m-${run}-2` },
    ]);
    // Offline re-sync with the same client ids does not double count.
    const replay = await enter(planId, sheetId, [{ productId: p, unitId: boxId, quantity: 3, clientEntryId: `m-${run}-1` }]);
    expect(replay.body[0].idempotentReplay).toBe(true);
    const entries = (await auth1(request(server()).get(`${base()}/${planId}/entries`)).expect(200)).body;
    expect(entries).toHaveLength(2);
    const boxEntry = entries.find((e: any) => e.unitId === boxId);
    expect(Number(boxEntry.conversionFactor)).toBe(12);
    expect(Number(boxEntry.baseQuantity)).toBe(36);

    await auth1(request(server()).post(`${base()}/${planId}/entries/scan`)).send({ sheetId, barcode: `BC-${run}` }).expect(201);
    const second = await auth1(request(server()).post(`${base()}/${planId}/entries/scan`)).send({ sheetId, barcode: `BC-${run}` }).expect(201);
    expect(Number(second.body.countedQuantity)).toBe(2);
    expect(second.body.entryVersion).toBe(2);
    await completeCounting(planId);
    const v = await variances(planId);
    expect(Number(v[0].physicalQuantity)).toBe(40);
    expect(v[0].varianceType).toBe('MATCH');
  });

  it('CSV IMPORT: strict validation (unknown product rejects the file), idempotent re-import (spec 80, 104)', async () => {
    const wh = await warehouse();
    const p = await product();
    const pCode = (await prisma.product.findFirstOrThrow({ where: { id: p } })).code;
    await seedStock(wh, p, 12);
    const { planId, sheetId } = await startCount(wh);
    const bad = await auth1(request(server()).post(`${base()}/${planId}/entries/import`)).send({ sheetId, csv: `product_code,quantity,unit\n${pCode},5,PCS12\nNOPE-${run},1,PCS12` }).expect(422);
    expect(bad.body.code).toBe('INVENTORY_COUNT_IMPORT_INVALID');
    expect(await prisma.inventoryCountEntry.count({ where: { sheetId } })).toBe(0);
    expect(await prisma.product.count({ where: { code: `NOPE-${run}` } })).toBe(0);
    const csv = `product_code,quantity,unit,external_entry_id\n${pCode},1,BOX12,imp-${run}-1`;
    const ok = await auth1(request(server()).post(`${base()}/${planId}/entries/import`)).send({ sheetId, csv }).expect(201);
    expect(ok.body.imported).toBe(1);
    const again = await auth1(request(server()).post(`${base()}/${planId}/entries/import`)).send({ sheetId, csv }).expect(201);
    expect(again.body).toEqual({ imported: 0, replayed: 1 });
  });

  it('SCOPE IMMUTABILITY + controlled reopen with audit (spec 6, 70)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 5);
    const { planId } = await startCount(wh);
    const plan = await auth1(request(server()).get(`${base()}/${planId}`)).expect(200);
    const res = await auth1(request(server()).put(`${base()}/${planId}`)).send({ expectedVersion: plan.body.version, scope: [{ dimension: 'PRODUCT', valueId: p }] }).expect(409);
    expect(res.body.code).toBe('INVENTORY_COUNT_SCOPE_IMMUTABLE');
    await auth1(request(server()).post(`${base()}/${planId}/reopen`)).send({ reason: 'scope revision' }).expect(201);
    const reopened = await auth1(request(server()).get(`${base()}/${planId}`)).expect(200);
    expect(reopened.body.status).toBe('DRAFT');
    await auth1(request(server()).put(`${base()}/${planId}`)).send({ expectedVersion: reopened.body.version, scope: [{ dimension: 'WAREHOUSE', valueId: wh }, { dimension: 'PRODUCT', valueId: p }], scopeChangeReason: 'narrow' }).expect(200);
    // Snapshot/history of the cancelled session is kept.
    expect(await prisma.inventoryCountSnapshotLine.count({ where: { sessionId: plan.body.currentSessionId } })).toBe(1);
    const restarted = await auth1(request(server()).post(`${base()}/${planId}/start`)).expect(201);
    expect(restarted.body.sessionNumber).toMatch(/-R2$/);
    const audit = await auth1(request(server()).get(`${base()}/${planId}/audit`)).expect(200);
    expect(audit.body.map((a: any) => a.eventType)).toEqual(expect.arrayContaining(['INVENTORY_COUNT_PLAN_CREATED', 'INVENTORY_COUNT_SESSION_STARTED', 'INVENTORY_COUNT_SNAPSHOT_GENERATED', 'INVENTORY_COUNT_SESSION_REOPENED', 'INVENTORY_COUNT_SCOPE_CHANGED']));
  });

  it('TENANT ISOLATION + COST CONFIDENTIALITY (spec 77)', async () => {
    const wh = await warehouse();
    const p = await product();
    await seedStock(wh, p, 10);
    const { planId, sheetId } = await startCount(wh, { team: [{ userId: counterUserId, role: 'COUNTER' }] });
    await auth2(request(server()).get(`/organizations/${org2Id}/inventory-counts/${planId}`)).expect(404);
    await auth2(request(server()).get(`/organizations/${org1Id}/inventory-counts/${planId}`)).expect(404);
    await enter(planId, sheetId, [{ productId: p, quantity: 9 }]);
    await completeCounting(planId);
    const adj = await asCounter(request(server()).get(`${base()}/${planId}/adjustments`)).expect(200);
    expect(adj.body).toEqual([]);
    const dash = await asCounter(request(server()).get(`/organizations/${org1Id}/inventory-count-reports/dashboard`)).expect(200);
    const row = dash.body.find((d: any) => d.planId === planId);
    expect(row).toBeTruthy();
    expect(row.shortageValue).toBeUndefined();
    const adminDash = await auth1(request(server()).get(`/organizations/${org1Id}/inventory-count-reports/dashboard`)).expect(200);
    expect(Number(adminDash.body.find((d: any) => d.planId === planId).shortageValue)).toBe(10);
  });

  it('MONTH CLOSE INTEGRATION: hasOpenInventoryCounts / year-end dependency (spec 62, 106)', async () => {
    const wh = await warehouse();
    await auth1(request(server()).post(base())).send({ countType: 'ANNUAL', planDate: '2026-12-31', scope: [{ dimension: 'WAREHOUSE', valueId: wh }] }).expect(201);
    const r = await auth1(request(server()).get(`/organizations/${org1Id}/inventory-count-reports/close-readiness?from=2026-12-01&to=2026-12-31`)).expect(200);
    expect(r.body.hasOpenInventoryCounts).toBe(true);
    expect(r.body.inventoryCountRequiredForClose).toBe(true);
    const health = await auth1(request(server()).get(`/organizations/${org1Id}/inventory-count-reports/health`)).expect(200);
    expect(health.body).toHaveProperty('openInventoryCounts');
    expect(health.body).toHaveProperty('approvedButUnpostedVariances');
  });

  it('FINAL SCENARIO: 24/7 warehouse, no freeze, blind count, location/batch detail, independent recount, finance approval, reconciliation (spec 138)', async () => {
    const wh = await warehouse();
    const locA = await location(wh, 'LA');
    const locB = await location(wh, 'LB');
    const p = await product({ batchTrackingMode: 'OPTIONAL' });
    const bX = await prisma.batch.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId: p, batchNumber: `X-${run}` } });
    const bY = await prisma.batch.create({ data: { tenantId: tenant1Id, organizationId: org1Id, productId: p, batchNumber: `Y-${run}` } });
    await seedStock(wh, p, 500, { locationId: locA, batchId: bX.id, cost: 4 });
    await seedStock(wh, p, 500, { locationId: locB, batchId: bY.id, cost: 4 });

    const { planId, sheetId } = await startCount(wh, {
      countType: 'CYCLE',
      freezePolicy: 'NO_FREEZE_WITH_MOVEMENT_TRACKING',
      recountPolicy: 'RECOUNT_ABOVE_QUANTITY_THRESHOLD',
      recountQuantityThreshold: 5,
      maxRecountAttempts: 1,
      requireIndependentRecount: true,
      team: [{ userId: counterUserId, role: 'COUNTER' }],
    });
    // 09:15 receipt +100, 09:30 shipment −50 (both at location B / batch Y).
    await recordMovement({ warehouseId: wh, productId: p, locationId: locB, batchId: bY.id, movementType: 'PURCHASE_RECEIPT', quantity: 100 });
    await recordMovement({ warehouseId: wh, productId: p, locationId: locB, batchId: bY.id, movementType: 'SALES_SHIPMENT', quantity: -50 });

    // Blind count: 490 at A, 552 at B (total 1,042).
    await enter(planId, sheetId, [
      { productId: p, locationId: locA, batchId: bX.id, quantity: 490 },
      { productId: p, locationId: locB, batchId: bY.id, quantity: 552 },
    ]);
    const done = await completeCounting(planId);
    expect(done.body.variances.recountsRequested).toBe(1);
    let v = await variances(planId);
    const a = v.find((x) => x.locationId === locA);
    const b = v.find((x) => x.locationId === locB);
    expect(Number(a.adjustedAccountingQuantity)).toBe(500);
    expect(Number(b.adjustedAccountingQuantity)).toBe(550);
    expect(Number(a.quantityDifference)).toBe(-10);
    expect(Number(b.quantityDifference)).toBe(2);

    // Independent recount: the original counter may not recount.
    const pending = (await auth1(request(server()).get(`${base()}/${planId}/recounts?status=PENDING`)).expect(200)).body;
    expect(pending).toHaveLength(1);
    await auth1(request(server()).post(`${base()}/${planId}/recounts/${pending[0].id}/complete`)).send({ physicalQuantity: 491 }).expect(403);
    const recountView = await asCounter(request(server()).get(`${base()}/${planId}/recounts?status=PENDING`)).expect(200);
    expect(recountView.body[0]).not.toHaveProperty('originalCountedQuantity');
    await asCounter(request(server()).post(`${base()}/${planId}/recounts/${pending[0].id}/complete`)).send({ physicalQuantity: 491 }).expect(201);

    v = await variances(planId);
    const total = v.reduce((s, x) => s + Number(x.physicalQuantity), 0);
    expect(total).toBe(1043);
    expect(v.reduce((s, x) => s + Number(x.quantityDifference), 0)).toBe(-7);

    await approveAll(planId);
    await postAll(planId);
    expect(await balance(wh, p)).toBe(1043);
    expect(await balance(wh, p, { locationId: locA })).toBe(491);
    expect(await balance(wh, p, { locationId: locB })).toBe(552);

    const rec = await reconcileAndClose(planId);
    expect(Number(rec.snapshotTotalQty)).toBe(1000);
    expect(Number(rec.postSnapshotInQty)).toBe(100);
    expect(Number(rec.postSnapshotOutQty)).toBe(50);
    expect(Number(rec.adjustedAccountingQty)).toBe(1050);
    expect(Number(rec.physicalQty)).toBe(1043);
    expect(Number(rec.actualFinalQty)).toBe(1043);
    expect(Number(rec.netValueDifference)).toBe(-28);
    expect(rec.glReconciled).toBe(true);

    const history = await auth1(request(server()).get(`/organizations/${org1Id}/inventory-count-reports/count-history/${p}`)).expect(200);
    expect(history.body.length).toBeGreaterThanOrEqual(2);
    const ss = await auth1(request(server()).get(`/organizations/${org1Id}/inventory-count-reports/surplus-shortage?groupBy=warehouse`)).expect(200);
    expect(ss.body.find((g: any) => g.key === wh)).toBeTruthy();
  });
});
