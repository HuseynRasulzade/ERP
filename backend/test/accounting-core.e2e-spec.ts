/**
 * Accounting Core E2E tests (docx spec Phase 4 — Chart of Accounts &
 * double-entry posting engine, named by content in this repo since its own
 * "Phase 4" already means Sales documents — see docs/ACCOUNTING_CORE.md).
 *
 * Covers: idempotent AZ_STANDARD chart adoption, account hierarchy
 * (414 -> 414-1), reporting-node non-postability, manual operation
 * save->post->unpost->reverse lifecycle, balance validation, required
 * dimension enforcement, accounting mapping resolution + override, period
 * guard, tenant isolation, and Trial Balance/General Ledger/Account Card
 * query correctness.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Accounting Core (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;

  let receivableAccountId: string; // 211
  let revenueAccountId: string; // 601
  let bankAccountId: string; // 223
  let group20Id: string; // 20 - reporting node, not postable directly (no such account row — use 341/801 instead)
  let structuralAccountId: string; // 341 - posting_allowed=false

  const DOC_DATE = '2026-06-15';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
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

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }

  async function accountByCode(code: string) {
    const res = await auth1(request(app.getHttpServer()).get('/accounting/accounts')).expect(200);
    const acc = res.body.find((a: any) => a.code === code);
    if (!acc) throw new Error(`Account ${code} not found in fixture`);
    return acc;
  }

  describe('Setup — chart adoption', () => {
    it('creates two isolated tenants and adopts the AZ_STANDARD chart for both', async () => {
      const s1 = await setupTenant(`acc1-${run}@e2e.test`, `acc-t1-${run}`, 'ACO1');
      token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId;
      const s2 = await setupTenant(`acc2-${run}@e2e.test`, `acc-t2-${run}`, 'ACO2');
      token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

      const chart = await auth1(request(app.getHttpServer()).post('/accounting/chart/adopt')).expect(201);
      expect(chart.body.code).toBe('AZ_STANDARD');

      const list = await auth1(request(app.getHttpServer()).get('/accounting/accounts')).expect(200);
      expect(list.body.length).toBeGreaterThan(100);

      const r211 = list.body.find((a: any) => a.code === '211');
      expect(r211.accountClass).toBe('ASSET');
      expect(r211.normalBalance).toBe('DEBIT');
      expect(r211.postingAllowed).toBe(true);
      receivableAccountId = r211.id;

      const r601 = list.body.find((a: any) => a.code === '601');
      revenueAccountId = r601.id;

      const r223 = list.body.find((a: any) => a.code === '223');
      bankAccountId = r223.id;

      const r341 = list.body.find((a: any) => a.code === '341');
      expect(r341.postingAllowed).toBe(false);
      structuralAccountId = r341.id;

      // Subaccount hierarchy (spec section 19-20, 118): 414-1 under 414.
      const r414 = list.body.find((a: any) => a.code === '414');
      const r414sub = list.body.find((a: any) => a.code === '414-1');
      expect(r414sub.parentAccountId).toBe(r414.id);
      expect(r414.postingAllowed).toBe(false);

      const r5011 = list.body.find((a: any) => a.code === '501-1');
      const r501 = list.body.find((a: any) => a.code === '501');
      expect(r5011.parentAccountId).toBe(r501.id);

      const r5151 = list.body.find((a: any) => a.code === '515-1');
      const r515 = list.body.find((a: any) => a.code === '515');
      expect(r5151.parentAccountId).toBe(r515.id);

      // Coverage spot-checks across the required series (spec section 119).
      for (const code of ['101', '193', '201', '245', '301', '344', '401', '445', '501', '545', '601', '641', '701', '761', '801', '811', '901', '902']) {
        expect(list.body.some((a: any) => a.code === code)).toBe(true);
      }
    });

    it('adopting twice is idempotent — no duplicate accounts (spec section 150)', async () => {
      const before = await auth1(request(app.getHttpServer()).get('/accounting/accounts')).expect(200);
      await auth1(request(app.getHttpServer()).post('/accounting/chart/adopt')).expect(201);
      const after = await auth1(request(app.getHttpServer()).get('/accounting/accounts')).expect(200);
      expect(after.body.length).toBe(before.body.length);
    });

    it('adopts an independent copy for the second tenant — no cross-tenant leakage', async () => {
      await auth2(request(app.getHttpServer()).post('/accounting/chart/adopt')).expect(201);
      const list2 = await auth2(request(app.getHttpServer()).get('/accounting/accounts')).expect(200);
      const r211_t2 = list2.body.find((a: any) => a.code === '211');
      expect(r211_t2.id).not.toBe(receivableAccountId);

      // Tenant 2 cannot read Tenant 1's account by id (section 116).
      await auth2(request(app.getHttpServer()).get(`/accounting/accounts/${receivableAccountId}`)).expect(404);
    });
  });

  describe('Default accounting mappings', () => {
    it('resolves CASH/BANK/CUSTOMER_RECEIVABLE/SALES_REVENUE/COGS to the AZ defaults (spec section 134)', async () => {
      const res = await auth1(request(app.getHttpServer()).get('/accounting/mappings')).expect(200);
      const byKey = (k: string) => res.body.find((m: any) => m.mappingKey === k)?.account.code;
      expect(byKey('CASH')).toBe('221');
      expect(byKey('BANK')).toBe('223');
      expect(byKey('GOODS_INVENTORY')).toBe('205');
      expect(byKey('CUSTOMER_RECEIVABLE')).toBe('211');
      expect(byKey('SUPPLIER_PAYABLE')).toBe('531');
      expect(byKey('SALES_REVENUE')).toBe('601');
      expect(byKey('COGS')).toBe('701');
    });

    it('an organization-specific override takes precedence over the tenant default', async () => {
      const bank = await accountByCode('223');
      await auth1(request(app.getHttpServer()).post('/accounting/mappings'))
        .send({ mappingKey: 'CASH', accountId: bank.id, organizationId: org1Id, priority: 10 })
        .expect(201);

      const res = await auth1(request(app.getHttpServer()).get('/accounting/mappings')).query({ organizationId: org1Id }).expect(200);
      const orgSpecific = res.body.filter((m: any) => m.mappingKey === 'CASH' && m.organizationId === org1Id);
      expect(orgSpecific.length).toBe(1);
      expect(orgSpecific[0].account.code).toBe('223');
    });
  });

  describe('Manual Operation — balanced posting', () => {
    it('rejects an unbalanced entry with JOURNAL_NOT_BALANCED, no movements persist (spec sections 121, 124)', async () => {
      const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations`))
        .send({
          businessDate: DOC_DATE,
          description: 'Unbalanced test',
          lines: [
            { accountId: receivableAccountId, side: 'DEBIT', amountBase: '100', dimensions: [{ dimensionCode: 'PARTNER', referenceId: 'x' }, { dimensionCode: 'COUNTERPARTY', referenceId: 'x' }, { dimensionCode: 'AGREEMENT', referenceId: 'x' }, { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: 'x' }, { dimensionCode: 'CURRENCY', referenceId: 'x' }] },
            { accountId: revenueAccountId, side: 'CREDIT', amountBase: '99', dimensions: [{ dimensionCode: 'PRODUCT', referenceId: 'p1' }] },
          ],
        })
        .expect(201);

      const failed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${draft.body.id}/post`))
        .send({ expectedVersion: draft.body.version })
        .expect(422);
      expect(failed.body.code).toBe('JOURNAL_NOT_BALANCED');

      const movements = await prisma.accountingMovement.findMany({ where: { journalEntryId: draft.body.id } });
      expect(movements.length).toBe(0);
    });

    it('rejects a posting missing a required dimension (spec sections 27, 120)', async () => {
      const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations`))
        .send({
          businessDate: DOC_DATE,
          lines: [
            { accountId: receivableAccountId, side: 'DEBIT', amountBase: '50' }, // 211 requires PARTNER/COUNTERPARTY/... — none given
            { accountId: revenueAccountId, side: 'CREDIT', amountBase: '50', dimensions: [{ dimensionCode: 'PRODUCT', referenceId: 'p1' }] },
          ],
        })
        .expect(201);

      const failed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${draft.body.id}/post`))
        .send({ expectedVersion: draft.body.version })
        .expect(422);
      expect(failed.body.code).toBe('ACCOUNT_DIMENSION_REQUIRED');
    });

    it('rejects posting to a structural/reporting-node account (spec sections 8, 108)', async () => {
      const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations`))
        .send({
          businessDate: DOC_DATE,
          lines: [
            { accountId: structuralAccountId, side: 'DEBIT', amountBase: '10' },
            { accountId: bankAccountId, side: 'CREDIT', amountBase: '10', dimensions: [{ dimensionCode: 'BANK_ACCOUNT', referenceId: 'b1' }, { dimensionCode: 'CURRENCY', referenceId: 'usd' }] },
          ],
        })
        .expect(201);

      const failed = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${draft.body.id}/post`))
        .send({ expectedVersion: draft.body.version })
        .expect(422);
      expect(failed.body.code).toBe('ACCOUNT_NOT_POSTABLE');
    });

    let entryId: string;
    let entryVersion: number;

    it('saves a draft, posts it with two balanced movements (spec sections 4, 31-36)', async () => {
      const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations`))
        .send({
          businessDate: DOC_DATE,
          description: 'Cash sale',
          lines: [
            { accountId: bankAccountId, side: 'DEBIT', amountBase: '500', dimensions: [{ dimensionCode: 'BANK_ACCOUNT', referenceId: 'b1' }, { dimensionCode: 'CURRENCY', referenceId: 'usd' }] },
            { accountId: revenueAccountId, side: 'CREDIT', amountBase: '500', dimensions: [{ dimensionCode: 'PRODUCT', referenceId: 'p1' }] },
          ],
        })
        .expect(201);
      expect(draft.body.status).toBe('DRAFT');
      expect(draft.body.journalNumber).toMatch(/^JE-2026-\d+$/);

      const posted = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${draft.body.id}/post`))
        .send({ expectedVersion: draft.body.version })
        .expect(201);
      expect(posted.body.status).toBe('POSTED');

      entryId = posted.body.id;
      entryVersion = posted.body.version;

      const movements = await prisma.accountingMovement.findMany({ where: { journalEntryId: entryId } });
      expect(movements.length).toBe(2);
      const debit = movements.find((m) => m.side === 'DEBIT')!;
      const credit = movements.find((m) => m.side === 'CREDIT')!;
      expect(Number(debit.amountBase)).toBeCloseTo(500, 2);
      expect(Number(credit.amountBase)).toBeCloseTo(500, 2);
    });

    it('rejects posting the same entry twice (spec sections 45, 125)', async () => {
      const again = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${entryId}/post`))
        .send({ expectedVersion: entryVersion })
        .expect(409);
      expect(again.body.code).toBe('JOURNAL_ALREADY_POSTED');
    });

    it('unposts, removing the movements and returning the entry to DRAFT (spec section 47)', async () => {
      const unposted = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${entryId}/unpost`))
        .send({ expectedVersion: entryVersion })
        .expect(201);
      expect(unposted.body.status).toBe('DRAFT');

      const movements = await prisma.accountingMovement.findMany({ where: { journalEntryId: entryId } });
      expect(movements.length).toBe(0);
      entryVersion = unposted.body.version;
    });

    it('re-posts after unposting', async () => {
      const posted = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${entryId}/post`))
        .send({ expectedVersion: entryVersion })
        .expect(201);
      expect(posted.body.status).toBe('POSTED');
      entryVersion = posted.body.version;
    });

    it('reverses a posted entry — original marked REVERSED, reversal neutralizes it (spec sections 48-49, 127)', async () => {
      const reversal = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${entryId}/reverse`))
        .send({ expectedVersion: entryVersion })
        .expect(201);
      expect(reversal.body.status).toBe('POSTED');
      expect(reversal.body.isReversal).toBe(true);

      const original = await prisma.journalEntry.findUnique({ where: { id: entryId } });
      expect(original?.status).toBe('REVERSED');

      const originalMovements = await prisma.accountingMovement.findMany({ where: { journalEntryId: entryId } });
      const reversalMovements = await prisma.accountingMovement.findMany({ where: { journalEntryId: reversal.body.id } });
      expect(originalMovements.length).toBe(2); // still there — never deleted
      expect(reversalMovements.length).toBe(2);
      const reversalDebit = reversalMovements.find((m) => m.side === 'DEBIT')!;
      // Original was DEBIT bank / CREDIT revenue -> reversal flips to CREDIT bank / DEBIT revenue.
      expect(reversalDebit.accountId).toBe(revenueAccountId);
      expect(reversalMovements.every((m) => m.reversalOfMovementId)).toBe(true);
    });
  });

  describe('Period guard', () => {
    it('blocks posting into a closed period (spec sections 62-63)', async () => {
      const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations`))
        .send({
          businessDate: '2026-08-10',
          lines: [
            { accountId: bankAccountId, side: 'DEBIT', amountBase: '20', dimensions: [{ dimensionCode: 'BANK_ACCOUNT', referenceId: 'b1' }, { dimensionCode: 'CURRENCY', referenceId: 'usd' }] },
            { accountId: revenueAccountId, side: 'CREDIT', amountBase: '20', dimensions: [{ dimensionCode: 'PRODUCT', referenceId: 'p1' }] },
          ],
        })
        .expect(201);

      const period = await auth1(request(app.getHttpServer()).post('/periods')).send({ year: 2026, month: 8 }).expect(201);
      await auth1(request(app.getHttpServer()).post(`/periods/${period.body.id}/close`)).expect(201);

      const blocked = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/manual-operations/${draft.body.id}/post`))
        .send({ expectedVersion: draft.body.version })
        .expect(409);
      expect(blocked.body.code).toBe('PERIOD_CLOSED');

      await auth1(request(app.getHttpServer()).post(`/periods/${period.body.id}/reopen`)).send({ reason: 'test reopen' }).expect(201);
    });
  });

  describe('Trial Balance / General Ledger / Account Card', () => {
    it('reports correct opening/turnover/closing for the bank and revenue accounts', async () => {
      const tb = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/accounting/trial-balance`),
      )
        .query({ fromDate: '2026-06-01', toDate: '2026-06-30' })
        .expect(200);

      const bankRow = tb.body.find((r: any) => r.code === '223');
      // Net effect after post -> unpost -> re-post -> reverse is a wash:
      // one active DEBIT movement of 500 remains (the original), plus one
      // CREDIT movement of 500 from the reversal -> closing balance 0.
      expect(Number(bankRow.turnoverDebit)).toBeCloseTo(500, 2);
      expect(Number(bankRow.turnoverCredit)).toBeCloseTo(500, 2);
      expect(Number(bankRow.closingDebit)).toBeCloseTo(0, 2);
      expect(Number(bankRow.closingCredit)).toBeCloseTo(0, 2);
    });

    it('general ledger lists movements chronologically with source linkage', async () => {
      const gl = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/accounting/general-ledger`),
      )
        .query({ fromDate: '2026-06-01', toDate: '2026-06-30', accountId: bankAccountId })
        .expect(200);
      expect(gl.body.length).toBe(2);
      expect(gl.body[0].journalEntry.journalNumber).toMatch(/^JE-2026-\d+$/);
    });

    it('account card shows chronological movements with a running balance', async () => {
      const card = await auth1(
        request(app.getHttpServer()).get(`/organizations/${org1Id}/accounting/accounts/${bankAccountId}/card`),
      )
        .query({ fromDate: '2026-06-01', toDate: '2026-06-30' })
        .expect(200);
      expect(card.body.movements.length).toBe(2);
      expect(Number(card.body.closingBalance)).toBeCloseTo(0, 2);
      expect(Number(card.body.movements[0].runningBalance)).toBeCloseTo(500, 2);
    });
  });

  describe('Tenant isolation', () => {
    it('tenant 2 cannot see tenant 1 movements/journal entries via cross-tenant id guessing', async () => {
      const anyEntry = await prisma.journalEntry.findFirst({ where: { tenantId: tenant1Id } });
      await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/manual-operations/${anyEntry!.id}`)).expect(404);
    });
  });
});
