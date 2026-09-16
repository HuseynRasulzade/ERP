/**
 * Pending-approvals inbox E2E tests ("Bildiriş/tapşırıq paneli" —
 * docs/APPROVALS.md). GET /approval-steps/pending scans every registered
 * document type's PENDING approval steps and returns only the ones the
 * CURRENT user is eligible to act on right now, reusing each document
 * type's own ApprovalPlanProvider.resolveApprover — never a duplicated
 * role map.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { PURCHASE_ORDER_TYPE } from '../src/procurement/purchase-order.repository';
import { SALES_ORDER_TYPE } from '../src/sales-documents/sales-order.repository';
import * as request from 'supertest';

describe('Pending approvals inbox (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let procurementOfficerToken: string;
  let salesManagerToken: string;
  let tenant1Id: string;
  let org1Id: string;
  let supplierId: string;
  let customerId: string;
  let productId: string;
  let unitId: string;
  let warehouseId: string;

  const DOC_DATE = '2026-09-17';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`pend1-${run}@e2e.test`, `pend-t1-${run}`, 'PEND1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    procurementOfficerToken = await setupUser('PROCUREMENT_OFFICER');
    salesManagerToken = await setupUser('SALES_MANAGER');

    const u = await auth1(request(app.getHttpServer()).post('/units-of-measure'))
      .send({ code: 'PCS-PEND', name: 'Piece', symbol: 'pcs', unitType: 'QUANTITY' })
      .expect(201);
    unitId = u.body.id;

    const p = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/products`))
      .send({ code: 'PEND-PROD-001', name: 'Inbox Widget', productType: 'GOODS', baseUnitId: unitId })
      .expect(201);
    productId = p.body.id;

    const supplier = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: `PEND-SUP-${run}`, name: 'Inbox Supplier' })
      .expect(201);
    supplierId = supplier.body.id;

    const customer = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'CUSTOMER', code: `PEND-CUST-${run}`, name: 'Inbox Customer' })
      .expect(201);
    customerId = customer.body.id;

    const wh = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/warehouses`))
      .send({ code: 'WH-PEND', name: 'Inbox Warehouse' })
      .expect(201);
    warehouseId = wh.body.id;
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

  /** A second tenant1 user holding exactly one role — never the creator
   * (token1) of any fixture document below, so self-approval never masks
   * whether the inbox itself is right. */
  async function setupUser(roleCode: string): Promise<string> {
    const email = `pend-${roleCode.toLowerCase()}-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: roleCode }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });
    const permissions = await prisma.permission.findMany({
      where: { code: { in: ['purchase.order.view', 'purchase.order.approve', 'purchase.order.reject', 'documents.view', 'sales_order.view', 'sales.order.approve', 'sales.order.reject'] } },
    });
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: roleCode, name: roleCode } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    return reg.body.accessToken;
  }

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function officerAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${procurementOfficerToken}`).set('X-Tenant-Id', tenant1Id);
  }
  function managerAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${salesManagerToken}`).set('X-Tenant-Id', tenant1Id);
  }

  it('shows each user only the approval steps they are eligible to act on, across different document types', async () => {
    const po = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders`))
      .send({ counterpartyId: supplierId, documentDate: DOC_DATE, warehouseId, lines: [{ productId, unitId, quantity: 5, price: 20 }] })
      .expect(201);

    const so = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders`))
      .send({ counterpartyId: customerId, documentDate: DOC_DATE, lines: [{ productId, unitId, quantity: 10, price: 2000 }] }) // 20,000 AZN > threshold
      .expect(201);
    expect(so.body.approvalStatus).toBe('PENDING');

    const officerInbox = await officerAuth(request(app.getHttpServer()).get('/approval-steps/pending')).expect(200);
    expect(officerInbox.body.some((i: any) => i.documentType === PURCHASE_ORDER_TYPE && i.documentId === po.body.id && i.stepType === 'PROCUREMENT_OFFICER')).toBe(true);
    expect(officerInbox.body.some((i: any) => i.documentType === SALES_ORDER_TYPE)).toBe(false);

    const managerInbox = await managerAuth(request(app.getHttpServer()).get('/approval-steps/pending')).expect(200);
    expect(managerInbox.body.some((i: any) => i.documentType === SALES_ORDER_TYPE && i.documentId === so.body.id && i.stepType === 'SALES_MANAGER')).toBe(true);
    expect(managerInbox.body.some((i: any) => i.documentType === PURCHASE_ORDER_TYPE)).toBe(false);

    // The sales manager approves; the item then disappears from their own inbox.
    await managerAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/sales-orders/${so.body.id}/approve`)).send({}).expect(201);
    const managerInboxAfter = await managerAuth(request(app.getHttpServer()).get('/approval-steps/pending')).expect(200);
    expect(managerInboxAfter.body.some((i: any) => i.documentId === so.body.id)).toBe(false);

    // The procurement officer approves the first PO step; the NEXT step
    // (DEPARTMENT_HEAD) is not resolvable by anyone in this fixture, so it
    // simply never appears in either inbox — the officer's own item is gone.
    await officerAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/purchase-orders/${po.body.id}/approve`)).send({}).expect(201);
    const officerInboxAfter = await officerAuth(request(app.getHttpServer()).get('/approval-steps/pending')).expect(200);
    expect(officerInboxAfter.body.some((i: any) => i.documentId === po.body.id)).toBe(false);
  });
});
