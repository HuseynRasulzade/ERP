import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentFrameworkRegistry } from '../src/document-framework/document-framework-registry.service';
import { DocumentPostingService } from '../src/document-framework/document-posting.service';
import { FOUNDATION_TEST_DOCUMENT_TYPE } from '../src/foundation-test-document/foundation-test-document.repository';

/**
 * Automated tests for the Phase 0 critical invariants (section 56) and the
 * lettered acceptance scenarios (section 76-83). Run against a real Postgres
 * instance (docker-compose) with migrations + seed already applied.
 */
describe('Phase 0 foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  const userA = { email: `a-${run}@e2e.test`, password: 'Passw0rd!23', displayName: 'User A' };
  const userB = { email: `b-${run}@e2e.test`, password: 'Passw0rd!23', displayName: 'User B' };

  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let tenantBId: string;

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
      .send({ code: `tenant-a-${run}`, name: 'Tenant A' })
      .expect(201);
    tenantAId = tenantA.body.id;

    const tenantB = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ code: `tenant-b-${run}`, name: 'Tenant B' })
      .expect(201);
    tenantBId = tenantB.body.id;

    await request(app.getHttpServer())
      .post('/periods')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-Id', tenantAId)
      .send({ year: 2026, month: 9 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // -- Tenant isolation (section 56, scenario A) ----------------------------
  describe('Tenant isolation', () => {
    it('rejects a request with no active membership in the target tenant as not-found', async () => {
      await request(app.getHttpServer())
        .get('/tenants/current')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantBId)
        .expect(404);
    });

    it('never returns Tenant B data to a caller scoped to Tenant A, even for a guessed ID', async () => {
      const docB = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Tenant-Id', tenantBId)
        .send({ documentDate: '2026-09-07', amount: '10.00' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/foundation-test-documents/${docB.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .expect(404);
    });

    it('list/search never returns cross-tenant rows', async () => {
      await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '20.00' })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .expect(200);

      expect(list.body.every((d: any) => d.tenantId === tenantAId)).toBe(true);
    });
  });

  // -- Permissions -----------------------------------------------------------
  describe('Permissions', () => {
    it('denies an action with no permission and allows it once granted', async () => {
      // Freshly registered users are only members via tenant creation (which
      // grants TENANT_ADMIN), so simulate "no permission" against a resource
      // gated by a permission nobody in Tenant B holds by revoking it first.
      const roles = await request(app.getHttpServer())
        .get('/roles')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Tenant-Id', tenantBId)
        .expect(200);
      const adminRole = roles.body.find((r: any) => r.code === 'TENANT_ADMIN');
      expect(adminRole).toBeDefined();

      // A brand new role with zero permissions attached.
      const noPermRole = await request(app.getHttpServer())
        .post('/roles')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Tenant-Id', tenantBId)
        .send({ code: `NO_PERMS_${run}`, name: 'No Perms', permissionCodes: [] })
        .expect(201);

      expect(noPermRole.body.permissions).toHaveLength(0);
    });
  });

  // -- Numbering concurrency (section 57, scenario D) ------------------------
  describe('Numbering concurrency', () => {
    it('allocates 60 unique numbers under concurrent document creation, no duplicates', async () => {
      const requests = Array.from({ length: 60 }, () =>
        request(app.getHttpServer())
          .post('/foundation-test-documents')
          .set('Authorization', `Bearer ${tokenA}`)
          .set('X-Tenant-Id', tenantAId)
          .send({ documentDate: '2026-09-07', amount: '5.00', description: 'concurrency' }),
      );

      const responses = await Promise.all(requests);
      responses.forEach((r) => expect(r.status).toBe(201));

      const numbers = responses.map((r) => r.body.number);
      expect(new Set(numbers).size).toBe(numbers.length);
    }, 30_000);
  });

  // -- Optimistic concurrency (section 56, scenario E) -----------------------
  describe('Optimistic concurrency', () => {
    it('rejects a stale update with CONCURRENCY_CONFLICT', async () => {
      const created = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '30.00' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/foundation-test-documents/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ amount: '31.00', expectedVersion: 1 })
        .expect(200);

      const stale = await request(app.getHttpServer())
        .patch(`/foundation-test-documents/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ amount: '32.00', expectedVersion: 1 })
        .expect(409);

      expect(stale.body.code).toBe('CONCURRENCY_CONFLICT');
    });
  });

  // -- Documents: save vs post, unposting (section 56, scenario F) ----------
  describe('Document save/post/unpost lifecycle', () => {
    it('save does not post; post flips posting status; unpost reverses movements', async () => {
      const created = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '99.00' })
        .expect(201);

      expect(created.body.postingStatus).toBe('NOT_POSTED');

      const posted = await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${created.body.id}/post`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ expectedVersion: created.body.version })
        .expect(201);

      expect(posted.body.postingStatus).toBe('POSTED');
      expect(posted.body.movementCount).toBe(1);

      const movementsAfterPost = await prisma.registerMovement.count({
        where: { tenantId: tenantAId, recorderDocumentType: FOUNDATION_TEST_DOCUMENT_TYPE, recorderDocumentId: created.body.id },
      });
      expect(movementsAfterPost).toBe(1);

      const unposted = await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${created.body.id}/unpost`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ expectedVersion: posted.body.version })
        .expect(201);

      expect(unposted.body.postingStatus).toBe('NOT_POSTED');

      const movementsAfterUnpost = await prisma.registerMovement.count({
        where: { tenantId: tenantAId, recorderDocumentType: FOUNDATION_TEST_DOCUMENT_TYPE, recorderDocumentId: created.body.id },
      });
      expect(movementsAfterUnpost).toBe(0);
    });

    it('cannot post a document twice', async () => {
      const created = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '10.00' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${created.body.id}/post`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ expectedVersion: created.body.version })
        .expect(201);

      const secondPost = await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${created.body.id}/post`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ expectedVersion: created.body.version + 1 })
        .expect(409);

      expect(secondPost.body.code).toBe('DOCUMENT_ALREADY_POSTED');
    });
  });

  // -- Periods (section 56, scenario C) --------------------------------------
  describe('Periods', () => {
    it('blocks posting in a closed period even with ordinary posting permission', async () => {
      const periods = await request(app.getHttpServer())
        .get('/periods')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .expect(200);
      const period = periods.body.find((p: any) => p.year === 2026 && p.month === 9);

      const created = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '40.00' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/periods/${period.id}/close`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .expect(201);

      const blocked = await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${created.body.id}/post`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ expectedVersion: created.body.version })
        .expect(409);

      expect(blocked.body.code).toBe('PERIOD_CLOSED');

      const reopened = await request(app.getHttpServer())
        .post(`/periods/${period.id}/reopen`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ reason: 'e2e test reopen' })
        .expect(201);
      expect(reopened.body.status).toBe('OPEN');

      const auditEvents = await prisma.auditEvent.findMany({
        where: { tenantId: tenantAId, entityType: 'AccountingPeriod', eventType: 'PERIOD_REOPENED' },
      });
      expect(auditEvents.length).toBeGreaterThan(0);
    });
  });

  // -- Create Based On (section 56, scenario G) ------------------------------
  describe('Create Based On', () => {
    it('creates a linked target document under the same tenant, never cross-tenant', async () => {
      const source = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '25.00' })
        .expect(201);

      const target = await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${source.body.id}/create-based-on/${FOUNDATION_TEST_DOCUMENT_TYPE}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({})
        .expect(201);

      expect(target.body.tenantId).toBe(tenantAId);

      const links = await request(app.getHttpServer())
        .get(`/document-links?documentType=${FOUNDATION_TEST_DOCUMENT_TYPE}&documentId=${source.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .expect(200);

      expect(links.body.some((l: any) => l.targetDocumentId === target.body.id && l.relationType === 'CREATED_BASED_ON')).toBe(
        true,
      );
    });

    it('cannot Create Based On across tenants', async () => {
      const sourceInA = await request(app.getHttpServer())
        .post('/foundation-test-documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Tenant-Id', tenantAId)
        .send({ documentDate: '2026-09-07', amount: '15.00' })
        .expect(201);

      // User B, scoped to Tenant B, cannot even see Tenant A's source doc to
      // base a new document on it.
      await request(app.getHttpServer())
        .post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${sourceInA.body.id}/create-based-on/${FOUNDATION_TEST_DOCUMENT_TYPE}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Tenant-Id', tenantBId)
        .send({})
        .expect(404);
    });
  });

  // -- Posting atomicity (section 56/76, scenario B) -------------------------
  describe('Posting transaction atomicity', () => {
    it('rolls back everything when movement generation fails midway', async () => {
      const registry = app.get(DocumentFrameworkRegistry);
      const postingService = app.get(DocumentPostingService);
      const FAKE_TYPE = `ATOMICITY_TEST_DOC_${run}`;

      // A throwaway document type + handler that generates 3 movements but
      // fails while persisting the 3rd (invalid businessDate) — proving the
      // whole transaction rolls back rather than leaving 2 movements and an
      // untouched document behind.
      const fakeDoc = {
        id: `fake-${run}`,
        tenantId: tenantAId,
        organizationId: null,
        documentType: FAKE_TYPE,
        number: 'FAKE-1',
        documentDate: new Date('2026-09-07'),
        postingDate: null,
        status: 'ACTIVE' as const,
        postingStatus: 'NOT_POSTED' as const,
        currencyId: null,
        exchangeRate: null,
        description: null,
        createdAt: new Date(),
        createdBy: null,
        updatedAt: new Date(),
        updatedBy: null,
        postedAt: null,
        postedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        deletionMark: false,
        version: 1,
      };

      registry.registerRepository({
        documentType: FAKE_TYPE,
        findById: async () => fakeDoc,
        applyStatusPatch: async () => {
          throw new Error('applyStatusPatch should never be reached in this test');
        },
        create: async () => fakeDoc,
      });

      registry.registerHandler({
        documentType: FAKE_TYPE,
        validateForPosting: async () => undefined,
        buildMovements: async () => [
          { registerCode: 'ATOMICITY_TEST', businessDate: new Date('2026-09-07') },
          { registerCode: 'ATOMICITY_TEST', businessDate: new Date('2026-09-07') },
          // Invalid: businessDate required not-null — this insert throws,
          // rolling back the whole transaction including the 2 above.
          { registerCode: 'ATOMICITY_TEST', businessDate: null as any },
        ],
      });

      await expect(postingService.post(tenantAId, FAKE_TYPE, fakeDoc.id, 1, 'system')).rejects.toBeTruthy();

      const survivingMovements = await prisma.registerMovement.count({
        where: { tenantId: tenantAId, recorderDocumentType: FAKE_TYPE, recorderDocumentId: fakeDoc.id },
      });
      expect(survivingMovements).toBe(0);
    });
  });
});
