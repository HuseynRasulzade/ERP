/**
 * Demo account E2E tests — runs prisma/seed-demo-account.ts against a real
 * listening instance of the app (the seeder speaks plain HTTP, exactly as
 * it does against the deployed API), then verifies the demo data the manual
 * test cases in docs/DEMO_TEST_CASES.md rely on: login, tenant/org access,
 * master data, posted documents with their stock / journal / VAT effects,
 * idempotent re-runs, and that the demo tenant stays invisible to others.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import {
  DemoAccount,
  DemoSeedSummary,
  seedDemoAccount,
} from '../prisma/seed-demo-account';
import * as request from 'supertest';

describe('Demo account (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const run = Date.now();
  const account: Partial<DemoAccount> = {
    email: `demo-${run}@e2e.test`,
    password: 'Demo1234!',
    tenantCode: `demo-${run}`,
    orgCode: 'DEMO',
  };
  let summary: DemoSeedSummary;
  let token: string;

  const silent = () => undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0);
    baseUrl = await app.getUrl();
    baseUrl = baseUrl.replace('[::1]', 'localhost');

    summary = await seedDemoAccount(baseUrl, { account, log: silent });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, password: account.password })
      .expect(201);
    token = login.body.accessToken;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  function authed(req: request.Test) {
    return req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', summary.tenantId);
  }
  const orgPath = () => `/organizations/${summary.organizationId}`;
  const list = async (path: string) => {
    const res = await authed(request(app.getHttpServer()).get(path)).expect(
      200,
    );
    return Array.isArray(res.body)
      ? res.body
      : (res.body.items ?? res.body.data);
  };

  describe('Account & access', () => {
    it('DEMO-01 creates the demo user, tenant and organization on first run', () => {
      expect(summary.createdDocuments).toBe(true);
      expect(summary.tenantId).toBeTruthy();
      expect(summary.organizationId).toBeTruthy();
    });

    it('DEMO-02 demo user is a member of exactly the demo tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me/tenants')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.map((m: any) => m.tenantCode)).toEqual([
        account.tenantCode,
      ]);
    });

    it('DEMO-03 rejects a wrong password with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: 'wrong-password' })
        .expect(401);
    });

    it('DEMO-04 demo user holds full Tenant Administrator permissions', async () => {
      const res = await authed(
        request(app.getHttpServer()).get('/permissions/me'),
      ).expect(200);
      const codes: string[] = Array.isArray(res.body)
        ? res.body
        : res.body.permissions;
      expect(codes).toEqual(expect.arrayContaining(['documents.post']));
    });

    it('DEMO-05 another tenant cannot see the demo organization (404, never 403)', async () => {
      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `outsider-${run}@e2e.test`,
          password: 'Test1234!',
          displayName: 'Outsider',
        })
        .expect(201);
      const tenant = await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${reg.body.accessToken}`)
        .send({ code: `outsider-${run}`, name: 'Outsider Corp' })
        .expect(201);
      await request(app.getHttpServer())
        .get(`${orgPath()}/sales-invoices`)
        .set('Authorization', `Bearer ${reg.body.accessToken}`)
        .set('X-Tenant-Id', tenant.body.id)
        .expect(404);
    });
  });

  describe('Master data', () => {
    it('DEMO-06 seeds departments and warehouses', async () => {
      expect(
        (await list(`${orgPath()}/departments`)).map((d: any) => d.code).sort(),
      ).toEqual(['FINANCE', 'PROCUREMENT', 'SALES']);
      expect(
        (await list(`${orgPath()}/warehouses`)).map((w: any) => w.code).sort(),
      ).toEqual(['WH-MAIN', 'WH-RETAIL']);
    });

    it('DEMO-07 seeds six products, including one service', async () => {
      const products = await list(`${orgPath()}/products`);
      expect(products).toHaveLength(6);
      expect(
        products
          .filter((p: any) => p.productType === 'SERVICE')
          .map((p: any) => p.code),
      ).toEqual(['SRV-INSTALL']);
    });

    it('DEMO-08 seeds customers, suppliers and a dual-role partner', async () => {
      const cps = await list(`${orgPath()}/counterparties`);
      const byType = (t: string) =>
        cps.filter((c: any) => c.counterpartyType === t).length;
      expect(byType('CUSTOMER')).toBe(3);
      expect(byType('SUPPLIER')).toBe(2);
      expect(byType('BOTH')).toBe(1);
    });

    it('DEMO-09 seeds a SALE and a PURCHASE price list', async () => {
      const lists = await list(`${orgPath()}/price-lists`);
      expect(lists.map((l: any) => l.priceListType).sort()).toEqual([
        'PURCHASE',
        'SALE',
      ]);
    });
  });

  describe('Documents and their effects', () => {
    it('DEMO-10 has one posted and one draft sales order', async () => {
      const orders = await list(`${orgPath()}/sales-orders`);
      expect(orders.map((o: any) => o.postingStatus).sort()).toEqual([
        'NOT_POSTED',
        'POSTED',
      ]);
    });

    it('DEMO-11 posted sales invoice totals 10 797 AZN (9 150 + 18% VAT)', async () => {
      const invoices = await list(`${orgPath()}/sales-invoices`);
      expect(invoices).toHaveLength(2);
      const posted = invoices.find((i: any) => i.postingStatus === 'POSTED');
      expect(Number(posted.subtotal)).toBeCloseTo(9150, 2);
      expect(Number(posted.taxTotal)).toBeCloseTo(1647, 2);
      expect(Number(posted.grandTotal)).toBeCloseTo(10797, 2);
    });

    it('DEMO-12 posted sales invoice produced a balanced journal entry', async () => {
      const posted = (await list(`${orgPath()}/sales-invoices`)).find(
        (i: any) => i.postingStatus === 'POSTED',
      );
      const res = await authed(
        request(app.getHttpServer())
          .get(`${orgPath()}/accounting/journal-entries`)
          .query({
            sourceDocumentType: 'SALES_INVOICE',
            sourceDocumentId: posted.id,
          }),
      ).expect(200);
      expect(res.body).toHaveLength(1);
      const lines = res.body[0].lines;
      const sum = (side: string) =>
        lines
          .filter((l: any) => l.side === side)
          .reduce((s: number, l: any) => s + Number(l.amountBase), 0);
      expect(sum('DEBIT')).toBeCloseTo(10797, 2);
      expect(sum('CREDIT')).toBeCloseTo(sum('DEBIT'), 2);
    });

    it('DEMO-13 opening stock and the transfer are reflected in warehouse balances', async () => {
      const warehouses = await list(`${orgPath()}/warehouses`);
      const products = await list(`${orgPath()}/products`);
      const wh = (code: string) =>
        warehouses.find((w: any) => w.code === code).id;
      const product = (code: string) =>
        products.find((p: any) => p.code === code).id;
      const stock = async (whCode: string, productCode: string) => {
        const res = await authed(
          request(app.getHttpServer()).get(
            `${orgPath()}/warehouses/${wh(whCode)}/products/${product(productCode)}/stock`,
          ),
        ).expect(200);
        return Number(res.body.available);
      };
      expect(await stock('WH-MAIN', 'MOUSE-001')).toBe(150);
      expect(await stock('WH-RETAIL', 'MOUSE-001')).toBe(50);
      expect(await stock('WH-MAIN', 'PAPER-A4')).toBe(400);
      expect(await stock('WH-RETAIL', 'PAPER-A4')).toBe(100);
      expect(await stock('WH-MAIN', 'LAPTOP-001')).toBe(25);
    });

    it('DEMO-14 has a draft purchase order to the main supplier', async () => {
      const pos = await list(`${orgPath()}/purchase-orders`);
      expect(pos).toHaveLength(1);
      expect(pos[0].postingStatus).toBe('NOT_POSTED');
    });

    it('DEMO-15 the draft sales order can be posted from the demo account', async () => {
      const draft = (await list(`${orgPath()}/sales-orders`)).find(
        (o: any) => o.postingStatus === 'NOT_POSTED',
      );
      const posted = await authed(
        request(app.getHttpServer()).post(
          `/documents/SALES_ORDER/${draft.id}/post`,
        ),
      )
        .send({ expectedVersion: draft.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');
    });
  });

  describe('Idempotency', () => {
    it('DEMO-16 re-running the seeder creates no duplicates', async () => {
      const again = await seedDemoAccount(baseUrl, { account, log: silent });
      expect(again.createdDocuments).toBe(false);
      expect(again.tenantId).toBe(summary.tenantId);
      expect(again.organizationId).toBe(summary.organizationId);
      expect(await list(`${orgPath()}/products`)).toHaveLength(6);
      expect(await list(`${orgPath()}/counterparties`)).toHaveLength(6);
      expect(await list(`${orgPath()}/sales-invoices`)).toHaveLength(2);
    }, 60_000);
  });
});
