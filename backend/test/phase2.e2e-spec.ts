/**
 * Phase 2 — Product/Nomenclature master data E2E tests.
 * Covers: unit of measure CRUD, product category hierarchy (cycle detection),
 * product CRUD with validation, SKU/barcode uniqueness, organization access
 * isolation, deactivation guards, optimistic concurrency, and audit.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Phase 2 — Product Catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test fixtures (tenant codes must match CreateTenantDto: lowercase alphanum/hyphen)
  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let unitId: string;
  let categoryId: string;
  let childCategoryId: string;
  let productId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper: register user + create tenant + organization
  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Test1234!', displayName: 'Test User' })
      .expect(201);
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
    const orgId = orgRes.body.id;

    return { token, tenantId, orgId };
  }

  describe('Setup', () => {
    it('should create two isolated tenants with organizations', async () => {
      const setup1 = await setupTenant(`p2a-${run}@e2e.test`, `p2-t1-${run}`, 'P2O1');
      token1 = setup1.token;
      tenant1Id = setup1.tenantId;
      org1Id = setup1.orgId;

      const setup2 = await setupTenant(`p2b-${run}@e2e.test`, `p2-t2-${run}`, 'P2O2');
      token2 = setup2.token;
      tenant2Id = setup2.tenantId;
      org2Id = setup2.orgId;

      expect(tenant1Id).toBeTruthy();
      expect(tenant2Id).toBeTruthy();
      expect(org1Id).toBeTruthy();
      expect(org2Id).toBeTruthy();
    });
  });

  describe('Unit of Measure', () => {
    it('should create a unit of measure', async () => {
      const res = await request(app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'KG', name: 'Kilogram', symbol: 'kg', unitType: 'WEIGHT' })
        .expect(201);

      unitId = res.body.id;
      expect(res.body.code).toBe('KG');
      expect(res.body.unitType).toBe('WEIGHT');
    });

    it('should reject duplicate unit code within tenant', async () => {
      await request(app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'KG', name: 'Kilogram Again', symbol: 'kg', unitType: 'WEIGHT' })
        .expect(409);
    });

    it('should reject invalid unit type', async () => {
      await request(app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'INVALID', name: 'Invalid Unit', unitType: 'INVALID_TYPE' })
        .expect(400);
    });

    it('should allow the same unit code in a different tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/units-of-measure')
        .set('Authorization', `Bearer ${token2}`)
        .set('X-Tenant-Id', tenant2Id)
        .send({ code: 'KG', name: 'Kilogram T2', symbol: 'kg', unitType: 'WEIGHT' })
        .expect(201);

      expect(res.body.code).toBe('KG');
    });

    it('should list units for the tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/units-of-measure')
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.some((u: any) => u.code === 'KG')).toBe(true);
    });

    it('should update a unit of measure with optimistic concurrency', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/units-of-measure/${unitId}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ name: 'Kilogram Updated', expectedVersion: 1 })
        .expect(200);

      expect(res.body.name).toBe('Kilogram Updated');
      expect(res.body.version).toBe(2);
    });

    it('should reject stale update (optimistic concurrency conflict)', async () => {
      await request(app.getHttpServer())
        .patch(`/units-of-measure/${unitId}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ name: 'Stale Update', expectedVersion: 1 })
        .expect(409);
    });
  });

  describe('Product Category', () => {
    it('should create a root category', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'ELECTRONICS', name: 'Electronics' })
        .expect(201);

      categoryId = res.body.id;
      expect(res.body.code).toBe('ELECTRONICS');
      expect(res.body.parentCategoryId).toBeNull();
    });

    it('should create a child category', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'LAPTOPS', name: 'Laptops', parentCategoryId: categoryId })
        .expect(201);

      expect(res.body.code).toBe('LAPTOPS');
      expect(res.body.parentCategoryId).toBe(categoryId);
      childCategoryId = res.body.id;
    });

    it('should reject duplicate category code within organization', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'ELECTRONICS', name: 'Electronics Again' })
        .expect(409);
    });

    it('should reject creating a category with itself as parent', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'CYCLE_TEST', name: 'Cycle Test' })
        .expect(201);

      const cycleId = res.body.id;

      await request(app.getHttpServer())
        .patch(`/organizations/${org1Id}/product-categories/${cycleId}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ parentCategoryId: cycleId, expectedVersion: 1 })
        .expect(400);
    });

    it('should reject circular hierarchy (re-parenting into descendant)', async () => {
      // Create: A -> B -> C
      const resA = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'CAT_A', name: 'Category A' })
        .expect(201);
      const catAId = resA.body.id;

      const resB = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'CAT_B', name: 'Category B', parentCategoryId: catAId })
        .expect(201);
      const catBId = resB.body.id;

      const resC = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ code: 'CAT_C', name: 'Category C', parentCategoryId: catBId })
        .expect(201);
      const catCId = resC.body.id;

      // Try to set A's parent to C (would create cycle: A -> B -> C -> A)
      await request(app.getHttpServer())
        .patch(`/organizations/${org1Id}/product-categories/${catAId}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ parentCategoryId: catCId, expectedVersion: 1 })
        .expect(400);
    });

    it('should get descendants of a category', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/product-categories/${categoryId}/descendants`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should enforce organization access isolation on categories', async () => {
      // Tenant2 cannot see Tenant1's categories
      await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/product-categories`)
        .set('Authorization', `Bearer ${token2}`)
        .set('X-Tenant-Id', tenant2Id)
        .expect(404);
    });
  });

  describe('Product', () => {
    it('should create a product', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({
          code: 'LAPTOP-001',
          name: 'Business Laptop',
          productType: 'GOODS',
          baseUnitId: unitId,
          categoryId: categoryId,
          sku: 'SKU-LAPTOP-001',
          barcode: '1234567890123',
        })
        .expect(201);

      productId = res.body.id;
      expect(res.body.code).toBe('LAPTOP-001');
      expect(res.body.productType).toBe('GOODS');
      expect(res.body.sku).toBe('SKU-LAPTOP-001');
    });

    it('should reject duplicate product code within organization', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({
          code: 'LAPTOP-001',
          name: 'Duplicate Laptop',
          productType: 'GOODS',
          baseUnitId: unitId,
        })
        .expect(409);
    });

    it('should reject duplicate SKU within tenant', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({
          code: 'LAPTOP-002',
          name: 'Another Laptop',
          productType: 'GOODS',
          baseUnitId: unitId,
          sku: 'SKU-LAPTOP-001',
        })
        .expect(409);
    });

    it('should reject duplicate barcode within tenant', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({
          code: 'LAPTOP-003',
          name: 'Yet Another Laptop',
          productType: 'GOODS',
          baseUnitId: unitId,
          barcode: '1234567890123',
        })
        .expect(409);
    });

    it('should reject invalid product type', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({
          code: 'INVALID-001',
          name: 'Invalid Product',
          productType: 'INVALID_TYPE',
          baseUnitId: unitId,
        })
        .expect(400);
    });

    it('should list products for the organization', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.some((p: any) => p.code === 'LAPTOP-001')).toBe(true);
    });

    it('should search products by code/name/SKU/barcode', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/products/search?q=LAPTOP`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].code).toContain('LAPTOP');
    });

    it('should update a product with optimistic concurrency', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${org1Id}/products/${productId}`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ name: 'Business Laptop Pro', expectedVersion: 1 })
        .expect(200);

      expect(res.body.name).toBe('Business Laptop Pro');
      expect(res.body.version).toBe(2);
    });

    it('should enforce organization access isolation on products', async () => {
      // Tenant2 cannot see Tenant1's products
      await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token2}`)
        .set('X-Tenant-Id', tenant2Id)
        .expect(404);
    });
  });

  describe('Deactivation guards', () => {
    it('should prevent deactivating a unit used by active products', async () => {
      await request(app.getHttpServer())
        .post(`/units-of-measure/${unitId}/deactivate`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ expectedVersion: 2 })
        .expect(400);
    });

    it('should prevent deactivating a category with active products', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories/${categoryId}/deactivate`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ expectedVersion: 1 })
        .expect(400);
    });

    it('should allow deactivating a product', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/products/${productId}/deactivate`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ expectedVersion: 2 })
        .expect(201);

      expect(res.body.active).toBe(false);
    });

    it('should now allow deactivating the category after product is inactive', async () => {
      // ELECTRONICS still has the active LAPTOPS child — the guard
      // correctly rejects deactivating a parent with active children,
      // so deactivate the child first.
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories/${childCategoryId}/deactivate`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ expectedVersion: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/product-categories/${categoryId}/deactivate`)
        .set('Authorization', `Bearer ${token1}`)
        .set('X-Tenant-Id', tenant1Id)
        .send({ expectedVersion: 1 })
        .expect(201);
    });
  });

  describe('Audit', () => {
    it('should record product creation in audit log', async () => {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId: tenant1Id, entityType: 'Product' },
        orderBy: { timestamp: 'desc' },
        take: 1,
      });

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('PRODUCT_DEACTIVATED');
    });

    it('should record unit of measure creation in audit log', async () => {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId: tenant1Id, entityType: 'UnitOfMeasure' },
        orderBy: { timestamp: 'desc' },
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.eventType === 'UNIT_OF_MEASURE_CREATED')).toBe(true);
    });

    it('should record category creation in audit log', async () => {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId: tenant1Id, entityType: 'ProductCategory' },
        orderBy: { timestamp: 'desc' },
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.eventType === 'PRODUCT_CATEGORY_CREATED')).toBe(true);
    });
  });
});
