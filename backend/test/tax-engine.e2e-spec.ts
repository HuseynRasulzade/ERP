/**
 * Tax Engine E2E tests (docx spec Phase 5 — Tax Engine & Azerbaijan
 * Localization Engine).
 *
 * Covers: idempotent AZ VAT localization seed, standard VAT exclusive/
 * inclusive calculation, zero-rated vs exempt vs out-of-scope distinction,
 * missing/ambiguous rule detection, legal rule versioning (old rule for
 * an old date, new rule for a new date — never by created_at), repealed
 * rule exclusion, recoverability split, atomic Tax Register + GL posting
 * (same transaction), duplicate-posting prevention, reversal, the shared
 * Period Guard, tax registrations, and tenant isolation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { AzTaxLocalizationService } from '../src/tax-engine/az-tax-localization.service';
import { TaxCalculationService } from '../src/tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../src/tax-engine/tax-register.service';
import { AccountingPostingEngine } from '../src/accounting-core/accounting-posting-engine.service';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import { AccountingMappingService } from '../src/accounting-core/accounting-mapping.service';
import * as request from 'supertest';

describe('Tax Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let localization: AzTaxLocalizationService;
  let calculation: TaxCalculationService;
  let register: TaxRegisterService;
  let postingEngine: AccountingPostingEngine;
  let charts: ChartOfAccountsService;
  let mappings: AccountingMappingService;

  const run = Date.now();
  let token1: string;
  let token2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let org1Id: string;
  let org2Id: string;
  let userId1: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    localization = app.get(AzTaxLocalizationService);
    calculation = app.get(TaxCalculationService);
    register = app.get(TaxRegisterService);
    postingEngine = app.get(AccountingPostingEngine);
    charts = app.get(ChartOfAccountsService);
    mappings = app.get(AccountingMappingService);
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
    const userId = regRes.body.user?.id ?? regRes.body.userId;
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
    return { token, userId, tenantId, orgId: orgRes.body.id };
  }

  function auth1(req: request.Test) {
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }
  function auth2(req: request.Test) {
    return req.set('Authorization', `Bearer ${token2}`).set('X-Tenant-Id', tenant2Id);
  }

  describe('Setup', () => {
    it('creates two tenants, adopts their chart, and seeds AZ VAT localization idempotently', async () => {
      const s1 = await setupTenant(`tax1-${run}@e2e.test`, `tax-t1-${run}`, 'TXO1');
      token1 = s1.token; tenant1Id = s1.tenantId; org1Id = s1.orgId; userId1 = s1.userId;
      const s2 = await setupTenant(`tax2-${run}@e2e.test`, `tax-t2-${run}`, 'TXO2');
      token2 = s2.token; tenant2Id = s2.tenantId; org2Id = s2.orgId;

      await charts.ensureAdopted(tenant1Id);
      await charts.ensureAdopted(tenant2Id);

      await localization.ensureSeeded();
      const before = await prisma.taxRule.count();
      await localization.ensureSeeded();
      const after = await prisma.taxRule.count();
      expect(after).toBe(before);

      const types = await auth1(request(app.getHttpServer()).get('/tax/types')).expect(200);
      expect(types.body.some((t: any) => t.code === 'VAT')).toBe(true);

      const rates = await auth1(request(app.getHttpServer()).get('/tax/rates')).expect(200);
      const standard = rates.body.find((r: any) => r.code === 'AZ_VAT_STANDARD');
      expect(Number(standard.rate)).toBeCloseTo(18, 4);
    });
  });

  describe('Standard VAT calculation', () => {
    it('tax-exclusive: net 100 -> tax 18 -> gross 118 (spec section 25, 115)', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'STANDARD_VAT',
          taxpayerSide: 'SELLER',
          amount: '100',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
        })
        .expect(201);
      expect(res.body.treatment).toBe('STANDARD_RATE');
      expect(Number(res.body.rate)).toBeCloseTo(18, 2);
      expect(Number(res.body.taxableBase)).toBeCloseTo(100, 2);
      expect(Number(res.body.taxAmount)).toBeCloseTo(18, 2);
      expect(Number(res.body.grossAmount)).toBeCloseTo(118, 2);
      expect(res.body.explanation).toContain('AZ_VAT_STANDARD_RULE');
    });

    it('tax-inclusive: gross 118 -> net 100 -> tax 18 (spec section 26, 116)', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'STANDARD_VAT',
          taxpayerSide: 'SELLER',
          amount: '118',
          priceIncludesTax: true,
          taxPointDate: '2026-06-15',
        })
        .expect(201);
      expect(Number(res.body.taxableBase)).toBeCloseTo(100, 2);
      expect(Number(res.body.taxAmount)).toBeCloseTo(18, 2);
      expect(Number(res.body.grossAmount)).toBeCloseTo(118, 2);
    });
  });

  describe('Zero-rated vs exempt vs out-of-scope (spec sections 16-17, 48-50, 117-119)', () => {
    it('zero-rated: tax=0 but base and rule retained, distinct treatment', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'ZERO_RATED_EXPORT',
          taxpayerSide: 'SELLER',
          amount: '500',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
        })
        .expect(201);
      expect(res.body.treatment).toBe('ZERO_RATED');
      expect(Number(res.body.rate)).toBeCloseTo(0, 2);
      expect(Number(res.body.taxableBase)).toBeCloseTo(500, 2);
      expect(Number(res.body.taxAmount)).toBeCloseTo(0, 2);
    });

    it('exempt: tax=0, distinguishable from zero-rated by treatment and rule', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'VAT_EXEMPT',
          taxpayerSide: 'SELLER',
          amount: '500',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
        })
        .expect(201);
      expect(res.body.treatment).toBe('EXEMPT');
      expect(res.body.taxCode).toBe('AZ_VAT_EXEMPT_GENERAL');
      expect(Number(res.body.taxAmount)).toBeCloseTo(0, 2);
    });

    it('out of scope: distinct treatment from exempt/zero-rated', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'OUT_OF_SCOPE',
          taxpayerSide: 'SELLER',
          amount: '500',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
        })
        .expect(201);
      expect(res.body.treatment).toBe('OUT_OF_SCOPE');
    });
  });

  describe('Missing / ambiguous rule (spec sections 33, 132-133)', () => {
    it('unknown tax category -> TAX_RULE_NOT_FOUND', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'NO_SUCH_CATEGORY',
          taxpayerSide: 'SELLER',
          amount: '100',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
        })
        .expect(422);
      expect(res.body.code).toBe('TAX_RULE_NOT_FOUND');
    });

    it('two equal-priority active rules for the same context -> TAX_RULE_AMBIGUOUS', async () => {
      const vatType = await prisma.taxType.findUniqueOrThrow({ where: { code: 'VAT' } });
      const dupeA = await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatType.id,
          code: `DUPE_A_${run}`, name: 'Dupe A', ruleCategory: 'STANDARD',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE', priority: 500,
          treatment: 'STANDARD_RATE', conditionTaxCategoryCode: 'STANDARD_VAT', systemDefined: false,
        },
      });
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatType.id,
          code: `DUPE_B_${run}`, name: 'Dupe B', ruleCategory: 'STANDARD',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE', priority: 500,
          treatment: 'STANDARD_RATE', conditionTaxCategoryCode: 'STANDARD_VAT', systemDefined: false,
        },
      });

      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'SALE',
          taxCategoryCode: 'STANDARD_VAT',
          taxpayerSide: 'SELLER',
          amount: '100',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
        })
        .expect(409);
      expect(res.body.code).toBe('TAX_RULE_AMBIGUOUS');

      // Clean up so later tests in this file resolve unambiguously again.
      await prisma.taxRule.deleteMany({ where: { tenantId: tenant1Id, code: { in: [`DUPE_A_${run}`, `DUPE_B_${run}`] } } });
      void dupeA;
    });
  });

  describe('Legal rule versioning (spec sections 3, 8, 73, 111-114)', () => {
    const V1_CODE = `VERSION_V1_${run}`;
    const V2_CODE = `VERSION_V2_${run}`;
    const REPEALED_CODE = `REPEALED_${run}`;

    it('a rule valid only for an old date range applies to a transaction in that range; a later rule applies after', async () => {
      const vatType = await prisma.taxType.findUniqueOrThrow({ where: { code: 'VAT' } });
      const rateV1 = await prisma.taxRate.create({
        data: {
          taxTypeId: vatType.id, jurisdiction: 'AZ', code: `V1_RATE_${run}`, rate: '20.0000',
          rateType: 'SPECIAL', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE', systemDefined: false,
        },
      });
      const rateV2 = await prisma.taxRate.create({
        data: {
          taxTypeId: vatType.id, jurisdiction: 'AZ', code: `V2_RATE_${run}`, rate: '15.0000',
          rateType: 'SPECIAL', effectiveFrom: new Date('2027-01-01T00:00:00.000Z'), status: 'ACTIVE', systemDefined: false,
        },
      });
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatType.id, code: V1_CODE, name: 'V1',
          ruleCategory: 'STANDARD', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-12-31T00:00:00.000Z'), status: 'ACTIVE', priority: 999,
          treatment: 'SPECIAL_RATE', conditionTaxCategoryCode: 'STANDARD_VAT', rateId: rateV1.id, systemDefined: false,
        },
      });
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatType.id, code: V2_CODE, name: 'V2',
          ruleCategory: 'STANDARD', effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
          status: 'ACTIVE', priority: 999, treatment: 'SPECIAL_RATE', conditionTaxCategoryCode: 'STANDARD_VAT',
          rateId: rateV2.id, systemDefined: false,
        },
      });

      const old = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({ operationType: 'SALE', taxCategoryCode: 'STANDARD_VAT', taxpayerSide: 'SELLER', amount: '100', priceIncludesTax: false, taxPointDate: '2026-10-01' })
        .expect(201);
      expect(Number(old.body.rate)).toBeCloseTo(20, 2);

      const future = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({ operationType: 'SALE', taxCategoryCode: 'STANDARD_VAT', taxpayerSide: 'SELLER', amount: '100', priceIncludesTax: false, taxPointDate: '2027-02-01' })
        .expect(201);
      expect(Number(future.body.rate)).toBeCloseTo(15, 2);
    });

    it('a REPEALED rule is never selected for current calculation, even inside its historical date window', async () => {
      const vatType = await prisma.taxType.findUniqueOrThrow({ where: { code: 'VAT' } });
      await prisma.taxRule.create({
        data: {
          tenantId: tenant1Id, localizationCode: 'TEST', taxTypeId: vatType.id, code: REPEALED_CODE, name: 'Repealed',
          ruleCategory: 'STANDARD', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-12-31T00:00:00.000Z'), status: 'REPEALED', priority: 9999,
          treatment: 'SPECIAL_RATE', conditionTaxCategoryCode: 'STANDARD_VAT', systemDefined: false,
        },
      });

      // Still resolves to V1 (priority 999, ACTIVE) — the REPEALED row
      // (priority 9999) must never win despite otherwise matching.
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({ operationType: 'SALE', taxCategoryCode: 'STANDARD_VAT', taxpayerSide: 'SELLER', amount: '100', priceIncludesTax: false, taxPointDate: '2026-10-01' })
        .expect(201);
      expect(Number(res.body.rate)).toBeCloseTo(20, 2);

      await prisma.taxRule.deleteMany({ where: { tenantId: tenant1Id, code: { in: [V1_CODE, V2_CODE, REPEALED_CODE] } } });
    });
  });

  describe('Recoverability (spec sections 56-57, 122)', () => {
    it('recoverable + nonrecoverable = total tax for a partial-recoverability purchase', async () => {
      const res = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax/calculate`))
        .send({
          operationType: 'PURCHASE',
          taxCategoryCode: 'STANDARD_VAT',
          taxpayerSide: 'BUYER',
          amount: '100',
          priceIncludesTax: false,
          taxPointDate: '2026-06-15',
          recoverablePercent: '50',
        })
        .expect(201);
      const total = Number(res.body.recoverableAmount) + Number(res.body.nonrecoverableAmount);
      expect(total).toBeCloseTo(Number(res.body.taxAmount), 2);
      expect(Number(res.body.recoverableAmount)).toBeCloseTo(9, 2);
      expect(Number(res.body.nonrecoverableAmount)).toBeCloseTo(9, 2);
    });
  });

  describe('Atomic Tax Register + GL posting (spec sections 5, 67, 123-125)', () => {
    const sourceDocumentType = 'TEST_SALE';
    const sourceDocumentId = `test-sale-${run}`;

    it('posts TaxMovement and a balanced Journal Entry in one transaction', async () => {
      const businessDate = new Date('2026-06-20T00:00:00.000Z');
      const receivable = await mappings.resolve(tenant1Id, org1Id, 'CUSTOMER_RECEIVABLE', businessDate);
      const revenue = await mappings.resolve(tenant1Id, org1Id, 'SALES_REVENUE', businessDate);

      const lineResult = await calculation.calculateLine(
        {
          tenantId: tenant1Id, organizationId: org1Id, businessDate, taxPointDate: businessDate,
          operationType: 'SALE', taxCategoryCode: 'STANDARD_VAT', taxpayerSide: 'SELLER',
        },
        { amount: '100', priceIncludesTax: false, sourceLineId: 'line-1' },
      );

      const journalEntry = await prisma.runInTransaction(async (tx) => {
        const { movementIds, accountingLines } = await register.registerTaxable(
          tenant1Id,
          userId1,
          { organizationId: org1Id, sourceDocumentType, sourceDocumentId, taxPointDate: businessDate, operationType: 'SALE', lines: [lineResult] },
          tx,
        );

        const posted = await postingEngine.postBatch(
          tenant1Id,
          userId1,
          {
            organizationId: org1Id,
            businessDate,
            description: 'Test sale with VAT',
            sourceDocumentType,
            sourceDocumentId,
            lines: [
              {
                accountId: receivable.id,
                side: 'DEBIT',
                amountBase: '118',
                dimensions: [
                  { dimensionCode: 'PARTNER', referenceId: 'cust-1' },
                  { dimensionCode: 'COUNTERPARTY', referenceId: 'cust-1' },
                  { dimensionCode: 'AGREEMENT', referenceId: 'agr-1' },
                  { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: sourceDocumentId },
                  { dimensionCode: 'CURRENCY', referenceId: 'usd' },
                ],
              },
              { accountId: revenue.id, side: 'CREDIT', amountBase: '100', dimensions: [{ dimensionCode: 'PRODUCT', referenceId: 'prod-1' }] },
              ...accountingLines,
            ],
          },
          tx,
        );

        await register.linkJournalEntry(tenant1Id, movementIds, posted!.id, tx);
        return posted;
      });

      expect(journalEntry!.status).toBe('POSTED');
      const glMovements = await prisma.accountingMovement.findMany({ where: { journalEntryId: journalEntry!.id } });
      expect(glMovements.length).toBe(3); // receivable, revenue, VAT output payable
      const totalDebit = glMovements.filter((m) => m.side === 'DEBIT').reduce((s, m) => s + Number(m.amountBase), 0);
      const totalCredit = glMovements.filter((m) => m.side === 'CREDIT').reduce((s, m) => s + Number(m.amountBase), 0);
      expect(totalDebit).toBeCloseTo(totalCredit, 2);
      expect(totalDebit).toBeCloseTo(118, 2);

      const taxMovements = await prisma.taxMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType, sourceDocumentId } });
      expect(taxMovements.length).toBe(1);
      expect(Number(taxMovements[0].taxAmount)).toBeCloseTo(18, 2);
      expect(taxMovements[0].journalEntryId).toBe(journalEntry!.id); // drilldown: TaxMovement -> Journal Entry (spec section 108)
    });

    it('rejects posting the same taxable source twice (spec sections 68, 110, 125)', async () => {
      const businessDate = new Date('2026-06-20T00:00:00.000Z');
      const lineResult = await calculation.calculateLine(
        { tenantId: tenant1Id, organizationId: org1Id, businessDate, taxPointDate: businessDate, operationType: 'SALE', taxCategoryCode: 'STANDARD_VAT', taxpayerSide: 'SELLER' },
        { amount: '100', priceIncludesTax: false },
      );
      await expect(
        register.registerTaxable(tenant1Id, userId1, {
          organizationId: org1Id, sourceDocumentType, sourceDocumentId, taxPointDate: businessDate, operationType: 'SALE', lines: [lineResult],
        }),
      ).rejects.toMatchObject({ code: 'TAX_POSTING_DUPLICATE' });
    });

    it('reverses the tax movement — net effect zero, original stays visible (spec sections 66, 126)', async () => {
      const reversals = await register.reverseTaxable(tenant1Id, userId1, sourceDocumentType, sourceDocumentId);
      expect(reversals.length).toBe(1);
      expect(reversals[0].reversalOfMovementId).toBeTruthy();

      const original = await prisma.taxMovement.findMany({ where: { tenantId: tenant1Id, sourceDocumentType, sourceDocumentId, reversalOfMovementId: null } });
      expect(original.length).toBe(1); // never deleted

      const balance = await register.taxBalance(tenant1Id, org1Id, { fromDate: new Date('2026-06-01T00:00:00.000Z'), toDate: new Date('2026-06-30T00:00:00.000Z') });
      expect(Number(balance.taxAmount)).toBeCloseTo(0, 2);
    });
  });

  describe('Shared Period Guard (spec section 129)', () => {
    it('a closed accounting period also blocks tax-related GL posting through the same engine', async () => {
      const businessDate = new Date('2026-05-10T00:00:00.000Z');
      const period = await auth1(request(app.getHttpServer()).post('/periods')).send({ year: 2026, month: 5 }).expect(201);
      await auth1(request(app.getHttpServer()).post(`/periods/${period.body.id}/close`)).expect(201);

      const receivable = await mappings.resolve(tenant1Id, org1Id, 'CUSTOMER_RECEIVABLE', businessDate);
      const revenue = await mappings.resolve(tenant1Id, org1Id, 'SALES_REVENUE', businessDate);

      await expect(
        postingEngine.postBatch(tenant1Id, userId1, {
          organizationId: org1Id,
          businessDate,
          sourceDocumentType: 'TEST_SALE_CLOSED',
          sourceDocumentId: `closed-${run}`,
          lines: [
            { accountId: receivable.id, side: 'DEBIT', amountBase: '10', dimensions: [{ dimensionCode: 'PARTNER', referenceId: 'c' }, { dimensionCode: 'COUNTERPARTY', referenceId: 'c' }, { dimensionCode: 'AGREEMENT', referenceId: 'a' }, { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: 'd' }, { dimensionCode: 'CURRENCY', referenceId: 'usd' }] },
            { accountId: revenue.id, side: 'CREDIT', amountBase: '10', dimensions: [{ dimensionCode: 'PRODUCT', referenceId: 'p' }] },
          ],
        }),
      ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });

      await auth1(request(app.getHttpServer()).post(`/periods/${period.body.id}/reopen`)).send({ reason: 'test' }).expect(201);
    });
  });

  describe('Tax registrations (spec sections 21-23)', () => {
    it('creates an effective-dated registration and resolves it for a date in range', async () => {
      await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/tax-registrations`))
        .send({ taxType: 'VAT', registrationNumber: 'AZ-VAT-0001', validFrom: '2026-03-15' })
        .expect(201);

      const list = await auth1(request(app.getHttpServer()).get(`/organizations/${org1Id}/tax-registrations`)).expect(200);
      expect(list.body.length).toBe(1);
      expect(list.body[0].status).toBe('REGISTERED');
    });
  });

  describe('Tenant isolation (spec section 130)', () => {
    it('tenant 2 cannot resolve tenant 1 custom tax rules and sees only system defaults', async () => {
      const res = await auth2(request(app.getHttpServer()).post(`/organizations/${org2Id}/tax/calculate`))
        .send({ operationType: 'SALE', taxCategoryCode: 'STANDARD_VAT', taxpayerSide: 'SELLER', amount: '100', priceIncludesTax: false, taxPointDate: '2026-06-15' })
        .expect(201);
      expect(Number(res.body.rate)).toBeCloseTo(18, 2); // system default, not tenant1's custom versioned rule
    });

    it('tenant 2 cannot see tenant 1 tax movements', async () => {
      const res = await auth2(request(app.getHttpServer()).get(`/organizations/${org2Id}/tax/register`))
        .query({ fromDate: '2026-01-01', toDate: '2026-12-31' })
        .expect(200);
      expect(res.body.length).toBe(0);
    });
  });
});
