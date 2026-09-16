/**
 * Period Reopen Request E2E tests (docs/PERIODS.md).
 *
 * Covers: a maker-checker gate in front of PeriodService.reopen — a
 * periods.reopen_request.create holder files a reasoned request against a
 * CLOSED period, only a periods.reopen holder can approve/reject it,
 * approving actually reopens the period, the requester cannot decide their
 * own request, a second pending request against the same period is
 * rejected, and rejecting leaves the period closed.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Period Reopen Request (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let requesterToken: string;
  let approverToken: string;
  let tenant1Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`preq1-${run}@e2e.test`, `preq-t1-${run}`);
    token1 = s1.token; tenant1Id = s1.tenantId;

    requesterToken = await setupUser('periods.reopen_request.create');
    approverToken = await setupUser('periods.reopen');
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(email: string, tenantCode: string) {
    const regRes = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Test User' }).expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'AZN' })
      .expect(201);
    return { token, tenantId: tenantRes.body.id };
  }

  /** A second tenant1 user holding exactly one relevant permission — never
   * TENANT_ADMIN, so the request/approve permission split is real. */
  async function setupUser(permissionCode: string): Promise<string> {
    const email = `preq-${permissionCode.replace(/\W+/g, '-')}-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Scoped User' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    const permission = await prisma.permission.findFirst({ where: { code: permissionCode } });
    if (!permission) throw new Error(`Permission ${permissionCode} not seeded — run prisma:seed`);
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: `ROLE-${permissionCode}-${run}`, name: permissionCode } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    return reg.body.accessToken;
  }

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function requesterAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${requesterToken}`).set('X-Tenant-Id', tenant1Id);
  }
  function approverAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
  }

  async function closedPeriod(year: number, month: number) {
    const created = await auth1(request(app.getHttpServer()).post('/periods')).send({ year, month }).expect(201);
    await auth1(request(app.getHttpServer()).post(`/periods/${created.body.id}/close`)).expect(201);
    return created.body.id;
  }

  it('a scoped requester can file a reopen request; only a periods.reopen holder can approve it, and approving actually reopens the period', async () => {
    const periodId = await closedPeriod(2026, 1);

    // The requester alone cannot reopen directly (lacks periods.reopen).
    await requesterAuth(request(app.getHttpServer()).post(`/periods/${periodId}/reopen`)).send({ reason: 'direct attempt' }).expect(403);

    const req = await requesterAuth(request(app.getHttpServer()).post('/period-reopen-requests'))
      .send({ periodId, reason: 'Need to post a late-arriving supplier invoice' })
      .expect(201);
    expect(req.body.status).toBe('PENDING');

    // The requester cannot approve their own request.
    const selfDecide = await requesterAuth(request(app.getHttpServer()).post(`/period-reopen-requests/${req.body.id}/approve`)).send({});
    expect(selfDecide.status).toBe(403); // lacks periods.reopen entirely

    await approverAuth(request(app.getHttpServer()).post(`/period-reopen-requests/${req.body.id}/approve`)).send({ comment: 'approved for late invoice' }).expect(201);

    const decided = await auth1(request(app.getHttpServer()).get(`/period-reopen-requests?periodId=${periodId}`)).expect(200);
    expect(decided.body[0].status).toBe('APPROVED');

    const periods = await auth1(request(app.getHttpServer()).get('/periods')).expect(200);
    const period = periods.body.find((p: any) => p.id === periodId);
    expect(period.status).toBe('OPEN');
  });

  it('rejects a second pending request against the same period', async () => {
    const periodId = await closedPeriod(2026, 2);
    await requesterAuth(request(app.getHttpServer()).post('/period-reopen-requests')).send({ periodId, reason: 'first request' }).expect(201);

    const second = await requesterAuth(request(app.getHttpServer()).post('/period-reopen-requests')).send({ periodId, reason: 'second request' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('CONFLICT');
  });

  it('rejecting a request leaves the period closed', async () => {
    const periodId = await closedPeriod(2026, 3);
    const req = await requesterAuth(request(app.getHttpServer()).post('/period-reopen-requests')).send({ periodId, reason: 'want to fix a typo' }).expect(201);

    await approverAuth(request(app.getHttpServer()).post(`/period-reopen-requests/${req.body.id}/reject`)).send({ comment: 'not a valid reason' }).expect(201);

    const periods = await auth1(request(app.getHttpServer()).get('/periods')).expect(200);
    const period = periods.body.find((p: any) => p.id === periodId);
    expect(period.status).toBe('CLOSED');

    // A fresh request can be filed after a rejection (no lingering PENDING row).
    await requesterAuth(request(app.getHttpServer()).post('/period-reopen-requests')).send({ periodId, reason: 'trying again with a better reason' }).expect(201);
  });
});
