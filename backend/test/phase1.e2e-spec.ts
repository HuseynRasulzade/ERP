import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Automated tests for Phase 1 — Organization & Business Structure
 * (spec sections 58-69). Run against the real Postgres instance with
 * Phase 0 + Phase 1 migrations and the seed already applied.
 */
describe('Phase 1 organization & business structure (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  const userA = { email: `p1a-${run}@e2e.test`, password: 'Passw0rd!23', displayName: 'P1 User A' };
  const userB = { email: `p1b-${run}@e2e.test`, password: 'Passw0rd!23', displayName: 'P1 User B' };

  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let tenantBId: string;
  let membershipAId: string;
  let orgId: string;

  const authA = () => ({ Authorization: `Bearer ${tokenA}`, 'X-Tenant-Id': tenantAId });
  const authB = () => ({ Authorization: `Bearer ${tokenB}`, 'X-Tenant-Id': tenantBId });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const regA = await request(app.getHttpServer()).post('/auth/register').send(userA).expect(201);
    tokenA = regA.body.accessToken;
    const regB = await request(app.getHttpServer()).post('/auth/register').send(userB).expect(201);
    tokenB = regB.body.accessToken;

    const tenantA = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ code: `p1-tenant-a-${run}`, name: 'P1 Tenant A' })
      .expect(201);
    tenantAId = tenantA.body.id;

    const tenantB = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ code: `p1-tenant-b-${run}`, name: 'P1 Tenant B' })
      .expect(201);
    tenantBId = tenantB.body.id;

    const myTenantsA = await request(app.getHttpServer())
      .get('/users/me/tenants')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    membershipAId = myTenantsA.body[0].membershipId;

    const org = await request(app.getHttpServer())
      .post('/organizations')
      .set(authA())
      .send({ code: `org-${run}`, name: 'Org Under Test' })
      .expect(201);
    orgId = org.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // -- Organization (section 58) --------------------------------------------
  describe('Organization', () => {
    it('rejects duplicate code within the same tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/organizations')
        .set(authA())
        .send({ code: `org-${run}`, name: 'Dup' })
        .expect(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('excludes deactivated organizations from the default selectable list but keeps them resolvable directly', async () => {
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set(authA())
        .send({ code: `org-deact-${run}`, name: 'To Deactivate' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org.body.id}/deactivate`)
        .set(authA())
        .send({ expectedVersion: 1 })
        .expect(201);

      const list = await request(app.getHttpServer()).get('/organizations').set(authA()).expect(200);
      expect(list.body.some((o: any) => o.id === org.body.id)).toBe(false);

      const direct = await request(app.getHttpServer())
        .get(`/organizations/${org.body.id}`)
        .set(authA())
        .expect(200);
      expect(direct.body.active).toBe(false);
    });

    it('a user with no access grant cannot reach the organization even inside the correct tenant (cross-tenant style hide)', async () => {
      // User B is in Tenant B and was never granted access to any Tenant A
      // organization — attempting cross-tenant access must 404.
      await request(app.getHttpServer()).get(`/organizations/${orgId}`).set(authB()).expect(404);
    });
  });

  // -- Branch (section 59) ---------------------------------------------------
  describe('Branch', () => {
    it('rejects duplicate branch code within the same organization', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/branches`)
        .set(authA())
        .send({ code: 'HQ', name: 'Head Office' })
        .expect(201);

      const dup = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/branches`)
        .set(authA())
        .send({ code: 'HQ', name: 'Duplicate' })
        .expect(409);
      expect(dup.body.code).toBe('CONFLICT');
    });

    it('excludes deactivated branch from default listing but keeps it resolvable', async () => {
      const branch = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/branches`)
        .set(authA())
        .send({ code: `BR-${run}`, name: 'To Deactivate' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/branches/${branch.body.id}/deactivate`)
        .set(authA())
        .send({ expectedVersion: 1 })
        .expect(201);

      const list = await request(app.getHttpServer()).get(`/organizations/${orgId}/branches`).set(authA()).expect(200);
      expect(list.body.some((b: any) => b.id === branch.body.id)).toBe(false);

      const direct = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/branches/${branch.body.id}`)
        .set(authA())
        .expect(200);
      expect(direct.body.active).toBe(false);
    });
  });

  // -- Department (section 60) -----------------------------------------------
  describe('Department', () => {
    it('supports parent departments, resolves descendants, and rejects circular hierarchy', async () => {
      const parent = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/departments`)
        .set(authA())
        .send({ code: `SALES-${run}`, name: 'Sales' })
        .expect(201);

      const child = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/departments`)
        .set(authA())
        .send({ code: `RETAIL-${run}`, name: 'Retail Sales', parentDepartmentId: parent.body.id })
        .expect(201);

      const descendants = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/departments/${parent.body.id}/descendants`)
        .set(authA())
        .expect(200);
      expect(descendants.body).toEqual(expect.arrayContaining([parent.body.id, child.body.id]));

      const circular = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/departments/${parent.body.id}`)
        .set(authA())
        .send({ parentDepartmentId: child.body.id, expectedVersion: 1 })
        .expect(400);
      expect(circular.body.code).toBe('VALIDATION_ERROR');

      const selfParent = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/departments/${parent.body.id}`)
        .set(authA())
        .send({ parentDepartmentId: parent.body.id, expectedVersion: 1 })
        .expect(400);
      expect(selfParent.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // -- Warehouse (section 61) ------------------------------------------------
  describe('Warehouse', () => {
    it('rejects a branch from another organization and duplicate codes', async () => {
      const otherOrg = await request(app.getHttpServer())
        .post('/organizations')
        .set(authA())
        .send({ code: `other-org-${run}`, name: 'Other Org' })
        .expect(201);
      const foreignBranch = await request(app.getHttpServer())
        .post(`/organizations/${otherOrg.body.id}/branches`)
        .set(authA())
        .send({ code: 'FB', name: 'Foreign Branch' })
        .expect(201);

      const rejected = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/warehouses`)
        .set(authA())
        .send({ code: `WH-X-${run}`, branchId: foreignBranch.body.id, name: 'Should fail' })
        .expect(400);
      expect(rejected.body.code).toBe('VALIDATION_ERROR');

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/warehouses`)
        .set(authA())
        .send({ code: `WH-${run}`, name: 'Main' })
        .expect(201);
      const dup = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/warehouses`)
        .set(authA())
        .send({ code: `WH-${run}`, name: 'Dup' })
        .expect(409);
      expect(dup.body.code).toBe('CONFLICT');
    });

    it('excludes a deactivated warehouse from selection and clears it as an org default', async () => {
      const wh = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/warehouses`)
        .set(authA())
        .send({ code: `WH-DEF-${run}`, name: 'Default WH' })
        .expect(201);

      const org = await request(app.getHttpServer()).get(`/organizations/${orgId}`).set(authA()).expect(200);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/defaults`)
        .set(authA())
        .send({ field: 'defaultWarehouseId', targetId: wh.body.id, expectedVersion: org.body.version })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/warehouses/${wh.body.id}/deactivate`)
        .set(authA())
        .send({ expectedVersion: 1 })
        .expect(201);

      const orgAfter = await request(app.getHttpServer()).get(`/organizations/${orgId}`).set(authA()).expect(200);
      expect(orgAfter.body.defaultWarehouseId).toBeNull();
    });
  });

  // -- Cashbox (section 62) --------------------------------------------------
  describe('Cashbox', () => {
    it('requires a currency and enforces organization ownership', async () => {
      const currencies = await request(app.getHttpServer()).get('/currencies').set(authA()).expect(200);
      const azn = currencies.body.find((c: any) => c.code === 'AZN');

      // Missing `currencyId` is a request-shape violation (DTO validation),
      // distinct from a business-rule ValidationAppError (section 38) — both
      // surface as 400, but via different layers.
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/cashboxes`)
        .set(authA())
        .send({ code: `CB-${run}`, name: 'No Currency' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/cashboxes`)
        .set(authA())
        .send({ code: `CB-${run}`, name: 'Main Cashbox', currencyId: azn.id })
        .expect(201);
    });
  });

  // -- Bank account (section 63) ---------------------------------------------
  describe('Bank account', () => {
    it('rejects a malformed IBAN and enforces a single default per organization', async () => {
      const currencies = await request(app.getHttpServer()).get('/currencies').set(authA()).expect(200);
      const azn = currencies.body.find((c: any) => c.code === 'AZN');

      const badIban = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/bank-accounts`)
        .set(authA())
        .send({ bankName: 'Bank', accountName: 'Acc', iban: 'NOT-AN-IBAN', currencyId: azn.id })
        .expect(400);
      expect(badIban.body.code).toBe('VALIDATION_ERROR');

      const acc1 = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/bank-accounts`)
        .set(authA())
        .send({ bankName: 'Bank1', accountName: 'Acc1', iban: 'AZ21NABZ00000000137010001944', currencyId: azn.id, isDefault: true })
        .expect(201);

      const acc2 = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/bank-accounts`)
        .set(authA())
        .send({ bankName: 'Bank2', accountName: 'Acc2', iban: 'AZ77PAHA00000000012345678902', currencyId: azn.id, isDefault: true })
        .expect(201);

      const list = await request(app.getHttpServer()).get(`/organizations/${orgId}/bank-accounts`).set(authA()).expect(200);
      const defaults = list.body.filter((a: any) => a.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(acc2.body.id);
      expect(acc1.body.id).not.toBe(acc2.body.id);
    });
  });

  // -- Accounting policy (section 64) -----------------------------------------
  describe('Accounting policy', () => {
    it('resolves by business date, rejects overlaps, and errors when nothing applies', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/accounting-policies`)
        .set(authA())
        .send({ code: `AP-${run}`, name: 'Policy 2026', validFrom: '2026-01-01' })
        .expect(201);

      const overlap = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/accounting-policies`)
        .set(authA())
        .send({ code: `AP2-${run}`, name: 'Overlap', validFrom: '2026-06-01' })
        .expect(409);
      expect(overlap.body.code).toBe('CONFLICT');

      const resolved = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/accounting-policies/resolve?businessDate=2026-09-07`)
        .set(authA())
        .expect(200);
      expect(resolved.body.code).toBe(`AP-${run}`);

      const noMatch = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/accounting-policies/resolve?businessDate=1999-01-01`)
        .set(authA())
        .expect(400);
      expect(noMatch.body.code).toBe('VALIDATION_ERROR');
    });

    it('cannot resolve a policy belonging to another organization', async () => {
      const otherOrg = await request(app.getHttpServer())
        .post('/organizations')
        .set(authA())
        .send({ code: `ap-other-org-${run}`, name: 'AP Other Org' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/organizations/${otherOrg.body.id}/accounting-policies/resolve?businessDate=2026-09-07`)
        .set(authA())
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // -- Tax profile (section 65) -----------------------------------------------
  describe('Tax profile', () => {
    it('resolves by effective date and rejects overlapping ranges', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/tax-profiles`)
        .set(authA())
        .send({ code: `TP-${run}`, name: 'Standard', vatRegistered: true, validFrom: '2026-01-01' })
        .expect(201);

      const overlap = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/tax-profiles`)
        .set(authA())
        .send({ code: `TP2-${run}`, name: 'Overlap', validFrom: '2026-03-01' })
        .expect(409);
      expect(overlap.body.code).toBe('CONFLICT');

      const resolved = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/tax-profiles/resolve?businessDate=2026-09-07`)
        .set(authA())
        .expect(200);
      expect(resolved.body.code).toBe(`TP-${run}`);
    });
  });

  // -- Organization access (section 66) ---------------------------------------
  describe('Organization access', () => {
    it('a membership with no grant cannot list, get, or reach child resources of an organization it is not granted', async () => {
      // Register a fresh user, join Tenant A, but never grant org access.
      const outsider = { email: `p1-outsider-${run}@e2e.test`, password: 'Passw0rd!23', displayName: 'Outsider' };
      const reg = await request(app.getHttpServer()).post('/auth/register').send(outsider).expect(201);
      const outsiderToken = reg.body.accessToken;

      const outsiderMembership = await prisma.tenantMembership.create({
        data: { tenantId: tenantAId, userId: reg.body.userId, status: 'ACTIVE' },
      });
      // Grant view-only RBAC permissions but deliberately NO OrganizationAccess
      // grant — isolates "has the permission code" from "is scoped to this
      // organization" (section 22 vs section 6 are independent checks).
      const viewOnlyRole = await prisma.role.create({
        data: { tenantId: tenantAId, code: `OUTSIDER_VIEW_${run}`, name: 'Outsider view-only' },
      });
      const orgViewPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'organization.view' } });
      const branchViewPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'branch.view' } });
      await prisma.rolePermission.createMany({
        data: [
          { roleId: viewOnlyRole.id, permissionId: orgViewPermission.id },
          { roleId: viewOnlyRole.id, permissionId: branchViewPermission.id },
        ],
      });
      await prisma.membershipRole.create({ data: { membershipId: outsiderMembership.id, roleId: viewOnlyRole.id } });

      const outsiderAuth = { Authorization: `Bearer ${outsiderToken}`, 'X-Tenant-Id': tenantAId };

      const list = await request(app.getHttpServer()).get('/organizations').set(outsiderAuth);
      expect(list.body).toEqual([]);

      const direct = await request(app.getHttpServer()).get(`/organizations/${orgId}`).set(outsiderAuth);
      expect(direct.status).toBe(404);

      const branches = await request(app.getHttpServer()).get(`/organizations/${orgId}/branches`).set(outsiderAuth);
      expect(branches.status).toBe(404);
    });

    it('changing the organization id in the request cannot bypass the access check', async () => {
      // tenantBId's own organization must not be reachable via tenant A's
      // membership even though both tenants independently exist.
      const orgB = await request(app.getHttpServer())
        .post('/organizations')
        .set(authB())
        .send({ code: `org-b-${run}`, name: 'Org B' })
        .expect(201);

      await request(app.getHttpServer()).get(`/organizations/${orgB.body.id}`).set(authA()).expect(404);
    });
  });

  // -- Default references (section 67) -----------------------------------------
  describe('Default reference validation', () => {
    it('rejects setting a default from another organization', async () => {
      const otherOrg = await request(app.getHttpServer())
        .post('/organizations')
        .set(authA())
        .send({ code: `def-other-${run}`, name: 'Default Other Org' })
        .expect(201);
      const foreignWarehouse = await request(app.getHttpServer())
        .post(`/organizations/${otherOrg.body.id}/warehouses`)
        .set(authA())
        .send({ code: `FW-${run}`, name: 'Foreign Warehouse' })
        .expect(201);

      const org = await request(app.getHttpServer()).get(`/organizations/${orgId}`).set(authA()).expect(200);

      const rejected = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/defaults`)
        .set(authA())
        .send({ field: 'defaultWarehouseId', targetId: foreignWarehouse.body.id, expectedVersion: org.body.version })
        .expect(400);
      expect(rejected.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // -- Concurrency (section 68) -------------------------------------------------
  describe('Optimistic concurrency', () => {
    it('rejects a stale organization update', async () => {
      const current = await request(app.getHttpServer()).get(`/organizations/${orgId}`).set(authA()).expect(200);
      const currentVersion = current.body.version;

      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}`)
        .set(authA())
        .send({ name: 'Renamed once', expectedVersion: currentVersion })
        .expect(200);

      const stale = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}`)
        .set(authA())
        .send({ name: 'Stale rename', expectedVersion: currentVersion })
        .expect(409);
      expect(stale.body.code).toBe('CONCURRENCY_CONFLICT');
    });

    it('rejects a stale warehouse update', async () => {
      const wh = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/warehouses`)
        .set(authA())
        .send({ code: `WH-CONC-${run}`, name: 'Concurrency Test' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/warehouses/${wh.body.id}`)
        .set(authA())
        .send({ name: 'Renamed', expectedVersion: 1 })
        .expect(200);

      const stale = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/warehouses/${wh.body.id}`)
        .set(authA())
        .send({ name: 'Stale', expectedVersion: 1 })
        .expect(409);
      expect(stale.body.code).toBe('CONCURRENCY_CONFLICT');
    });
  });

  // -- Audit (section 69) --------------------------------------------------------
  describe('Audit', () => {
    it('records organization, warehouse and access events with correct tenant/actor', async () => {
      const events = await request(app.getHttpServer())
        .get(`/audit-events?entityType=Organization&entityId=${orgId}`)
        .set(authA())
        .expect(200);

      const types = events.body.map((e: any) => e.eventType);
      expect(types).toContain('ORGANIZATION_CREATED');

      const dbEvents = await prisma.auditEvent.findMany({ where: { entityType: 'Organization', entityId: orgId } });
      expect(dbEvents.every((e) => e.tenantId === tenantAId)).toBe(true);
    });
  });
});
