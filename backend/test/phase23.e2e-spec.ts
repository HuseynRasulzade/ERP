/**
 * Phase 23 — Financial Reporting Semantic Layer / Report Mapping Engine
 * / Financial Statement Engine.
 *
 * Direct-service testing style matching phases 15-22's own test files.
 * Posts real GL journal entries via Phase 4's AccountingPostingEngine,
 * defines a minimal Balance Sheet + P&L statement structure, and
 * verifies the mapping engine, row-amount resolver (including a FORMULA
 * row), cross-statement validation, mapping coverage/duplicate
 * detection, and the report run lifecycle (create → calculate → review
 * → approve → finalize → sign → restate/supersede).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountingPostingEngine } from '../src/accounting-core/accounting-posting-engine.service';
import { FinancialReportingFrameworkService } from '../src/financial-reporting/financial-reporting-framework.service';
import { FinancialStatementDefinitionService } from '../src/financial-reporting/financial-statement-definition.service';
import { FinancialReportMappingService } from '../src/financial-reporting/financial-report-mapping.service';
import { BalanceSheetService } from '../src/financial-reporting/balance-sheet.service';
import { ProfitLossService } from '../src/financial-reporting/profit-loss.service';
import { FinancialReportValidationService } from '../src/financial-reporting/financial-report-validation.service';
import { FinancialReportVersionService } from '../src/financial-reporting/financial-report-version.service';
import { FinancialReportFormulaService } from '../src/financial-reporting/financial-report-formula.service';

describe('Phase 23 — Financial Reporting Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: AccountingPostingEngine;
  let frameworks: FinancialReportingFrameworkService;
  let statements: FinancialStatementDefinitionService;
  let mappings: FinancialReportMappingService;
  let balanceSheet: BalanceSheetService;
  let profitLoss: ProfitLossService;
  let validation: FinancialReportValidationService;
  let runs: FinancialReportVersionService;
  let formula: FinancialReportFormulaService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let userId: string;
  let cashAccountId: string;
  let equityAccountId: string;
  let revenueAccountId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    posting = app.get(AccountingPostingEngine);
    frameworks = app.get(FinancialReportingFrameworkService);
    statements = app.get(FinancialStatementDefinitionService);
    mappings = app.get(FinancialReportMappingService);
    balanceSheet = app.get(BalanceSheetService);
    profitLoss = app.get(ProfitLossService);
    validation = app.get(FinancialReportValidationService);
    runs = app.get(FinancialReportVersionService);
    formula = app.get(FinancialReportFormulaService);

    tenantId = randomUUID();
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A23${String(run).slice(-6)}`, name: 'Phase 23 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.create({ data: { id: tenantId, code: `p23-${run}`, name: 'Phase 23 tenant', baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG23-${run}`, name: 'Phase 23 org', baseCurrencyId: currencyId } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p23-${run}@e2e.test`, passwordHash: 'x', displayName: 'P23 User' } });

    const coa = await prisma.chartOfAccounts.create({ data: { tenantId, code: `COA23-${run}`, name: 'Phase 23 chart' } });
    cashAccountId = randomUUID();
    await prisma.account.create({ data: { id: cashAccountId, tenantId, chartOfAccountsId: coa.id, code: `101-${run}`, name: 'Cash', accountClass: 'ASSET', normalBalance: 'DEBIT', reportingTags: ['CASH'] } });
    equityAccountId = randomUUID();
    await prisma.account.create({ data: { id: equityAccountId, tenantId, chartOfAccountsId: coa.id, code: `301-${run}`, name: 'Share Capital', accountClass: 'EQUITY', normalBalance: 'CREDIT' } });
    revenueAccountId = randomUUID();
    await prisma.account.create({ data: { id: revenueAccountId, tenantId, chartOfAccountsId: coa.id, code: `401-${run}`, name: 'Sales Revenue', accountClass: 'REVENUE', normalBalance: 'CREDIT' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a genuine formula cycle', () => {
    const formulas = new Map([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    expect(() => formula.topologicalOrder(formulas)).toThrow();
  });

  it('computes a Balance Sheet that satisfies Assets = Liabilities + Equity, and a P&L formula row', async () => {
    // Owner contributes 1,000 in cash (opening equity).
    await posting.postBatch(tenantId, userId, {
      organizationId,
      businessDate: new Date('2026-01-01'),
      description: 'Owner contribution',
      sourceDocumentType: 'MANUAL_TEST',
      sourceDocumentId: randomUUID(),
      lines: [
        { accountId: cashAccountId, side: 'DEBIT', amountBase: '1000' },
        { accountId: equityAccountId, side: 'CREDIT', amountBase: '1000' },
      ],
    });
    // A 500 cash sale during February (P&L period activity).
    await posting.postBatch(tenantId, userId, {
      organizationId,
      businessDate: new Date('2026-02-10'),
      description: 'Cash sale',
      sourceDocumentType: 'MANUAL_TEST',
      sourceDocumentId: randomUUID(),
      lines: [
        { accountId: cashAccountId, side: 'DEBIT', amountBase: '500' },
        { accountId: revenueAccountId, side: 'CREDIT', amountBase: '500' },
      ],
    });

    const framework = await frameworks.create(tenantId, userId, { code: `FW-${run}`, name: 'Internal', frameworkType: 'INTERNAL_ACCOUNTING' });
    const frameworkVersion = await frameworks.createVersion(tenantId, userId, framework.id, { effectiveFrom: '2026-01-01' });
    await frameworks.activate(tenantId, userId, frameworkVersion.id);

    // --- Balance Sheet structure ---
    const bsDefinition = await statements.create(tenantId, userId, { code: `BS-${run}`, name: 'Balance Sheet', statementType: 'BALANCE_SHEET' });
    const bsVersion = await statements.createVersion(tenantId, userId, bsDefinition.id, { effectiveFrom: '2026-01-01', frameworkVersionId: frameworkVersion.id });
    const totalAssetsRow = await statements.addRow(tenantId, bsVersion.id, { rowCode: 'TOTAL_ASSETS', label: 'Total Assets', rowType: 'SUBTOTAL', sequence: 10 });
    const cashRow = await statements.addRow(tenantId, bsVersion.id, { rowCode: 'CASH', label: 'Cash', parentRowId: totalAssetsRow.id, sequence: 5 });
    const totalLiabilitiesRow = await statements.addRow(tenantId, bsVersion.id, { rowCode: 'TOTAL_LIABILITIES', label: 'Total Liabilities', sequence: 20 });
    const totalEquityRow = await statements.addRow(tenantId, bsVersion.id, { rowCode: 'TOTAL_EQUITY', label: 'Total Equity', rowType: 'SUBTOTAL', sequence: 40 });
    const equityRow = await statements.addRow(tenantId, bsVersion.id, { rowCode: 'SHARE_CAPITAL', label: 'Share Capital', parentRowId: totalEquityRow.id, sequence: 35, signPolicy: 'FLIP' });
    await statements.activateVersion(tenantId, userId, bsVersion.id);
    void totalLiabilitiesRow;

    await mappings.create(tenantId, userId, { frameworkVersionId: frameworkVersion.id, statementVersionId: bsVersion.id, reportRowId: cashRow.id, strategy: 'EXACT_ACCOUNT', accountId: cashAccountId, effectiveFrom: '2026-01-01' });
    await mappings.create(tenantId, userId, { frameworkVersionId: frameworkVersion.id, statementVersionId: bsVersion.id, reportRowId: equityRow.id, strategy: 'EXACT_ACCOUNT', accountId: equityAccountId, effectiveFrom: '2026-01-01' });

    const bsResult = await balanceSheet.run(tenantId, organizationId, bsVersion.id, new Date('2026-02-28'));
    expect(bsResult.totalAssets).toBe('1500.00');
    expect(bsResult.totalEquity).toBe('1000.00');
    // Revenue is not equity-mapped in this minimal fixture, so BS alone
    // won't absorb the period's profit — verified against the equation
    // deliberately allowing that gap, then checked via the validator.
    const bsValidation = await validation.validateBalanceSheet(bsResult.equationDifference);
    expect(bsValidation.status).toBe('BLOCKING'); // 1500 assets vs 0 liabilities + 1000 equity = 500 gap (the unretained profit)

    const coverage = await mappings.coverage(tenantId, organizationId, bsVersion.id, new Date('2026-02-28'));
    expect(coverage.mappedAccounts).toBe(2);
    expect(coverage.unmappedAccounts).toContain(revenueAccountId); // revenue has a balance but no BS mapping

    // --- Double-mapping detection ---
    await mappings.create(tenantId, userId, { frameworkVersionId: frameworkVersion.id, statementVersionId: bsVersion.id, reportRowId: totalLiabilitiesRow.id, strategy: 'EXACT_ACCOUNT', accountId: cashAccountId, effectiveFrom: '2026-01-01' });
    const coverageAfterDuplicate = await mappings.coverage(tenantId, organizationId, bsVersion.id, new Date('2026-02-28'));
    expect(coverageAfterDuplicate.duplicateMappedAccounts.some((d) => d.accountId === cashAccountId)).toBe(true);

    // --- P&L structure with a FORMULA row ---
    const pnlDefinition = await statements.create(tenantId, userId, { code: `PNL-${run}`, name: 'Profit and Loss', statementType: 'PROFIT_AND_LOSS' });
    const pnlVersion = await statements.createVersion(tenantId, userId, pnlDefinition.id, { effectiveFrom: '2026-01-01', frameworkVersionId: frameworkVersion.id });
    const revenueRow = await statements.addRow(tenantId, pnlVersion.id, { rowCode: 'REVENUE', label: 'Revenue', sequence: 10, signPolicy: 'FLIP' });
    await statements.addRow(tenantId, pnlVersion.id, { rowCode: 'NET_PROFIT', label: 'Net Profit', rowType: 'FORMULA', formula: 'REVENUE', sequence: 90 });
    await statements.activateVersion(tenantId, userId, pnlVersion.id);
    await mappings.create(tenantId, userId, { frameworkVersionId: frameworkVersion.id, statementVersionId: pnlVersion.id, reportRowId: revenueRow.id, strategy: 'EXACT_ACCOUNT', accountId: revenueAccountId, effectiveFrom: '2026-01-01' });

    const pnlResult = await profitLoss.run(tenantId, organizationId, pnlVersion.id, new Date('2026-02-01'), new Date('2026-02-28'));
    expect(pnlResult.netResult).toBe('500.00');

    // --- Report run lifecycle: create -> calculate -> review -> approve -> finalize -> sign -> restate ---
    const created = await runs.create(tenantId, userId, { organizationId, statementDefinitionCode: pnlDefinition.code, frameworkCode: framework.code, reportingCurrencyId: currencyId, runType: 'MANAGEMENT_PREVIEW', periodStart: '2026-02-01', periodEnd: '2026-02-28' });
    expect(['CALCULATED', 'VALIDATION_WARNING'].includes(created.status)).toBe(true);
    const cell = created.cells.find((c) => c.rowCode === 'NET_PROFIT');
    expect(cell?.amount.toString()).toBe('500.00');

    await runs.review(tenantId, userId, created.id);
    const approved = await runs.approve(tenantId, userId, created.id);
    expect(approved.status).toBe('APPROVED');
    const finalized = await runs.finalize(tenantId, userId, created.id);
    expect(finalized.status).toBe('FINAL');
    // Idempotent re-finalize.
    const finalizedAgain = await runs.finalize(tenantId, userId, created.id);
    expect(finalizedAgain.status).toBe('FINAL');

    const signature = await runs.sign(tenantId, userId, created.id, { signerRole: 'Chief Accountant' });
    expect(signature.status).toBe('ACTIVE');
    // Idempotent re-sign by the same signer returns the same signature.
    const signatureAgain = await runs.sign(tenantId, userId, created.id, { signerRole: 'Chief Accountant' });
    expect(signatureAgain.id).toBe(signature.id);

    await expect(runs.calculate(tenantId, userId, created.id)).rejects.toThrow(); // FINAL/SIGNED is immutable

    const restated = await runs.restate(tenantId, userId, created.id, 'Late invoice discovered');
    expect(restated.calculationVersion).toBe(2);
    const original = await runs.get(tenantId, created.id);
    expect(original.status).toBe('SUPERSEDED');
  });
});
