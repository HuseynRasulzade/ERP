/**
 * Sales Order approval workflow E2E tests (docs/APPROVALS.md).
 *
 * Covers: a single SALES_MANAGER approval step added when either the
 * order's grand total exceeds SALES_ORDER_MANAGER_APPROVAL_THRESHOLD or
 * the counterparty's credit check lands in the grace band
 * (APPROVAL_REQUIRED, replacing the old no-op WARNING); confirmation
 * (post) blocked until approved; self-approval blocked; a small order
 * within both the threshold and the credit limit needs no approval at
 * all (NOT_REQUIRED); and a credit result beyond the grace band is still
 * a hard BLOCK that no approval can override.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Sales Order approval workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let managerToken: string;
  let tenant1Id: string;
  let org1Id: string;
  let productId: string;
  let unitId: string;

  const DOC_DATE = '2026-09-16';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`soappr1-${run}@e2e.test`, `soap-t1-${run}`, 'SOA1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    managerToken = await setupSalesManager(tenant1Id, org1Id);

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS-SOA', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'SOA-PROD-001', name: 'Approval Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;
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

  function managerAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-Id', tenant1Id);
  }

  /** A second tenant1 user holding SALES_MANAGER — distinct from token1,
   * the creator of every fixture order below (self-approval is blocked). */
  async function setupSalesManager(tenantId: string, organizationId: string): Promise<string> {
    const email = `soap-manager-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Sales Manager' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId, accessLevel: 'FULL' } });

    const permissions = await prisma.permission.findMany({
      where: {
        code: {
          in: ['sales_order.view', 'sales.order.approve', 'sales.order.reject', 'documents.view', 'documents.post', 'documents.unpost', 'documents.cancel'],
        },
      },
    });
    const role = await prisma.role.create({ data: { tenantId, code: 'SALES_MANAGER', name: 'Sales Manager' } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    return reg.body.accessToken;
  }

  async function createOrder(customerId: string, quantity: number, price: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
      .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity, price }] })
      .expect(201);
    return res.body;
  }

  async function customer(creditLimit?: number) {
    const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: `SOA-CUST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: 'Approval Buyer', ...(creditLimit !== undefined ? { creditLimit } : {}) })
      .expect(201);
    return res.body.id;
  }

  describe('Threshold-driven approval', () => {
    it('a small order needs no approval and posts directly (NOT_REQUIRED)', async () => {
      const custId = await customer();
      const order = await createOrder(custId, 1, 100); // 100 AZN, well under the 15,000 threshold
      expect(order.approvalStatus).toBe('NOT_REQUIRED');

      const posted = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');
    });

    it('an order above the AZN threshold requires SALES_MANAGER approval before it can post', async () => {
      const custId = await customer();
      const order = await createOrder(custId, 10, 2000); // 20,000 AZN > 15,000 threshold
      expect(order.approvalStatus).toBe('PENDING');

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version })
        .expect(400);
      expect(blocked.body.message).toMatch(/sales manager approval/i);

      // The creator (token1, tenant admin) cannot approve their own order.
      const selfApprove = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/approve`)).send({});
      expect(selfApprove.status).toBe(400);
      expect(selfApprove.body.message).toMatch(/yourself/i);

      await managerAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/approve`)).send({}).expect(201);

      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`)).expect(200);
      expect(approved.body.approvalStatus).toBe('APPROVED');

      const posted = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');
    });

    it('rejecting the step leaves the order unable to post', async () => {
      const custId = await customer();
      const order = await createOrder(custId, 10, 2000);

      await managerAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/reject`)).send({ comment: 'over budget this quarter' }).expect(201);

      const rejected = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`)).expect(200);
      expect(rejected.body.approvalStatus).toBe('REJECTED');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: rejected.body.version })
        .expect(400);
    });
  });

  describe('Credit-limit-driven approval (grace band vs hard block)', () => {
    it('an order within the 10% grace band above the credit limit requires approval, not a hard block', async () => {
      const custId = await customer(1000); // limit 1000
      const order = await createOrder(custId, 1, 1050); // 1050 <= 1100 (10% grace) -> APPROVAL_REQUIRED
      expect(order.approvalStatus).toBe('PENDING');

      // Not a hard block — just gated on approval.
      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version })
        .expect(400);
      expect(blocked.body.message).toMatch(/sales manager approval/i);

      await managerAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/approve`)).send({}).expect(201);
      const approved = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`)).expect(200);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: approved.body.version })
        .expect(201);
      const posted = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/sales-orders/${order.id}`)).expect(200);
      expect(posted.body.postingStatus).toBe('POSTED');
      expect(posted.body.creditStatus).toBe('APPROVAL_REQUIRED');
    });

    it('an order beyond the grace band is a hard BLOCK that approval cannot override', async () => {
      const custId = await customer(1000); // limit 1000
      const order = await createOrder(custId, 1, 5000); // 5000 >> 1100 grace ceiling -> BLOCKED, no approval step at all
      expect(order.approvalStatus).toBe('NOT_REQUIRED');

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${order.id}/confirm`))
        .send({ expectedVersion: order.version })
        .expect(409);
      expect(blocked.body.code).toBe('CREDIT_CHECK_BLOCKED');
    });
  });

  describe('Editing re-plans the approval chain', () => {
    it('growing a small order past the threshold introduces the approval step; shrinking it back below removes it', async () => {
      const custId = await customer();
      const order = await createOrder(custId, 1, 100);
      expect(order.approvalStatus).toBe('NOT_REQUIRED');

      const grown = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-orders/${order.id}`))
        .send({ expectedVersion: order.version, lines: [{ productId, unitId, quantity: 10, price: 2000 }] })
        .expect(200);
      expect(grown.body.approvalStatus).toBe('PENDING');

      const shrunk = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/sales-orders/${order.id}`))
        .send({ expectedVersion: grown.body.version, lines: [{ productId, unitId, quantity: 1, price: 100 }] })
        .expect(200);
      expect(shrunk.body.approvalStatus).toBe('NOT_REQUIRED');
    });
  });
});
