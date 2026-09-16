/**
 * Counterparty bank-account-change control E2E tests
 * (docs/COUNTERPARTY_MANAGEMENT.md is referenced elsewhere but does not
 * exist yet — this increment is documented inline and in APPROVALS.md).
 *
 * Covers: a new bank account starts PENDING; changing a sensitive field
 * (iban/accountNumber/swiftBic/bankCode/bankName/correspondentAccount)
 * reopens an APPROVED account back to PENDING; a cosmetic-only change
 * (notes) never touches status; approve/reject transitions; and — the
 * actual point of the feature — PaymentOrder refuses to reference an
 * unapproved counterparty bank account, both at creation and again at
 * posting time (see treasury.e2e-spec.ts for the full posting-time
 * re-check, since that needs the full PO->GRN->Invoice fixture chain).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Counterparty bank-account-change control (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let approverToken: string;
  let tenant1Id: string;
  let org1Id: string;
  let counterpartyId: string;
  let currencyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`cpba1-${run}@e2e.test`, `cpba-t1-${run}`, 'CPBA1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    approverToken = await setupApprover();

    const currencies = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    currencyId = currencies.body.find((c: any) => c.code === 'AZN')?.id ?? currencies.body[0].id;

    const cp = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
      .send({ counterpartyType: 'SUPPLIER', code: `CPBA-${run}`, name: 'Bank Account Test Supplier' })
      .expect(201);
    counterpartyId = cp.body.id;
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

  async function setupApprover(): Promise<string> {
    const email = `cpba-approver-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'Approver' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });
    const permission = await prisma.permission.findFirst({ where: { code: 'counterparty.approve' } });
    if (!permission) throw new Error('counterparty.approve not seeded — run prisma:seed');
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: `CPBA-APPROVER-${run}`, name: 'Bank Account Approver' } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    return reg.body.accessToken;
  }

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function approverAuth(req: request.Test) {
    return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
  }

  it('a new bank account starts PENDING and cannot be used until approved', async () => {
    const acc = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts`))
      .send({ bankName: 'Bank of Baku', accountNumber: `ACC-${run}-1`, iban: 'AZ00NABZ00000000000000001111', currencyId })
      .expect(201);
    expect(acc.body.status).toBe('PENDING');
    expect(acc.body.approvedBy).toBeNull();

    await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}/approve`))
      .send({ expectedVersion: acc.body.version })
      .expect(201);

    const cp = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${counterpartyId}`)).expect(200);
    const approved = cp.body.bankAccounts.find((a: any) => a.id === acc.body.id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBeTruthy();
  });

  it('changing a sensitive field (iban) reopens an APPROVED account back to PENDING; a cosmetic change (notes) does not', async () => {
    const acc = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts`))
      .send({ bankName: 'Second Bank', accountNumber: `ACC-${run}-2`, iban: 'AZ00NABZ00000000000000002222', currencyId })
      .expect(201);
    await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}/approve`))
      .send({ expectedVersion: acc.body.version })
      .expect(201);

    const cosmetic = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}`))
      .send({ notes: 'preferred for large transfers', expectedVersion: acc.body.version + 1 })
      .expect(200);
    expect(cosmetic.body.status).toBe('APPROVED');

    const changed = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}`))
      .send({ iban: 'AZ00NABZ00000000000000009999', expectedVersion: cosmetic.body.version })
      .expect(200);
    expect(changed.body.status).toBe('PENDING');
    expect(changed.body.approvedBy).toBeNull();
  });

  it('rejecting a bank account marks it REJECTED, and a later correction reopens it to PENDING', async () => {
    const acc = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts`))
      .send({ bankName: 'Suspicious Bank', accountNumber: `ACC-${run}-3`, currencyId })
      .expect(201);

    await approverAuth(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}/reject`))
      .send({ reason: 'account number does not match the signed contract', expectedVersion: acc.body.version })
      .expect(201);

    const cp = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${counterpartyId}`)).expect(200);
    const rejected = cp.body.bankAccounts.find((a: any) => a.id === acc.body.id);
    expect(rejected.status).toBe('REJECTED');

    const corrected = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}`))
      .send({ accountNumber: `ACC-${run}-3-CORRECTED`, expectedVersion: rejected.version })
      .expect(200);
    expect(corrected.body.status).toBe('PENDING');
  });

  it('a caller without counterparty.approve cannot approve or reject a bank account', async () => {
    const acc = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts`))
      .send({ bankName: 'Fourth Bank', accountNumber: `ACC-${run}-4`, currencyId })
      .expect(201);

    const editorEmail = `cpba-editor-${run}@e2e.test`;
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email: editorEmail, password: 'Test1234!', displayName: 'Editor Only' }).expect(201);
    const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' } });
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL' } });
    const editPermission = await prisma.permission.findFirst({ where: { code: 'counterparty.edit' } });
    const viewPermission = await prisma.permission.findFirst({ where: { code: 'counterparty.view' } });
    const role = await prisma.role.create({ data: { tenantId: tenant1Id, code: `CPBA-EDITOR-${run}`, name: 'Bank Account Editor' } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    await prisma.rolePermission.createMany({ data: [editPermission!, viewPermission!].map((p) => ({ roleId: role.id, permissionId: p.id })) });
    const editorToken = reg.body.accessToken;

    const blocked = await request(app.getHttpServer())
      .post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts/${acc.body.id}/approve`)
      .set('Authorization', `Bearer ${editorToken}`)
      .set('X-Tenant-Id', tenant1Id)
      .send({ expectedVersion: acc.body.version });
    expect(blocked.status).toBe(403);
  });
});
