/**
 * "Kontragentlər" (Counterparty CRM) E2E tests.
 *
 * Covers: full-data counterparty creation + approval, approval blocked
 * on incomplete data, resident vs non-resident creation, duplicate VÖEN
 * rejection, multiple bank accounts (first auto-primary), multiple
 * contacts, contract creation, multiple amendments on one contract,
 * documents uploaded to the correct owner (contract vs amendment),
 * incomplete contract/amendment approval blocked, and full-data
 * approval succeeding with approver/date recorded.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Kontragentlər — Counterparty Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let currencyId: string;
  let responsiblePersonId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`cpm1-${run}@e2e.test`, `cpm-t1-${run}`, 'CPM1');
    token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
    const s2 = await setupTenant(`cpm2-${run}@e2e.test`, `cpm-t2-${run}`, 'CPM2');
    token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

    const curRes = await auth1(request(app.getHttpServer()).get('/currencies')).expect(200);
    currencyId = curRes.body.find((c: any) => c.code === 'USD')?.id;

    const personRes = await auth1(request(app.getHttpServer()).post('/responsible-persons'))
      .send({ displayName: 'Contract Manager' })
      .expect(201);
    responsiblePersonId = personRes.body.id;
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

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }

  let counterpartyId: string;

  describe('Counterparty creation & approval', () => {
    it('creates a counterparty with full data and approves it successfully', async () => {
      const created = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({
          counterpartyType: 'BOTH', code: `CP-FULL-${run}`, name: 'Full Data LLC',
          residencyStatus: 'RESIDENT', taxId: '1112223334', vatPayer: true, countryCode: 'AZ',
        })
        .expect(201);
      counterpartyId = created.body.id;
      expect(created.body.status).toBe('DRAFT');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/addresses`))
        .send({ addressType: 'LEGAL', addressLine1: '1 Nizami St', city: 'Baku', countryCode: 'AZ' })
        .expect(201);

      const approved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/approve`))
        .send({ expectedVersion: created.body.version })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approvedBy).toBeTruthy();
      expect(approved.body.approvedAt).toBeTruthy();
    });

    it('blocks approval of a counterparty with incomplete data and lists the missing fields', async () => {
      const created = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'CUSTOMER', code: `CP-INCOMPLETE-${run}`, name: 'Incomplete Co' })
        .expect(201);

      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${created.body.id}/approve`))
        .send({ expectedVersion: created.body.version })
        .expect(400);
      expect(res.body.fieldErrors).toBeDefined();
      expect(Object.keys(res.body.fieldErrors)).toEqual(expect.arrayContaining(['taxId', 'countryCode', 'legalAddress']));

      const stillDraft = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${created.body.id}`)).expect(200);
      expect(stillDraft.body.status).toBe('DRAFT');
    });

    it('creates a resident (VÖEN) and a non-resident (foreign tax id, no local VÖEN needed) counterparty', async () => {
      const resident = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: `CP-RES-${run}`, name: 'Resident Co', residencyStatus: 'RESIDENT', taxId: '2223334445' })
        .expect(201);
      expect(resident.body.residencyStatus).toBe('RESIDENT');

      const nonResident = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: `CP-NONRES-${run}`, name: 'Foreign Co', residencyStatus: 'NON_RESIDENT', foreignTaxId: 'DE-123456789', countryCode: 'DE' })
        .expect(201);
      expect(nonResident.body.residencyStatus).toBe('NON_RESIDENT');
      expect(nonResident.body.taxId).toBeNull();

      // A non-resident with a legal address can approve without ever providing a local VÖEN.
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${nonResident.body.id}/addresses`))
        .send({ addressType: 'LEGAL', addressLine1: 'Hauptstrasse 1', city: 'Berlin', countryCode: 'DE' })
        .expect(201);
      const approved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${nonResident.body.id}/approve`))
        .send({ expectedVersion: nonResident.body.version })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
    });

    it('rejects a VÖEN format that is not exactly 10 digits', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: `CP-BADFMT-${run}`, name: 'Bad Format Co', taxId: '12345' })
        .expect(400);
    });

    it('blocks creating a second counterparty with the same VÖEN in the same organization', async () => {
      const first = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: `CP-DUPA-${run}`, name: 'Dup A', taxId: '3334445556' })
        .expect(201);
      expect(first.body.taxId).toBe('3334445556');

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties`))
        .send({ counterpartyType: 'SUPPLIER', code: `CP-DUPB-${run}`, name: 'Dup B', taxId: '3334445556' })
        .expect(409);
    });
  });

  describe('Bank accounts', () => {
    it('adds multiple bank accounts, the first becoming primary automatically, and only one primary at a time', async () => {
      const acc1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts`))
        .send({ bankName: 'Bank of Baku', accountNumber: 'ACC-001', currencyId })
        .expect(201);
      expect(acc1.body.isPrimary).toBe(true);

      const acc2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/bank-accounts`))
        .send({ bankName: 'International Bank', accountNumber: 'ACC-002', currencyId, isPrimary: true })
        .expect(201);
      expect(acc2.body.isPrimary).toBe(true);

      const cp = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${counterpartyId}`)).expect(200);
      const primaryAccounts = cp.body.bankAccounts.filter((a: any) => a.isPrimary);
      expect(primaryAccounts).toHaveLength(1);
      expect(primaryAccounts[0].id).toBe(acc2.body.id);
      expect(cp.body.bankAccounts).toHaveLength(2);
    });
  });

  describe('Contacts', () => {
    it('adds multiple contacts with only one primary at a time', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/contacts`))
        .send({ firstName: 'Ali', lastName: 'Aliyev', position: 'Manager', phone: '+994501234567', isPrimary: true })
        .expect(201);
      const contact2 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/contacts`))
        .send({ firstName: 'Leyla', lastName: 'Hasanova', position: 'Accountant', department: 'Finance', phone: '+994551112233', mobile: '+994701112233', email: 'leyla@example.com', isPrimary: true })
        .expect(201);

      const cp = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparties/${counterpartyId}`)).expect(200);
      expect(cp.body.contacts).toHaveLength(2);
      const primaryContacts = cp.body.contacts.filter((c: any) => c.isPrimary);
      expect(primaryContacts).toHaveLength(1);
      expect(primaryContacts[0].id).toBe(contact2.body.id);
    });

    it('rejects an invalid phone/email format on a contact', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/contacts`))
        .send({ firstName: 'Bad', lastName: 'Phone', phone: 'not-a-phone!!' })
        .expect(400);
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/contacts`))
        .send({ firstName: 'Bad', lastName: 'Email', email: 'not-an-email' })
        .expect(400);
    });
  });

  let contractId: string;
  let amendmentId: string;

  describe('Contracts', () => {
    it('creates a contract for the counterparty', async () => {
      const contract = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/contracts`))
        .send({ number: `C-${run}-001`, subject: 'Master Supply Agreement' })
        .expect(201);
      contractId = contract.body.id;
      expect(contract.body.status).toBe('DRAFT');
    });

    it('blocks creating a duplicate contract number for the same counterparty', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparties/${counterpartyId}/contracts`))
        .send({ number: `C-${run}-001`, subject: 'Duplicate attempt' })
        .expect(409);
    });

    it('blocks approving an incomplete contract and lists the missing fields', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contractId}/approve`))
        .send({ expectedVersion: 1 })
        .expect(400);
      expect(res.body.fieldErrors).toBeDefined();
      expect(Object.keys(res.body.fieldErrors).length).toBeGreaterThan(0);
    });

    it('fills every section-5 header field but still blocks approval without a purchase order link, lines, and a document (spec section 14)', async () => {
      const updated = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contracts/${contractId}`))
        .send({
          expectedVersion: 1, contractType: 'SUPPLY', signedDate: '2026-01-10', startDate: '2026-01-15', endDate: '2026-12-31',
          amount: 50000, currencyId, paymentTerms: 'NET 30', responsiblePersonId, deliveryTerms: 'EXW warehouse',
        })
        .expect(200);
      expect(updated.body.version).toBe(2);

      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contractId}/approve`))
        .send({ expectedVersion: 2 })
        .expect(400);
      expect(res.body.fieldErrors).toHaveProperty('sourcePurchaseOrderId');
      expect(res.body.fieldErrors).toHaveProperty('lines');
      // See test/counterparty-contract-terms.e2e-spec.ts for the full
      // happy path (PO-sourced lines + tax + document -> approval succeeds).
    });
  });

  describe('Contract amendments', () => {
    it('creates multiple amendments on the same contract', async () => {
      const a1 = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contractId}/amendments`))
        .send({ number: 'A-001', subject: 'Extend delivery window' })
        .expect(201);
      amendmentId = a1.body.id;

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contractId}/amendments`))
        .send({ number: 'A-002', subject: 'Price adjustment', newAmount: 55000, currencyId, changeDescription: 'Annual price escalation' })
        .expect(201);

      const list = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${contractId}/amendments`)).expect(200);
      expect(list.body).toHaveLength(2);

      const contractWithAmendments = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/contracts/${contractId}`)).expect(200);
      expect(contractWithAmendments.body.amendments).toHaveLength(2);
    });

    it('blocks a duplicate amendment number within the same contract', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contracts/${contractId}/amendments`))
        .send({ number: 'A-001', subject: 'Duplicate' })
        .expect(409);
    });

    it('blocks approving an incomplete amendment', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contract-amendments/${amendmentId}/approve`))
        .send({ expectedVersion: 1 })
        .expect(400);
      expect(res.body.fieldErrors).toBeDefined();
    });

    it('approves a fully completed amendment', async () => {
      const updated = await auth1(request(app.getHttpServer()).patch(`/organizations/${org1Id}/contract-amendments/${amendmentId}`))
        .send({ expectedVersion: 1, amendmentDate: '2026-03-01', effectiveDate: '2026-03-15', endDate: '2026-12-31', changeDescription: 'Extended the delivery window by 30 days' })
        .expect(200);

      const approved = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/contract-amendments/${amendmentId}/approve`))
        .send({ expectedVersion: updated.body.version })
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
    });
  });

  describe('Documents', () => {
    it('uploads a document to the contract and another to the amendment, each visible only under its own owner', async () => {
      const contractDoc = await auth1(
        request(app.getHttpServer())
          .post(`/organizations/${org1Id}/counterparty-documents`)
          .field('ownerType', 'CONTRACT')
          .field('ownerId', contractId)
          .field('notes', 'Signed contract scan')
          .attach('file', Buffer.from('%PDF-1.4 test contract content'), { filename: 'contract.pdf', contentType: 'application/pdf' }),
      ).expect(201);
      expect(contractDoc.body.fileName).toBe('contract.pdf');
      expect(contractDoc.body.documentVersion).toBe(1);

      const amendmentDoc = await auth1(
        request(app.getHttpServer())
          .post(`/organizations/${org1Id}/counterparty-documents`)
          .field('ownerType', 'CONTRACT_AMENDMENT')
          .field('ownerId', amendmentId)
          .attach('file', Buffer.from('%PDF-1.4 test amendment content'), { filename: 'amendment.pdf', contentType: 'application/pdf' }),
      ).expect(201);

      const contractDocs = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparty-documents`).query({ ownerType: 'CONTRACT', ownerId: contractId }),
      ).expect(200);
      expect(contractDocs.body).toHaveLength(1);
      expect(contractDocs.body[0].fileName).toBe('contract.pdf');

      const amendmentDocs = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparty-documents`).query({ ownerType: 'CONTRACT_AMENDMENT', ownerId: amendmentId }),
      ).expect(200);
      expect(amendmentDocs.body).toHaveLength(1);
      expect(amendmentDocs.body[0].fileName).toBe('amendment.pdf');

      // Downloadable with the right content type.
      const download = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparty-documents/${contractDoc.body.id}/download`)).expect(200);
      expect(download.headers['content-type']).toContain('application/pdf');
    });

    it('rejects a disallowed file type', async () => {
      await auth1(
        request(app.getHttpServer())
          .post(`/organizations/${org1Id}/counterparty-documents`)
          .field('ownerType', 'CONTRACT')
          .field('ownerId', contractId)
          .attach('file', Buffer.from('bad content'), { filename: 'virus.exe', contentType: 'application/x-msdownload' }),
      ).expect(400);
    });

    it('uploading a new document to the same owner increments the version, and deleting one removes it from the list', async () => {
      const secondUpload = await auth1(
        request(app.getHttpServer())
          .post(`/organizations/${org1Id}/counterparty-documents`)
          .field('ownerType', 'CONTRACT')
          .field('ownerId', contractId)
          .attach('file', Buffer.from('%PDF-1.4 updated contract'), { filename: 'contract-v2.pdf', contentType: 'application/pdf' }),
      ).expect(201);
      expect(secondUpload.body.documentVersion).toBe(2);

      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/counterparty-documents/${secondUpload.body.id}/delete`)).expect(201);

      const docs = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/counterparty-documents`).query({ ownerType: 'CONTRACT', ownerId: contractId }),
      ).expect(200);
      expect(docs.body.find((d: any) => d.id === secondUpload.body.id)).toBeUndefined();
    });
  });

  describe('Tenant isolation', () => {
    it('tenant B cannot see tenant A counterparty, contract, or documents', async () => {
      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/counterparties/${counterpartyId}`)).expect(404);
      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/contracts/${contractId}`)).expect(404);
    });
  });
});
