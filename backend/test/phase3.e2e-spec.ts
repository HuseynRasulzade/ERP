/**
 * Phase 3 — Counterparty Master Data + Pricing E2E tests.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Phase 3 — Counterparty & Pricing (e2e)', () => {
  let app: INestApplication;
  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let unitPieceId: string;
  let unitBoxId: string;
  let productId: string;
  let currencyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

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

    return { token, tenantId, orgId: orgRes.body.id };
  }

  describe('Setup', () => {
    it('should create two isolated tenants with organizations, units, and a product', async () => {
      const s1 = await setupTenant(`p3a-${run}@e2e.test`, `p3-t1-${run}`, 'P3O1');
      token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
      const s2 = await setupTenant(`p3b-${run}@e2e.test`, `p3-t2-${run}`, 'P3O2');
      token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

      const u1 = await request(app.getHttpServer()).post('/units-of-measure')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ code: 'PCS3', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' }).expect(201);
      unitPieceId = u1.body.id;

      const u2 = await request(app.getHttpServer()).post('/units-of-measure')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ code: 'BOX3', name: 'Box', symbol: 'box', unitType: 'QUANTITY' }).expect(201);
      unitBoxId = u2.body.id;

      const p = await request(app.getHttpServer()).post(`/organizations/${org1Id}/products`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ code: 'P3-PROD-001', name: 'Phase3 Widget', productType: 'GOODS', baseUnitId: unitPieceId })
        .expect(201);
      productId = p.body.id;
      expect(productId).toBeTruthy();

      // GET /currencies requires JWT + tenant context (no specific permission)
      const curRes = await request(app.getHttpServer()).get('/currencies')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .expect(200);
      expect(Array.isArray(curRes.body)).toBe(true);
      currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id || curRes.body[0]?.id;
      expect(currencyId).toBeTruthy();
    });
  });

  describe('Unit Conversions', () => {
    it('should create a unit conversion', async () => {
      const res = await request(app.getHttpServer()).post('/unit-conversions')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ fromUnitId: unitBoxId, toUnitId: unitPieceId, factor: 12, description: '1 box = 12 pcs' })
        .expect(201);
      expect(res.body.factor.toString()).toContain('12');
    });

    it('should reject duplicate conversion', async () => {
      await request(app.getHttpServer()).post('/unit-conversions')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ fromUnitId: unitBoxId, toUnitId: unitPieceId, factor: 12 })
        .expect(409);
    });

    it('should reject same-unit conversion', async () => {
      await request(app.getHttpServer()).post('/unit-conversions')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ fromUnitId: unitPieceId, toUnitId: unitPieceId, factor: 1 })
        .expect(400);
    });

    it('should reject non-positive factor', async () => {
      await request(app.getHttpServer()).post('/unit-conversions')
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ fromUnitId: unitPieceId, toUnitId: unitBoxId, factor: 0 })
        .expect(400);
    });
  });

  describe('Counterparty', () => {
    let cpId: string;

    it('should create a customer', async () => {
      const res = await request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ counterpartyType: 'CUSTOMER', code: 'CUST-001', name: 'Acme Buyer', taxId: '1234567890' })
        .expect(201);
      cpId = res.body.id;
      expect(res.body.code).toBe('CUST-001');
    });

    it('should reject duplicate code', async () => {
      await request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ counterpartyType: 'SUPPLIER', code: 'CUST-001', name: 'Dup' })
        .expect(409);
    });

    it('should add address and contact', async () => {
      await request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${cpId}/addresses`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ addressType: 'LEGAL', addressLine1: '1 Main St', city: 'Baku' })
        .expect(201);

      await request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${cpId}/contacts`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ firstName: 'John', lastName: 'Doe', email: 'john@acme.test' })
        .expect(201);

      const got = await request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${cpId}`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .expect(200);
      expect(got.body.addresses.length).toBe(1);
      expect(got.body.contacts.length).toBe(1);
    });

    it('should search counterparties', async () => {
      const res = await request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/search?q=Acme`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should enforce organization isolation', async () => {
      await request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties`)
        .set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id)
        .expect(404);
    });
  });

  describe('Price Lists', () => {
    let plId: string;

    it('should create a sale price list', async () => {
      const res = await request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({
          priceListType: 'SALE', code: 'RETAIL-2026', name: 'Retail 2026',
          currencyId, validFrom: '2026-01-01',
        })
        .expect(201);
      plId = res.body.id;
      expect(res.body.code).toBe('RETAIL-2026');
    });

    it('should add a product price', async () => {
      const res = await request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists/${plId}/prices`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ productId, unitId: unitPieceId, price: 99.99, minQuantity: 1 })
        .expect(201);
      expect(res.body.price.toString()).toContain('99.99');
    });

    it('should reject duplicate price row', async () => {
      await request(app.getHttpServer()).post(`/organizations/${org1Id}/price-lists/${plId}/prices`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .send({ productId, unitId: unitPieceId, price: 89.99, minQuantity: 1 })
        .expect(409);
    });

    it('should resolve price for a date', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/price-lists/${plId}/resolve-price/${productId}?type=SALE&date=2026-06-01&quantity=1`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .expect(200);
      expect(res.body).toBeTruthy();
      expect(res.body.price.toString()).toContain('99.99');
    });

    it('should return null when no price matches (out of validity)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${org1Id}/price-lists/${plId}/resolve-price/${productId}?type=SALE&date=2020-01-01&quantity=1`)
        .set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id)
        .expect(200);
      // The service resolves to null; Nest serializes a null controller
      // result as an empty 200 body, which supertest parses as {}.
      expect(res.body === null || Object.keys(res.body).length === 0).toBe(true);
    });
  });
});
