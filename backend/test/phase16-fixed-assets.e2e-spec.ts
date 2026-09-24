/**
 * Phase 16 — Fixed Assets / Əsas vəsaitlər (e2e).
 *
 * Covers the spec's key scenarios (sections 146-164, 170): CIP cost
 * formation (training expensed, 115,000 capitalized, over-capitalization
 * refused, residual blocks closure), acceptance != commissioning (no
 * depreciation before the start rule), straight-line with rounding,
 * residual value, idempotent depreciation posting, balanced GL entries,
 * commissioning reversal blocked by posted depreciation, transfer (cost/NBV
 * unchanged, history kept), modernization, impairment with prospective
 * depreciation, sale gain / write-off loss, fully depreciated asset stays
 * ACTIVE, physical inventory (wrong location -> transfer correction,
 * missing -> investigation, no write-off), concurrent capitalization of one
 * candidate, GL reconciliation difference, and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { AccountingPostingEngine } from '../src/accounting-core/accounting-posting-engine.service';

describe('Phase 16 — Fixed Assets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let categoryId: string;
  let offsetAccountId: string;
  let deptA: string;
  let deptB: string;
  let locA: string;
  let locB: string;

  const http = () => request(app.getHttpServer());
  const auth1 = (r: request.Test) => r.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  const auth2 = (r: request.Test) => r.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  const fa = (path: string) => `/organizations/${org1Id}/fixed-assets${path}`;

  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const reg = await http().post('/auth/register').send({ email, password: 'Test1234!', displayName: 'FA User' }).expect(201);
    const token = reg.body.accessToken;
    const tenant = await http().post('/tenants').set('Authorization', `Bearer ${token}`).send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'USD' }).expect(201);
    const org = await http().post('/organizations').set('Authorization', `Bearer ${token}`).set('X-Tenant-Id', tenant.body.id).send({ code: orgCode, name: `${orgCode} Org` }).expect(201);
    return { token, tenantId: tenant.body.id, orgId: org.body.id };
  }

  async function candidate(description: string, amount: number, costComponent = 'PURCHASE_PRICE', date = '2026-01-10') {
    const res = await auth1(http().post(fa('/acquisition-candidates'))).send({ description, amount, sourceDate: date, offsetAccountId, costComponent }).expect(201);
    return res.body;
  }

  async function openingAsset(name: string, opts: Record<string, unknown>) {
    const res = await auth1(http().post(fa('/opening-balances')))
      .send({ date: '2026-01-01', assets: [{ name, categoryId, commissioningDate: '2025-01-01', departmentId: deptA, locationId: locA, ...opts }] })
      .expect(201);
    return res.body.lines[0].assetId as string;
  }

  async function depreciate(period: string) {
    const calc = await auth1(http().post(fa('/depreciation/calculate'))).send({ period }).expect(201);
    const posted = await auth1(http().post(fa('/depreciation/post'))).send({ runId: calc.body.id }).expect(201);
    return posted.body;
  }

  async function card(id: string) {
    return (await auth1(http().get(fa(`/${id}`))).expect(200)).body;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`fa1-${run}@e2e.test`, `fa-t1-${run}`, 'FA1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const s2 = await setupTenant(`fa2-${run}@e2e.test`, `fa-t2-${run}`, 'FA2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;
    await app.get(ChartOfAccountsService).ensureAdopted(tenant1Id);

    offsetAccountId = (await prisma.account.findFirstOrThrow({ where: { tenantId: tenant1Id, code: '535' } })).id;
    const cat = await auth1(http().post('/fixed-asset-settings/categories')).send({ code: `MACH-${run}`, name: 'Machinery', defaultUsefulLifeMonths: 60, componentizationAllowed: true }).expect(201);
    categoryId = cat.body.id;
    deptA = (await auth1(http().post(`/organizations/${org1Id}/departments`)).send({ code: 'PROD-A', name: 'Production A' }).expect(201)).body.id;
    deptB = (await auth1(http().post(`/organizations/${org1Id}/departments`)).send({ code: 'PROD-B', name: 'Production B' }).expect(201)).body.id;
    locA = (await auth1(http().post(`/organizations/${org1Id}/fixed-asset-locations`)).send({ code: 'LOC-A', name: 'Hall A' }).expect(201)).body.id;
    locB = (await auth1(http().post(`/organizations/${org1Id}/fixed-asset-locations`)).send({ code: 'LOC-B', name: 'Hall B' }).expect(201)).body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  let machineId: string;

  it('CIP cost formation: training expensed, 115,000 capitalized, over-capitalization refused (147, 90)', async () => {
    const equipment = await candidate('Production machine', 100000);
    const transport = await candidate('Transport', 5000, 'FREIGHT');
    const installation = await candidate('Installation', 10000, 'INSTALLATION');
    const training = await candidate('Operator training', 2000, 'TRAINING');
    expect(training.policyRecommendation).toBe('EXPENSE');

    // Capitalizing a non-capitalizable component is refused by policy.
    await auth1(http().post(fa(`/acquisition-candidates/${training.id}/classify`))).send({ decision: 'CAPITALIZE' }).expect(422);
    const exp = await auth1(http().post(fa(`/acquisition-candidates/${training.id}/classify`))).send({ decision: 'EXPENSE', reason: 'Training is a period cost' }).expect(201);
    expect(exp.body.status).toBe('EXPENSE');
    expect(exp.body.expenseJournalEntryId).toBeTruthy();

    const project = await auth1(http().post(fa('/cip'))).send({ code: `CIP-${run}`, name: 'Production Machine Installation', startDate: '2026-01-05', departmentId: deptA }).expect(201);
    for (const c of [equipment, transport, installation]) {
      await auth1(http().post(fa(`/acquisition-candidates/${c.id}/classify`))).send({ decision: 'ASSIGN_TO_CIP', cipProjectId: project.body.id }).expect(201);
    }
    // Same candidate cannot be consumed twice.
    await auth1(http().post(fa(`/acquisition-candidates/${equipment.id}/classify`))).send({ decision: 'EXPENSE' }).expect(409);

    const cip = await auth1(http().get(fa(`/cip/${project.body.id}`))).expect(200);
    expect(Number(cip.body.balance)).toBe(115000);
    expect(Number(cip.body.components.FREIGHT.balance)).toBe(5000);

    await auth1(http().post(fa(`/cip/${project.body.id}/status`))).send({ status: 'READY_FOR_CAPITALIZATION' }).expect(201);
    const over = await auth1(http().post(fa(`/cip/${project.body.id}/capitalize`))).send({ date: '2026-02-20', assets: [{ name: 'Machine', categoryId, amount: 120000 }] }).expect(422);
    expect(over.body.message).toContain('exceeds remaining CIP balance');

    const partial = await auth1(http().post(fa(`/cip/${project.body.id}/capitalize`))).send({ date: '2026-02-20', assets: [{ name: 'Machine FA-0001', categoryId, amount: 110000 }] }).expect(201);
    expect(partial.body.remainingCip).toBe('5000');
    // Unexplained residual blocks closure.
    await auth1(http().post(fa(`/cip/${project.body.id}/close`))).expect(422);
    // Withdraw and capitalize the full balance instead.
    await auth1(http().post(fa(`/${partial.body.assets[0].id}/withdraw-capitalization`))).send({ reason: 'wrong amount' }).expect(201);
    const full = await auth1(http().post(fa(`/cip/${project.body.id}/capitalize`))).send({ date: '2026-02-20', assets: [{ name: 'Production Machine', categoryId }], closeProject: true }).expect(201);
    expect(full.body.capitalized).toBe('115000');
    machineId = full.body.assets[0].id;
    const closed = await auth1(http().get(fa(`/cip/${project.body.id}`))).expect(200);
    expect(closed.body.status).toBe('CAPITALIZED');
  });

  it('acceptance recognizes cost; not commissioned -> no depreciation; start rule respected (146, 150, 19)', async () => {
    const acc = await auth1(http().post(fa(`/${machineId}/accept`))).send({ date: '2026-02-20', departmentId: deptA, locationId: locA }).expect(201);
    expect(acc.body.documentType).toBe('FA_ACCEPTANCE');
    let c = await card(machineId);
    expect(c.status).toBe('ACCEPTED');
    expect(Number(c.balances.cost)).toBe(115000);
    expect(c.costComponents.length).toBe(3);
    expect(c.inventoryNumber).toBeTruthy();

    const febPreview = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-02' })).expect(200);
    expect(febPreview.body.lines.find((l: any) => l.assetId === machineId)).toBeUndefined();

    await auth1(http().post(fa(`/${machineId}/commission`))).send({ date: '2026-03-01', departmentId: deptA, locationId: locA, usefulLifeMonths: 60 }).expect(201);
    c = await card(machineId);
    expect(c.status).toBe('ACTIVE');
    expect(c.depreciationStartDate.slice(0, 10)).toBe('2026-04-01');
    const marPreview = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-03' })).expect(200);
    expect(marPreview.body.lines.find((l: any) => l.assetId === machineId)).toBeUndefined();
  });

  it('straight line 115,000 / 60 = 1,916.67 posted with balanced JE; retry is idempotent (148, 162, 170)', async () => {
    const calc = await auth1(http().post(fa('/depreciation/calculate'))).send({ period: '2026-04' }).expect(201);
    const line = calc.body.lines.find((l: any) => l.assetId === machineId);
    expect(line.depreciationAmount).toBe('1916.67');
    const posted = await auth1(http().post(fa('/depreciation/post'))).send({ runId: calc.body.id }).expect(201);
    expect(posted.body.status).toBe('POSTED');
    const again = await auth1(http().post(fa('/depreciation/post'))).send({ runId: calc.body.id }).expect(201);
    expect(again.body.status).toBe('POSTED');
    const movements = await prisma.fixedAssetMovement.count({ where: { assetId: machineId, movementType: 'DEPRECIATION', period: '2026-04' } });
    expect(movements).toBe(1);

    const recalc = await auth1(http().post(fa('/depreciation/calculate'))).send({ period: '2026-04' }).expect(201);
    expect(recalc.body.lines.find((l: any) => l.assetId === machineId).status).toBe('SKIPPED');
    expect(recalc.body.runVersion).toBe(2);

    const je = await prisma.journalEntry.findFirstOrThrow({ where: { id: posted.body.postingBatchId }, include: { lines: true } });
    const debit = je.lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amountBase), 0);
    const credit = je.lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amountBase), 0);
    expect(debit).toBeCloseTo(credit, 4);
    expect(Number((await card(machineId)).balances.accumulatedDepreciation)).toBeCloseTo(1916.67, 2);
  });

  it('commissioning reversal is blocked once depreciation is posted (133)', async () => {
    const docs = await auth1(http().get(fa('/documents')).query({ assetId: machineId, documentType: 'FA_COMMISSIONING' })).expect(200);
    const res = await auth1(http().post(fa(`/documents/${docs.body[0].id}/reverse`))).send({ reason: 'test' }).expect(409);
    expect(res.body.message).toContain('depreciation has already been posted for April 2026');
  });

  it('transfer A -> B keeps cost and NBV, history retained, expense follows new department (154)', async () => {
    const before = await card(machineId);
    await auth1(http().post(fa(`/${machineId}/transfer`))).send({ date: '2026-05-01', toDepartmentId: deptB, reason: 'Line move' }).expect(201);
    const after = await card(machineId);
    expect(after.departmentId).toBe(deptB);
    expect(after.balances.cost).toBe(before.balances.cost);
    expect(after.balances.netBookValue).toBe(before.balances.netBookValue);
    expect(after.assignments.filter((a: any) => !a.reversed).map((a: any) => a.departmentId)).toEqual([deptA, deptA, deptB]);
    const may = await depreciate('2026-05');
    const line = may.lines.find((l: any) => l.assetId === machineId);
    expect(line.departmentId).toBe(deptB);
  });

  it('straight line with residual: 120,000 - 20,000 over 50 months = 2,000 (149)', async () => {
    const id = await openingAsset('Press', { originalCost: 120000, usefulLifeMonths: 50, remainingUsefulLifeMonths: 50, residualValue: 20000 });
    const preview = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-06' })).expect(200);
    expect(preview.body.lines.find((l: any) => l.assetId === id).periodDepreciation).toBe('2000');
  });

  it('modernization raises gross carrying amount to 130,000 prospectively (151)', async () => {
    const id = await openingAsset('Lathe', { originalCost: 100000, accumulatedDepreciation: 20000, usefulLifeMonths: 60, remainingUsefulLifeMonths: 48 });
    const upgrade = await candidate('Lathe upgrade', 30000, 'OTHER_CAPITALIZABLE', '2026-06-10');
    await auth1(http().post(fa(`/acquisition-candidates/${upgrade.id}/classify`))).send({ decision: 'CAPITALIZE' }).expect(201);
    await auth1(http().post(fa(`/${id}/modernize`))).send({ date: '2026-06-15', candidateIds: [upgrade.id], remainingUsefulLifeMonths: 60 }).expect(201);
    const c = await card(id);
    expect(Number(c.balances.grossCarrying)).toBe(130000);
    expect(Number(c.balances.accumulatedDepreciation)).toBe(20000);
    const preview = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-06' })).expect(200);
    expect(preview.body.lines.find((l: any) => l.assetId === id).periodDepreciation).toBe('1833.33'); // 110,000 / 60
  });

  it('repair marked non-capitalizable leaves cost unchanged and is expensed (152)', async () => {
    const id = await openingAsset('Compressor', { originalCost: 50000, usefulLifeMonths: 60, remainingUsefulLifeMonths: 60 });
    const rep = await candidate('Compressor repair', 5000, 'REPAIR', '2026-06-05');
    const doc = await auth1(http().post(fa(`/${id}/repairs`))).send({ date: '2026-06-05', description: 'Valve replacement', decision: 'EXPENSE_REPAIR', candidateId: rep.id }).expect(201);
    expect(doc.body.payload.expenseJournalEntryId).toBeTruthy();
    expect(Number((await card(id)).balances.cost)).toBe(50000);
  });

  it('impairment 80,000 -> 60,000 and future depreciation adjusts (153)', async () => {
    const id = await openingAsset('Kiln', { originalCost: 100000, accumulatedDepreciation: 20000, usefulLifeMonths: 60, remainingUsefulLifeMonths: 40 });
    const imp = await auth1(http().post(fa(`/${id}/impair`))).send({ date: '2026-01-31', recoverableAmount: 60000, reason: 'Market decline' }).expect(201);
    expect(imp.body.lines[0].amount).toBe('20000');
    const c = await card(id);
    expect(Number(c.balances.netBookValue)).toBe(60000);
    const preview = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-02' })).expect(200);
    expect(preview.body.lines.find((l: any) => l.assetId === id).periodDepreciation).toBe('1500'); // 60,000 / 40
  });

  it('sale: NBV 30,000, proceeds 40,000 -> gain 10,000; write-off: NBV 10,000 -> loss 10,000 (157, 158)', async () => {
    const saleId = await openingAsset('Truck', { originalCost: 100000, accumulatedDepreciation: 70000, usefulLifeMonths: 60, remainingUsefulLifeMonths: 18 });
    const sale = await auth1(http().post(fa(`/${saleId}/dispose`))).send({ date: '2026-01-20', disposalType: 'SALE', proceeds: 40000, reason: 'Sold' }).expect(201);
    expect(sale.body.calculation.gainLoss).toBe('10000');
    const sold = await card(saleId);
    expect(sold.status).toBe('DISPOSED');
    expect(Number(sold.balances.cost)).toBe(0);
    expect(Number(sold.balances.accumulatedDepreciation)).toBe(0);
    const prev = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-02' })).expect(200);
    expect(prev.body.lines.find((l: any) => l.assetId === saleId)).toBeUndefined();

    const woId = await openingAsset('Old pump', { originalCost: 100000, accumulatedDepreciation: 90000, usefulLifeMonths: 60, remainingUsefulLifeMonths: 6 });
    const wo = await auth1(http().post(fa(`/${woId}/dispose`))).send({ date: '2026-01-20', disposalType: 'WRITE_OFF', reason: 'Broken' }).expect(201);
    expect(wo.body.calculation.gainLoss).toBe('-10000');
    expect((await card(woId)).status).toBe('WRITTEN_OFF');
  });

  it('fully depreciated asset is not depreciated further and stays ACTIVE (159)', async () => {
    const id = await openingAsset('Old desk', { originalCost: 60000, accumulatedDepreciation: 60000, usefulLifeMonths: 60, remainingUsefulLifeMonths: 0 });
    const preview = await auth1(http().get(fa('/depreciation/preview')).query({ period: '2026-02' })).expect(200);
    const line = preview.body.lines.find((l: any) => l.assetId === id);
    expect(line.status).toBe('SKIPPED');
    expect(line.skipReason).toBe('FULLY_DEPRECIATED');
    expect((await card(id)).status).toBe('ACTIVE');
  });

  it('physical inventory: wrong location -> transfer correction, missing -> investigation, no write-off (160, 161)', async () => {
    const a = await openingAsset('Scanner-tagged drill', { originalCost: 3000, usefulLifeMonths: 36, remainingUsefulLifeMonths: 30, inventoryNumber: `INV-DRILL-${run}` });
    const b = await openingAsset('Missing grinder', { originalCost: 2000, usefulLifeMonths: 36, remainingUsefulLifeMonths: 30, inventoryNumber: `INV-GRIND-${run}` });
    const count = await auth1(http().post(fa('/inventory-counts'))).send({ countDate: '2026-02-10', locationId: locA }).expect(201);
    await auth1(http().post(fa(`/inventory-counts/${count.body.id}/scan`))).send({ code: `INV-DRILL-${run}`, foundLocationId: locB }).expect(201);
    await auth1(http().post(fa(`/inventory-counts/${count.body.id}/scan`))).send({ code: `UNKNOWN-${run}`, foundLocationId: locA, description: 'Unlabelled welder' }).expect(201);
    const done = await auth1(http().post(fa(`/inventory-counts/${count.body.id}/complete`))).expect(201);
    const drill = done.body.results.find((r: any) => r.assetId === a);
    const grinder = done.body.results.find((r: any) => r.assetId === b);
    expect(drill.result).toBe('WRONG_LOCATION');
    expect(grinder.result).toBe('MISSING');
    expect(grinder.resolutionStatus).toBe('UNDER_INVESTIGATION');
    expect(done.body.results.some((r: any) => r.result === 'UNREGISTERED_ASSET')).toBe(true);
    expect((await card(b)).status).toBe('ACTIVE'); // never auto-disposed

    await auth1(http().post(fa(`/inventory-counts/results/${drill.id}/resolve`))).send({ resolution: 'TRANSFER_CORRECTION' }).expect(201);
    const moved = await card(a);
    expect(moved.locationId).toBe(locB);
    expect(Number(moved.balances.cost)).toBe(3000);
    const unreg = done.body.results.find((r: any) => r.result === 'UNREGISTERED_ASSET');
    await auth1(http().post(fa(`/inventory-counts/results/${unreg.id}/resolve`))).send({ resolution: 'RECOGNITION_REVIEW', estimatedValue: 700 }).expect(201);
    expect(await prisma.fixedAsset.count({ where: { tenantId: tenant1Id, name: { contains: 'welder' } } })).toBe(0);
  });

  it('two concurrent capitalizations of one candidate: only one succeeds (163)', async () => {
    const c = await candidate('Server rack', 100000);
    await auth1(http().post(fa(`/acquisition-candidates/${c.id}/classify`))).send({ decision: 'CAPITALIZE' }).expect(201);
    const body = (n: string) => ({ candidateIds: [c.id], asset: { name: n, categoryId } });
    const [r1, r2] = await Promise.all([
      auth1(http().post(fa('/acquisition-candidates/create-assets'))).send(body('Rack A')),
      auth1(http().post(fa('/acquisition-candidates/create-assets'))).send(body('Rack B')),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await prisma.fixedAssetCostComponent.count({ where: { candidateId: c.id, released: false } })).toBe(1);
  });

  it('one invoice -> 10 separate cards of 2,000 (13)', async () => {
    const c = await candidate('10 laptops', 20000);
    await auth1(http().post(fa(`/acquisition-candidates/${c.id}/classify`))).send({ decision: 'CAPITALIZE' }).expect(201);
    const res = await auth1(http().post(fa('/acquisition-candidates/create-assets'))).send({ candidateIds: [c.id], count: 10, asset: { name: 'Laptop', categoryId } }).expect(201);
    expect(res.body.assets).toHaveLength(10);
    const comps = await prisma.fixedAssetCostComponent.findMany({ where: { candidateId: c.id } });
    expect(comps.every((x) => Number(x.amount) === 2000)).toBe(true);
  });

  it('GL reconciliation: healthy, then a 5,000 manual 112 posting shows a 5,000 difference (164)', async () => {
    const ok = await auth1(http().get(fa('/reports/reconciliation')).query({ asOf: '2026-12-31' })).expect(200);
    expect(ok.body.healthy).toBe(true);
    const acc112 = await prisma.account.findFirstOrThrow({ where: { tenantId: tenant1Id, code: '112' } });
    const acc731 = await prisma.account.findFirstOrThrow({ where: { tenantId: tenant1Id, code: '731' } });
    const user = await prisma.user.findFirstOrThrow({ where: { email: `fa1-${run}@e2e.test` } });
    await app.get(AccountingPostingEngine).postBatch(tenant1Id, user.id, {
      organizationId: org1Id,
      businessDate: new Date('2026-07-01T00:00:00Z'),
      description: 'Manual 112 adjustment outside the subledger',
      lines: [
        { accountId: acc112.id, side: 'DEBIT', amountBase: 5000 },
        { accountId: acc731.id, side: 'CREDIT', amountBase: 5000 },
      ],
    });
    const bad = await auth1(http().get(fa('/reports/reconciliation')).query({ asOf: '2026-12-31' })).expect(200);
    const line = bad.body.lines.find((l: any) => l.accountCode === '112');
    expect(Number(line.difference)).toBe(-5000);
    expect(bad.body.healthy).toBe(false);
  });

  it('tenant isolation: another tenant cannot see the asset', async () => {
    await auth2(http().get(`/organizations/${org2Id}/fixed-assets/${machineId}`)).expect(404);
    await auth2(http().get(`/organizations/${org1Id}/fixed-assets/${machineId}`)).expect(404);
  });
});
