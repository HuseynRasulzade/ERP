/**
 * Verification-audit fixes for Phases 0-5 (spec numbering: foundation,
 * organization structure, nomenclature, counterparties, Accounting Core,
 * Tax Engine) — see docs/AUDIT_PHASES_00_05.md for the full checklist.
 *
 * Every test here pins down an invariant the audit found missing or only
 * partially enforced:
 *   - organization-scoped access on the GENERIC document command surface
 *     (post/unpost/cancel/create-based-on) and on manual operations;
 *   - manual-operation commands cannot touch system-generated or foreign
 *     organizations' Journal Entries, and a reversal cannot be unposted;
 *   - accounting dimension reference integrity (tenant/organization/type),
 *     one value per dimension, currency/quantity analytics rules;
 *   - concurrent duplicate posting of one source yields exactly one entry;
 *   - period close is serialized against in-flight postings, period
 *     creation is permission-gated and tenant-safe;
 *   - Trial Balance opening/closing are balances (net) and parent accounts
 *     roll up their subaccounts; foreign account ids are NOT_FOUND;
 *   - tax: a rule never applies outside its legal source's validity, a
 *     rate-bearing rule without an in-force rate is TAX_RATE_NOT_FOUND
 *     (never a silent 0%), recoverable percentage is bounded;
 *   - RBAC: role changes take effect immediately (deny -> grant).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountingPostingEngine } from '../src/accounting-core/accounting-posting-engine.service';
import { PeriodService } from '../src/period/period.service';
import { NumberingService } from '../src/numbering/numbering.service';
import { FOUNDATION_TEST_DOCUMENT_TYPE } from '../src/foundation-test-document/foundation-test-document.repository';

describe('Audit fixes — Phases 0-5 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: AccountingPostingEngine;
  let periods: PeriodService;
  const run = Date.now();

  // Tenant 1: admin (full access to org A and org B) + a member limited to org A.
  let adminToken: string;
  let adminUserId: string;
  let tenant1Id: string;
  let orgAId: string;
  let orgBId: string;
  let memberToken: string;
  // Tenant 2: a completely separate tenant.
  let token2: string;
  let tenant2Id: string;
  let org2Id: string;

  let acc: Record<string, string> = {};
  let usdId: string;
  let cpA: string; // counterparty in org A
  let cpB: string; // counterparty in org B
  let cp2: string; // counterparty in tenant 2
  let warehouseA: string;
  let bankA: string;

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-Id', tenant1Id);
  const asMember = (r: request.Test) => r.set('Authorization', `Bearer ${memberToken}`).set('X-Tenant-Id', tenant1Id);
  const as2 = (r: request.Test) => r.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);

  async function register(tag: string) {
    const res = await request(server())
      .post('/auth/register')
      .send({ email: `audit-${tag}-${run}@e2e.test`, password: 'Passw0rd!23', displayName: `Audit ${tag}` })
      .expect(201);
    return { token: res.body.accessToken as string, userId: res.body.userId as string };
  }

  /** Adds a user to a tenant with the given roles and organization grants
   * (there is no invite endpoint yet, so the membership row is created the
   * same way other suites do it — directly). */
  async function addMember(tenantId: string, tag: string, roleIds: string[], orgIds: string[]) {
    const user = await register(tag);
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: user.userId } });
    for (const roleId of roleIds) await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId } });
    for (const organizationId of orgIds) {
      await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId } });
    }
    return { token: user.token, membershipId: membership.id };
  }

  async function createOrg(auth: (r: request.Test) => request.Test, code: string) {
    const res = await auth(request(server()).post('/organizations')).send({ code, name: `${code} Org` }).expect(201);
    return res.body.id as string;
  }

  async function newCounterparty(tenantId: string, organizationId: string, code: string) {
    const cp = await prisma.counterparty.create({
      data: { tenantId, organizationId, counterpartyType: 'BOTH', code: `${code}-${run}`, name: code },
    });
    return cp.id;
  }

  /** Balanced other-income/other-expense pair — neither account carries
   * default dimension rules, so these isolate the rule under test. */
  function plainLines(amount: string) {
    return [
      { accountId: acc['731'], side: 'DEBIT' as const, amountBase: amount },
      { accountId: acc['611'], side: 'CREDIT' as const, amountBase: amount },
    ];
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0); // one bound server for the whole suite (see phase0 spec)
    prisma = app.get(PrismaService);
    engine = app.get(AccountingPostingEngine);
    periods = app.get(PeriodService);

    const admin = await register('admin');
    adminToken = admin.token;
    adminUserId = admin.userId;
    const t1 = await request(server())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: `audit-t1-${run}`, name: 'Audit T1', baseCurrencyCode: 'USD' })
      .expect(201);
    tenant1Id = t1.body.id;
    orgAId = await createOrg(asAdmin, `AUDA${run % 100000}`);
    orgBId = await createOrg(asAdmin, `AUDB${run % 100000}`);

    const t2user = await register('t2');
    token2 = t2user.token;
    const t2 = await request(server())
      .post('/tenants')
      .set('Authorization', `Bearer ${token2}`)
      .send({ code: `audit-t2-${run}`, name: 'Audit T2', baseCurrencyCode: 'USD' })
      .expect(201);
    tenant2Id = t2.body.id;
    org2Id = await createOrg(as2, `AUD2${run % 100000}`);

    // Member of tenant 1 holding every permission (TENANT_ADMIN role) but
    // granted ONLY organization A — permission codes are not org access.
    const adminRole = await prisma.role.findFirstOrThrow({ where: { code: 'TENANT_ADMIN', tenantId: null } });
    const member = await addMember(tenant1Id, 'member', [adminRole.id], [orgAId]);
    memberToken = member.token;

    await asAdmin(request(server()).post('/accounting/chart/adopt')).expect(201);
    await as2(request(server()).post('/accounting/chart/adopt')).expect(201);
    await asAdmin(request(server()).post('/tax/localization/seed')).expect(201);
    const accounts = await asAdmin(request(server()).get('/accounting/accounts')).expect(200);
    acc = Object.fromEntries(accounts.body.map((a: any) => [a.code, a.id]));

    usdId = (await prisma.currency.findFirstOrThrow({ where: { code: 'USD' } })).id;
    cpA = await newCounterparty(tenant1Id, orgAId, 'CPA');
    cpB = await newCounterparty(tenant1Id, orgBId, 'CPB');
    cp2 = await newCounterparty(tenant2Id, org2Id, 'CP2');
    warehouseA = (await asAdmin(request(server()).post(`/organizations/${orgAId}/warehouses`)).send({ code: 'WHA', name: 'WH A' }).expect(201)).body.id;
    bankA = (
      await prisma.bankAccount.create({
        data: { tenantId: tenant1Id, organizationId: orgAId, bankName: 'Audit Bank', accountName: 'Main', iban: 'AZ21NABZ00000000137010001944', currencyId: usdId },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  describe('Generic document commands respect organization access (Phase 1 s.22 / Phase 0 s.61)', () => {
    let docB: any;

    beforeAll(async () => {
      docB = (
        await asAdmin(request(server()).post('/foundation-test-documents'))
          .send({ organizationId: orgBId, documentDate: '2026-02-10', amount: '12.00' })
          .expect(201)
      ).body;
    });

    it('a member without a grant for the document organization cannot post, cancel or derive from it (NOT_FOUND)', async () => {
      const post = await asMember(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${docB.id}/post`))
        .send({ expectedVersion: docB.version })
        .expect(404);
      expect(post.body.code).toBe('NOT_FOUND');

      await asMember(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${docB.id}/cancel`))
        .send({ expectedVersion: docB.version })
        .expect(404);

      await asMember(
        request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${docB.id}/create-based-on/${FOUNDATION_TEST_DOCUMENT_TYPE}`),
      )
        .send({})
        .expect(404);

      const movements = await prisma.registerMovement.count({ where: { recorderDocumentId: docB.id } });
      expect(movements).toBe(0);
      const stillDraft = await prisma.foundationTestDocument.findUniqueOrThrow({ where: { id: docB.id } });
      expect(stillDraft.postingStatus).toBe('NOT_POSTED');
      expect(stillDraft.status).not.toBe('CANCELLED');
    });

    it('a user with the grant can post and unpost the same document', async () => {
      const posted = await asAdmin(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${docB.id}/post`))
        .send({ expectedVersion: docB.version })
        .expect(201);
      expect(posted.body.postingStatus).toBe('POSTED');

      // ... and the restricted member cannot unpost it either.
      await asMember(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${docB.id}/unpost`))
        .send({ expectedVersion: posted.body.version })
        .expect(404);

      await asAdmin(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${docB.id}/unpost`))
        .send({ expectedVersion: posted.body.version })
        .expect(201);
    });

    it('a cancelled document cannot be cancelled again, and an unknown document type is NOT_FOUND (not a 500)', async () => {
      const doc = (
        await asAdmin(request(server()).post('/foundation-test-documents'))
          .send({ organizationId: orgAId, documentDate: '2026-02-10', amount: '3.00' })
          .expect(201)
      ).body;
      const cancelled = await asAdmin(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${doc.id}/cancel`))
        .send({ expectedVersion: doc.version })
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');

      const again = await asAdmin(request(server()).post(`/documents/${FOUNDATION_TEST_DOCUMENT_TYPE}/${doc.id}/cancel`))
        .send({ expectedVersion: cancelled.body.version })
        .expect(400);
      expect(again.body.code).toBe('VALIDATION_ERROR');

      const unknown = await asAdmin(request(server()).post(`/documents/NO_SUCH_TYPE_${run}/${doc.id}/post`))
        .send({ expectedVersion: 1 })
        .expect(404);
      expect(unknown.body.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Manual operations cannot reach other organizations or system-generated entries (Phase 4 s.86/117)', () => {
    it("a member of org A cannot post org B's manual operation through org A's URL", async () => {
      const draftB = (
        await asAdmin(request(server()).post(`/organizations/${orgBId}/manual-operations`))
          .send({ businessDate: '2026-02-11', lines: plainLines('10') })
          .expect(201)
      ).body;

      await asMember(request(server()).post(`/organizations/${orgAId}/manual-operations/${draftB.id}/post`))
        .send({ expectedVersion: draftB.version })
        .expect(404);
      const still = await prisma.journalEntry.findUniqueOrThrow({ where: { id: draftB.id } });
      expect(still.status).toBe('DRAFT');
    });

    it('a Journal Entry generated by a source document cannot be unposted or reversed as a manual operation', async () => {
      const systemEntry = await engine.postBatch(tenant1Id, adminUserId, {
        organizationId: orgAId,
        businessDate: new Date('2026-02-12T00:00:00.000Z'),
        sourceDocumentType: 'AUDIT_SOURCE',
        sourceDocumentId: `sys-${run}`,
        lines: plainLines('25'),
      });

      await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations/${systemEntry!.id}/reverse`))
        .send({ expectedVersion: systemEntry!.version })
        .expect(404);
      await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations/${systemEntry!.id}/unpost`))
        .send({ expectedVersion: systemEntry!.version })
        .expect(404);

      const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: systemEntry!.id } });
      expect(after.status).toBe('POSTED');
      expect(await prisma.accountingMovement.count({ where: { journalEntryId: systemEntry!.id } })).toBe(2);
    });

    it('a reversal entry cannot be unposted (it would resurrect the REVERSED original)', async () => {
      const draft = (
        await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations`))
          .send({ businessDate: '2026-02-13', lines: plainLines('40') })
          .expect(201)
      ).body;
      const posted = (
        await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations/${draft.id}/post`))
          .send({ expectedVersion: draft.version })
          .expect(201)
      ).body;
      const reversal = (
        await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations/${posted.id}/reverse`))
          .send({ expectedVersion: posted.version })
          .expect(201)
      ).body;

      const res = await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations/${reversal.id}/unpost`))
        .send({ expectedVersion: reversal.version })
        .expect(409);
      expect(res.body.code).toBe('REVERSAL_NOT_ALLOWED');
      expect(await prisma.accountingMovement.count({ where: { journalEntryId: reversal.id } })).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Dimension reference integrity and analytics rules (Phase 4 s.30, 33, 58, 61, 120)', () => {
    /** Save a manual-operation draft, then post it, asserting the POST status. */
    function postManual(lines: any[], businessDate = '2026-02-14') {
      return {
        expect: async (status: number) => {
          const draft = (
            await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations`)).send({ businessDate, lines }).expect(201)
          ).body;
          return asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations/${draft.id}/post`))
            .send({ expectedVersion: draft.version })
            .expect(status);
        },
      };
    }
    const receivable = (counterpartyId: string, amount = '10') => ({
      accountId: acc['211'],
      side: 'DEBIT',
      amountBase: amount,
      dimensions: [
        { dimensionCode: 'PARTNER', referenceId: counterpartyId },
        { dimensionCode: 'COUNTERPARTY', referenceId: counterpartyId },
        { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: `inv-${run}` },
        { dimensionCode: 'CURRENCY', referenceId: usdId },
      ],
    });
    const otherIncome = (amount = '10') => ({ accountId: acc['611'], side: 'CREDIT', amountBase: amount });

    it('accepts real, same-organization dimension values', async () => {
      const res = await postManual([receivable(cpA), otherIncome()]).expect(201);
      expect(res.body.status).toBe('POSTED');
      const dims = await prisma.accountingMovementDimension.findMany({ where: { movement: { journalEntryId: res.body.id } } });
      expect(dims.some((d) => d.referenceId === cpA)).toBe(true);
    });

    it('rejects a value from another tenant', async () => {
      const res = await postManual([receivable(cp2), otherIncome()]).expect(422);
      expect(res.body.code).toBe('ACCOUNT_DIMENSION_VALUE_INVALID');
    });

    it('rejects a value from another organization of the same tenant', async () => {
      const res = await postManual([receivable(cpB), otherIncome()]).expect(422);
      expect(res.body.code).toBe('ACCOUNT_DIMENSION_VALUE_INVALID');
    });

    it('rejects a value of the wrong entity type (WAREHOUSE given a counterparty id)', async () => {
      const res = await postManual([
        {
          accountId: acc['205'],
          side: 'DEBIT',
          amountBase: '10',
          dimensions: [
            { dimensionCode: 'PRODUCT', referenceId: cpA },
            { dimensionCode: 'WAREHOUSE', referenceId: cpA },
          ],
        },
        otherIncome(),
      ]).expect(422);
      expect(res.body.code).toBe('ACCOUNT_DIMENSION_VALUE_INVALID');
    });

    it('rejects the same dimension twice on one line', async () => {
      const line = receivable(cpA);
      line.dimensions.push({ dimensionCode: 'CURRENCY', referenceId: usdId });
      const res = await asAdmin(request(server()).post(`/organizations/${orgAId}/manual-operations`))
        .send({ businessDate: '2026-02-14', lines: [line, otherIncome()] })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a quantity on an account without quantity tracking', async () => {
      const res = await postManual([{ ...plainLines('10')[0], quantity: '2' }, plainLines('10')[1]]).expect(422);
      expect(res.body.code).toBe('QUANTITY_NOT_ALLOWED');
    });

    it('rejects a foreign-currency amount on an account without currency tracking, and a foreign amount without a currency', async () => {
      const notTracked = await postManual([
        { ...plainLines('170')[0], transactionCurrencyId: usdId, amountTransaction: '100', exchangeRate: '1.7' },
        plainLines('170')[1],
      ]).expect(422);
      expect(notTracked.body.code).toBe('CURRENCY_NOT_ALLOWED');

      const noCurrency = await postManual([
        { accountId: acc['501-1'], side: 'CREDIT', amountBase: '170', amountTransaction: '100', exchangeRate: '1.7' },
        { accountId: acc['731'], side: 'DEBIT', amountBase: '170' },
      ]).expect(422);
      expect(noCurrency.body.code).toBe('CURRENCY_REQUIRED');
    });

    it('retains transaction amount, rate and base amount on a currency-tracking account (s.129)', async () => {
      const res = await postManual([
        {
          accountId: acc['223'],
          side: 'DEBIT',
          amountBase: '170',
          transactionCurrencyId: usdId,
          amountTransaction: '100',
          exchangeRate: '1.7',
          dimensions: [
            { dimensionCode: 'BANK_ACCOUNT', referenceId: bankA },
            { dimensionCode: 'CURRENCY', referenceId: usdId },
          ],
        },
        otherIncome('170'),
      ]).expect(201);
      const movement = await prisma.accountingMovement.findFirstOrThrow({ where: { journalEntryId: res.body.id, side: 'DEBIT' } });
      expect(Number(movement.amountBase)).toBeCloseTo(170, 4);
      expect(Number(movement.amountTransaction)).toBeCloseTo(100, 4);
      expect(Number(movement.exchangeRate)).toBeCloseTo(1.7, 6);
      expect(movement.transactionCurrencyId).toBe(usdId);
    });

    it('the WAREHOUSE of the right organization is accepted', async () => {
      const product = await prisma.product.create({
        data: {
          tenantId: tenant1Id,
          organizationId: orgAId,
          code: `AUD-P-${run}`,
          name: 'Audit product',
          baseUnitId: (await prisma.unitOfMeasure.create({ data: { tenantId: tenant1Id, code: `AUDU${run}`, name: 'unit' } })).id,
        },
      });
      await postManual([
        {
          accountId: acc['205'],
          side: 'DEBIT',
          amountBase: '10',
          quantity: '2',
          dimensions: [
            { dimensionCode: 'PRODUCT', referenceId: product.id },
            { dimensionCode: 'WAREHOUSE', referenceId: warehouseA },
          ],
        },
        otherIncome(),
      ]).expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Duplicate posting of one source under concurrency (Phase 4 s.45, 133; Phase 5 s.68)', () => {
    it('two simultaneous postBatch calls for the same source produce exactly one active entry', async () => {
      const source = { sourceDocumentType: 'AUDIT_RACE', sourceDocumentId: `race-${run}` };
      const attempt = () =>
        engine.postBatch(tenant1Id, adminUserId, {
          organizationId: orgAId,
          businessDate: new Date('2026-02-15T00:00:00.000Z'),
          ...source,
          lines: plainLines('5'),
        });
      const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      rejected.forEach((r) => expect(r.reason.code).toBe('POSTING_DUPLICATE'));

      const entries = await prisma.journalEntry.findMany({ where: { tenantId: tenant1Id, ...source } });
      expect(entries).toHaveLength(1);
      expect(await prisma.accountingMovement.count({ where: { tenantId: tenant1Id, ...source } })).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Period guard hardening (Phase 0 s.20-22, 35, 61)', () => {
    it('closing a period waits for an in-flight posting that already passed the guard; later postings see CLOSED', async () => {
      const period = (await asAdmin(request(server()).post('/periods')).send({ year: 2025, month: 10, organizationId: orgAId }).expect(201))
        .body;
      const date = new Date('2025-10-15T00:00:00.000Z');

      let closed = false;
      let closePromise!: Promise<unknown>;
      await prisma.runInTransaction(async (tx) => {
        await periods.assertDateIsOpen(tenant1Id, date, orgAId, tx); // FOR SHARE on the period row
        closePromise = periods.close(tenant1Id, period.id, adminUserId).then((r) => {
          closed = true;
          return r;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        // The close is blocked behind this transaction's share lock.
        expect(closed).toBe(false);
      });
      await closePromise;
      expect(closed).toBe(true);

      await expect(
        engine.postBatch(tenant1Id, adminUserId, { organizationId: orgAId, businessDate: date, lines: plainLines('1') }),
      ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });

      const audit = await prisma.auditEvent.findMany({ where: { tenantId: tenant1Id, entityId: period.id, eventType: 'PERIOD_CLOSED' } });
      expect(audit).toHaveLength(1);
      await asAdmin(request(server()).post(`/periods/${period.id}/reopen`)).send({ reason: 'audit test' }).expect(201);
    });

    it("a period cannot be created for another tenant's organization", async () => {
      await asAdmin(request(server()).post('/periods')).send({ year: 2025, month: 11, organizationId: org2Id }).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Trial Balance correctness (Phase 4 s.68-69, 116, 130)', () => {
    let tbOrg: string;

    beforeAll(async () => {
      // A dedicated organization keeps the figures independent of other tests.
      tbOrg = await createOrg(asAdmin, `AUDTB${run % 100000}`);
      const post = async (businessDate: string, lines: any[]) => {
        await engine.postBatch(tenant1Id, adminUserId, { organizationId: tbOrg, businessDate: new Date(`${businessDate}T00:00:00.000Z`), lines });
      };
      // Before the report window: 731 gets Dr 100 and Cr 30 -> opening balance Dr 70.
      await post('2025-05-05', plainLines('100'));
      await post('2025-05-06', [
        { accountId: acc['611'], side: 'DEBIT', amountBase: '30' },
        { accountId: acc['731'], side: 'CREDIT', amountBase: '30' },
      ]);
      // Inside the window: overdraft subaccount 501-1 credited 50.
      await post('2025-06-10', [
        { accountId: acc['731'], side: 'DEBIT', amountBase: '50' },
        { accountId: acc['501-1'], side: 'CREDIT', amountBase: '50' },
      ]);
    });

    it('opening and closing are net balances, not gross historical turnovers', async () => {
      const tb = await asAdmin(request(server()).get(`/organizations/${tbOrg}/accounting/trial-balance`))
        .query({ fromDate: '2025-06-01', toDate: '2025-06-30' })
        .expect(200);
      const row731 = tb.body.find((r: any) => r.code === '731');
      expect(row731.openingDebit).toBe('70.00');
      expect(row731.openingCredit).toBe('0.00');
      expect(row731.turnoverDebit).toBe('50.00');
      expect(row731.closingDebit).toBe('120.00');
      const row611 = tb.body.find((r: any) => r.code === '611');
      expect(row611.openingCredit).toBe('70.00');
      expect(row611.openingDebit).toBe('0.00');
    });

    it('a parent account rolls up its subaccounts (501 over 501-1)', async () => {
      const tb = await asAdmin(request(server()).get(`/organizations/${tbOrg}/accounting/trial-balance`))
        .query({ fromDate: '2025-06-01', toDate: '2025-06-30' })
        .expect(200);
      const parent = tb.body.find((r: any) => r.code === '501');
      const child = tb.body.find((r: any) => r.code === '501-1');
      expect(child.turnoverCredit).toBe('50.00');
      expect(parent.turnoverCredit).toBe('50.00');
      expect(parent.closingCredit).toBe('50.00');
      expect(parent.isGroup).toBe(true);
      expect(child.parentAccountId).toBe(parent.accountId);

      // Filtering by the parent returns the subtree with the same rollup.
      const filtered = await asAdmin(request(server()).get(`/organizations/${tbOrg}/accounting/trial-balance`))
        .query({ fromDate: '2025-06-01', toDate: '2025-06-30', accountId: parent.accountId })
        .expect(200);
      expect(filtered.body.map((r: any) => r.code).sort()).toEqual(['501', '501-1']);
    });

    it("another tenant's account id is NOT_FOUND, never echoed back", async () => {
      const foreign = await prisma.account.findFirstOrThrow({ where: { tenantId: tenant2Id, code: '731' } });
      await asAdmin(request(server()).get(`/organizations/${tbOrg}/accounting/trial-balance`))
        .query({ fromDate: '2025-06-01', toDate: '2025-06-30', accountId: foreign.id })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Opening balances (Phase 4 s.53-55, 132)', () => {
    let obOrg: string;
    beforeAll(async () => {
      obOrg = await createOrg(asAdmin, `AUDOB${run % 100000}`);
    });

    it('rejects an unbalanced opening balance — no hidden balancing line is invented', async () => {
      const res = await asAdmin(request(server()).post(`/organizations/${obOrg}/opening-balances`))
        .send({
          businessDate: '2025-01-01',
          lines: [
            { accountId: acc['731'], side: 'DEBIT', amountBase: '100' },
            { accountId: acc['343'], side: 'CREDIT', amountBase: '90' },
          ],
        })
        .expect(422);
      expect(res.body.code).toBe('JOURNAL_NOT_BALANCED');
      expect(await prisma.journalEntry.count({ where: { organizationId: obOrg } })).toBe(0);
    });

    it('posts a balanced, flagged opening entry that the Trial Balance shows as opening balance', async () => {
      const res = await asAdmin(request(server()).post(`/organizations/${obOrg}/opening-balances`))
        .send({
          businessDate: '2025-01-01',
          description: 'Migration opening balances',
          lines: [
            { accountId: acc['731'], side: 'DEBIT', amountBase: '100' },
            { accountId: acc['343'], side: 'CREDIT', amountBase: '100' },
          ],
        })
        .expect(201);
      expect(res.body.status).toBe('POSTED');
      expect(res.body.isOpeningBalance).toBe(true);
      expect(res.body.operationType).toBe('OPENING_BALANCE');
      expect(res.body.generatedBy).toBe('OPENING_BALANCE');

      const list = await asAdmin(request(server()).get(`/organizations/${obOrg}/opening-balances`)).expect(200);
      expect(list.body.map((e: any) => e.id)).toContain(res.body.id);

      const tb = await asAdmin(request(server()).get(`/organizations/${obOrg}/accounting/trial-balance`))
        .query({ fromDate: '2025-01-02', toDate: '2025-01-31' })
        .expect(200);
      expect(tb.body.find((r: any) => r.code === '731').openingDebit).toBe('100.00');
      expect(tb.body.find((r: any) => r.code === '343').openingCredit).toBe('100.00');

      const audit = await prisma.auditEvent.findMany({ where: { entityId: res.body.id, eventType: 'OPENING_BALANCE_POSTED' } });
      expect(audit).toHaveLength(1);

      // Corrections are explicit reversals; the member without org access cannot even see it.
      await asMember(request(server()).post(`/organizations/${obOrg}/opening-balances/${res.body.id}/reverse`))
        .send({ expectedVersion: res.body.version })
        .expect(404);
      const reversal = await asAdmin(request(server()).post(`/organizations/${obOrg}/opening-balances/${res.body.id}/reverse`))
        .send({ expectedVersion: res.body.version })
        .expect(201);
      expect(reversal.body.isReversal).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Tax determinism hardening (Phase 5 s.1, 11, 14, 114, 122, 133)', () => {
    let vatTypeId: string;
    let standardRateId: string;

    const calc = (category: string, taxPointDate: string, extra: Record<string, unknown> = {}) =>
      asAdmin(request(server()).post(`/organizations/${orgAId}/tax/calculate`)).send({
        operationType: 'SALE',
        taxCategoryCode: category,
        taxpayerSide: 'SELLER',
        amount: '100',
        priceIncludesTax: false,
        taxPointDate,
        ...extra,
      });

    beforeAll(async () => {
      vatTypeId = (await prisma.taxType.findUniqueOrThrow({ where: { code: 'VAT' } })).id;
      standardRateId = (await prisma.taxRate.findFirstOrThrow({ where: { code: 'AZ_VAT_STANDARD' } })).id;
    });

    it('a rule citing a REPEALED legal source applies only up to the source end date', async () => {
      const category = `AUD_LS_${run}`;
      const source = await prisma.taxLegalSource.create({
        data: {
          sourceType: 'AMENDING_LAW',
          title: `Audit repealed provision ${run}`,
          sourceUrl: 'https://e-qanun.az/framework/46948',
          status: 'REPEALED',
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-06-30T00:00:00.000Z'),
        },
      });
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatTypeId, code: `AUD_LS_RULE_${run}`, name: 'Repealed-source rule',
          ruleCategory: 'STANDARD', effectiveFrom: new Date('2020-01-01T00:00:00.000Z'), status: 'ACTIVE', priority: 10,
          treatment: 'STANDARD_RATE', conditionTaxCategoryCode: category, rateId: standardRateId, legalSourceId: source.id, systemDefined: false,
        },
      });

      const before = await calc(category, '2026-06-30').expect(201);
      expect(Number(before.body.taxAmount)).toBeCloseTo(18, 2);

      const after = await calc(category, '2026-07-01').expect(422);
      expect(after.body.code).toBe('TAX_RULE_NOT_FOUND');
    });

    it('a rate-bearing rule whose rate is not yet in force is TAX_RATE_NOT_FOUND, never 0%', async () => {
      const category = `AUD_RATE_${run}`;
      const futureRate = await prisma.taxRate.create({
        data: {
          taxTypeId: vatTypeId, jurisdiction: 'AZ', code: `AUD_FUTURE_${run}`, rate: '20.0000', rateType: 'STANDARD',
          effectiveFrom: new Date('2027-01-01T00:00:00.000Z'), status: 'FUTURE_EFFECTIVE', systemDefined: false,
        },
      });
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatTypeId, code: `AUD_RATE_RULE_${run}`, name: 'Rule ahead of its rate',
          ruleCategory: 'STANDARD', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE', priority: 10,
          treatment: 'STANDARD_RATE', conditionTaxCategoryCode: category, rateId: futureRate.id, systemDefined: false,
        },
      });
      const res = await calc(category, '2026-06-15').expect(422);
      expect(res.body.code).toBe('TAX_RATE_NOT_FOUND');
      const later = await calc(category, '2027-02-01').expect(201);
      expect(Number(later.body.taxAmount)).toBeCloseTo(20, 2);
    });

    it('a STANDARD_RATE rule with no rate configured is TAX_RATE_NOT_FOUND', async () => {
      const category = `AUD_NORATE_${run}`;
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatTypeId, code: `AUD_NORATE_RULE_${run}`, name: 'No rate',
          ruleCategory: 'STANDARD', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE', priority: 10,
          treatment: 'STANDARD_RATE', conditionTaxCategoryCode: category, systemDefined: false,
        },
      });
      const res = await calc(category, '2026-06-15').expect(422);
      expect(res.body.code).toBe('TAX_RATE_NOT_FOUND');
    });

    it('recoverable percentage outside 0..100 is rejected', async () => {
      const res = await calc('STANDARD_VAT', '2026-06-15', { operationType: 'PURCHASE', taxpayerSide: 'BUYER', recoverablePercent: '150' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Organization access management is tenant-scoped and never leaks credentials (Phase 0 s.24/39, Phase 1 s.22/33)', () => {
    it('member and grant listings never contain password hashes', async () => {
      const members = await asAdmin(request(server()).get('/tenants/members')).expect(200);
      expect(members.body.length).toBeGreaterThan(0);
      expect(JSON.stringify(members.body)).not.toContain('passwordHash');
      expect(members.body[0].user.email).toBeDefined();

      const grants = await asAdmin(request(server()).get(`/organizations/${orgAId}/access`)).expect(200);
      expect(grants.body.length).toBeGreaterThan(0);
      expect(JSON.stringify(grants.body)).not.toContain('passwordHash');
      expect(grants.body[0].membership.user.email).toBeDefined();
    });

    it("another tenant's organization access list is NOT_FOUND", async () => {
      await as2(request(server()).get(`/organizations/${orgAId}/access`)).expect(404);
    });

    it('grants and revocations cannot cross tenants', async () => {
      const t2Membership = await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId: tenant2Id } });
      const t1Membership = await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId: tenant1Id, userId: adminUserId } });

      // A foreign membership cannot be granted into this tenant's organization ...
      await asAdmin(request(server()).post(`/organizations/${orgAId}/access`)).send({ membershipId: t2Membership.id }).expect(404);
      // ... and this tenant cannot grant/revoke on a foreign organization.
      await asAdmin(request(server()).post(`/organizations/${org2Id}/access`)).send({ membershipId: t1Membership.id }).expect(404);
      await asAdmin(request(server()).post(`/organizations/${org2Id}/access/${t2Membership.id}/revoke`)).expect(404);

      expect(await prisma.organizationAccess.count({ where: { tenantMembershipId: t2Membership.id, organizationId: orgAId } })).toBe(0);
      expect(await prisma.organizationAccess.count({ where: { tenantMembershipId: t1Membership.id, organizationId: org2Id } })).toBe(0);
      expect(await prisma.organizationAccess.count({ where: { tenantMembershipId: t2Membership.id, organizationId: org2Id } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Effective-dated configuration cannot overlap, even under concurrency (Phase 1 s.29-30)', () => {
    it('concurrent overlapping accounting-policy versions: exactly one wins, the rest are CONFLICT', async () => {
      const org = await createOrg(asAdmin, `AUDAP${run % 100000}`);
      const attempts = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          asAdmin(request(server()).post(`/organizations/${org}/accounting-policies`)).send({
            code: `AP-RACE-${i}`,
            name: `Race ${i}`,
            validFrom: `2026-0${i + 1}-01`,
          }),
        ),
      );
      const statuses = attempts.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(3);
      attempts.filter((r) => r.status === 409).forEach((r) => expect(r.body.code).toBe('CONFLICT'));
      expect(await prisma.accountingPolicy.count({ where: { organizationId: org, active: true } })).toBe(1);
    });

    it('concurrent overlapping tax-profile versions: exactly one wins', async () => {
      const org = await createOrg(asAdmin, `AUDTP${run % 100000}`);
      const attempts = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          asAdmin(request(server()).post(`/organizations/${org}/tax-profiles`)).send({
            code: `TP-RACE-${i}`,
            name: `Race ${i}`,
            countryCode: 'AZ',
            validFrom: `2026-0${i + 1}-01`,
          }),
        ),
      );
      expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await prisma.taxProfile.count({ where: { organizationId: org, active: true } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Database-level immutability of audit / posted registers (Phase 0 s.24, Phase 4 s.36, Phase 5 s.66)', () => {
    it('audit events cannot be updated or deleted, even bypassing the API', async () => {
      const event = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: tenant1Id } });
      await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { reason: 'tampered' } })).rejects.toBeTruthy();
      await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toBeTruthy();
      const still = await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(still.reason).toBe(event.reason);
    });

    it('a posted accounting movement cannot be edited in place', async () => {
      const movement = await prisma.accountingMovement.findFirstOrThrow({ where: { tenantId: tenant1Id } });
      await expect(
        prisma.accountingMovement.update({ where: { id: movement.id }, data: { amountBase: '999999' } }),
      ).rejects.toBeTruthy();
      const still = await prisma.accountingMovement.findUniqueOrThrow({ where: { id: movement.id } });
      expect(still.amountBase.toString()).toBe(movement.amountBase.toString());
    });

    it('a tax movement cannot be edited; only its journal-entry link can be back-filled once', async () => {
      const vatRuleId = (await prisma.taxRule.findFirstOrThrow({ where: { code: 'AZ_VAT_STANDARD_RULE' } })).id;
      const movement = await prisma.taxMovement.create({
        data: {
          tenantId: tenant1Id, organizationId: orgAId, taxType: 'VAT', taxTreatment: 'STANDARD_RATE',
          sourceDocumentType: 'AUDIT_TAX', sourceDocumentId: `tax-${run}`, taxPointDate: new Date('2026-02-20T00:00:00.000Z'),
          reportingPeriod: '2026-02', taxableBase: '100', taxAmount: '18', direction: 'OUTPUT', taxRuleId: vatRuleId,
        },
      });
      await expect(prisma.taxMovement.update({ where: { id: movement.id }, data: { taxAmount: '1' } })).rejects.toBeTruthy();

      const entry = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId: tenant1Id, status: 'POSTED' } });
      await prisma.taxMovement.update({ where: { id: movement.id }, data: { journalEntryId: entry.id } });
      const other = await prisma.journalEntry.findFirstOrThrow({ where: { tenantId: tenant1Id, status: 'POSTED', id: { not: entry.id } } });
      await expect(prisma.taxMovement.update({ where: { id: movement.id }, data: { journalEntryId: other.id } })).rejects.toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  describe('Numbering reset policy and tenant isolation (Phase 0 s.15, 56)', () => {
    it('a MONTHLY sequence restarts each month; sequences with the same code are independent per tenant', async () => {
      const numbering = app.get(NumberingService);
      const code = `AUD_SEQ_${run}`;
      await numbering.createSequence(tenant1Id, { code, documentType: 'AUDIT', prefix: 'AU', padding: 4, resetPolicy: 'MONTHLY' });
      await numbering.createSequence(tenant2Id, { code, documentType: 'AUDIT', prefix: 'AU', padding: 4, resetPolicy: 'MONTHLY' });

      const jan = new Date('2026-01-10T00:00:00.000Z');
      const feb = new Date('2026-02-10T00:00:00.000Z');
      expect((await numbering.allocateNumber(tenant1Id, code, jan)).formatted).toBe('AU-2026-0001');
      expect((await numbering.allocateNumber(tenant1Id, code, jan)).formatted).toBe('AU-2026-0002');
      expect((await numbering.allocateNumber(tenant1Id, code, feb)).formatted).toBe('AU-2026-0001');
      // Tenant 2's identically-coded sequence never saw tenant 1's allocations.
      expect((await numbering.allocateNumber(tenant2Id, code, jan)).formatted).toBe('AU-2026-0001');
    });
  });

  // ---------------------------------------------------------------------------
  describe('RBAC — effective capabilities follow role changes; write endpoints need write permissions (Phase 0 s.56)', () => {
    let roleId: string;
    let limitedToken: string;
    const asLimited = (r: request.Test) => r.set('Authorization', `Bearer ${limitedToken}`).set('X-Tenant-Id', tenant1Id);

    beforeAll(async () => {
      const role = await asAdmin(request(server()).post('/roles'))
        .send({ code: `AUD_LIMITED_${run}`, name: 'Audit limited', permissionCodes: [] })
        .expect(201);
      roleId = role.body.id;
      limitedToken = (await addMember(tenant1Id, 'limited', [roleId], [orgAId])).token;
    });

    it('denied without the permission, allowed immediately after it is granted to the role', async () => {
      const denied = await asLimited(request(server()).get('/periods')).expect(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');

      await asAdmin(request(server()).patch(`/roles/${roleId}/permissions`))
        .send({ permissionCodes: ['periods.view', 'tax.config.view'] })
        .expect(200);

      await asLimited(request(server()).get('/periods')).expect(200);
    });

    it('viewing periods / tax configuration does not allow creating periods or seeding tax law', async () => {
      await asLimited(request(server()).post('/periods')).send({ year: 2024, month: 1 }).expect(403);
      await asLimited(request(server()).post('/tax/localization/seed')).expect(403);
    });
  });
});
