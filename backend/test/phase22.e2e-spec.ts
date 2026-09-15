/**
 * Phase 22 — Financial Period Close Orchestrator ("Month Close").
 *
 * Direct-service testing style matching phases 15-21's own test files.
 * Exercises the dependency graph + orchestrator end to end against an
 * otherwise-empty tenant (no fixed assets/payroll/production/multi-
 * currency exposure) so every conditional step is genuinely exercised
 * as SKIPPED, and every unconditional step completes for real with no
 * chart-of-accounts fixture required (an unconfigured GL mapping
 * resolves to a zero balance rather than throwing, so reconciliation
 * naturally matches at zero) — then verifies preview vs. regular close,
 * hard lock blocking further posting, and a controlled reopen.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancialPeriodService } from '../src/period-close/financial-period.service';
import { PeriodCloseOrchestrator } from '../src/period-close/period-close-orchestrator.service';
import { CloseDependencyGraphService } from '../src/period-close/close-dependency-graph.service';
import { PeriodLockService } from '../src/period-close/period-lock.service';
import { PeriodReopenService } from '../src/period-close/period-reopen.service';
import { PeriodService } from '../src/period/period.service';
import { CLOSE_STEP_CODES } from '../src/period-close/close-step-definitions';

describe('Phase 22 — Month Close Orchestrator (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let financialPeriod: FinancialPeriodService;
  let orchestrator: PeriodCloseOrchestrator;
  let graph: CloseDependencyGraphService;
  let lock: PeriodLockService;
  let reopenService: PeriodReopenService;
  let accountingPeriod: PeriodService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let membershipId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    financialPeriod = app.get(FinancialPeriodService);
    orchestrator = app.get(PeriodCloseOrchestrator);
    graph = app.get(CloseDependencyGraphService);
    lock = app.get(PeriodLockService);
    reopenService = app.get(PeriodReopenService);
    accountingPeriod = app.get(PeriodService);

    tenantId = randomUUID();
    const currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A22${String(run).slice(-6)}`, name: 'Phase 22 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.create({ data: { id: tenantId, code: `p22-${run}`, name: 'Phase 22 tenant', baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG22-${run}`, name: 'Phase 22 org', baseCurrencyId: currencyId } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p22-${run}@e2e.test`, passwordHash: 'x', displayName: 'P22 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds a cycle-free topological order from the seeded dependency graph', async () => {
    await graph.seedDependencies(tenantId);
    const edges = await graph.getEdges(tenantId);
    expect(edges.length).toBeGreaterThan(0);
    const nodes = Array.from(new Set(edges.flatMap((e) => [e.predecessorStep, e.successorStep])));
    const order = graph.topologicalOrder(nodes, edges);
    expect(order.indexOf(CLOSE_STEP_CODES.DOCUMENT_READINESS)).toBeLessThan(order.indexOf(CLOSE_STEP_CODES.RECONCILIATION));
    expect(order.indexOf(CLOSE_STEP_CODES.RECONCILIATION)).toBeLessThan(order.indexOf(CLOSE_STEP_CODES.FINAL_LOCK));
  });

  it('rejects a genuinely cyclic dependency graph', () => {
    const edges = [
      { predecessorStep: 'A', successorStep: 'B' },
      { predecessorStep: 'B', successorStep: 'C' },
      { predecessorStep: 'C', successorStep: 'A' },
    ];
    expect(() => graph.topologicalOrder(['A', 'B', 'C'], edges)).toThrow();
  });

  it('previews a close with no irreversible effects, then runs and hard-closes a REGULAR_CLOSE', async () => {
    const period = await financialPeriod.create(tenantId, membershipId, userId, { organizationId, fiscalYear: 2026, periodNumber: 8 });
    expect(period.status).toBe('OPEN');

    const preview = await orchestrator.start(tenantId, userId, period.id, 'PREVIEW');
    expect(preview.status).toBe('COMPLETED');
    const finalLockStep = preview.steps.find((s) => s.stepCode === CLOSE_STEP_CODES.FINAL_LOCK);
    expect((finalLockStep!.resultSummary as { locked: boolean }).locked).toBe(false);
    const periodAfterPreview = await financialPeriod.get(tenantId, period.id);
    expect(periodAfterPreview.status).toBe('OPEN'); // preview never mutates period status

    // Conditional steps skip cleanly on an otherwise-empty organization.
    const faStep = preview.steps.find((s) => s.stepCode === CLOSE_STEP_CODES.FA_DEPRECIATION);
    expect(faStep!.status).toBe('SKIPPED');
    const fxStep = preview.steps.find((s) => s.stepCode === CLOSE_STEP_CODES.FX_REVALUATION);
    expect(fxStep!.status).toBe('SKIPPED');
    const closingEntriesStep = preview.steps.find((s) => s.stepCode === CLOSE_STEP_CODES.CLOSING_ENTRIES);
    expect(closingEntriesStep!.status).toBe('SKIPPED'); // not a YEAR_END_CLOSE

    const regular = await orchestrator.start(tenantId, userId, period.id, 'REGULAR_CLOSE');
    expect(regular.status).toBe('COMPLETED');
    expect(regular.blockingIssueCount).toBe(0);

    const reconciliationStep = regular.steps.find((s) => s.stepCode === CLOSE_STEP_CODES.RECONCILIATION);
    expect(reconciliationStep!.status).toBe('SUCCESS');
    const reconciliationResults = await prisma.periodReconciliationResult.findMany({ where: { tenantId, closeRunId: regular.id } });
    expect(reconciliationResults.length).toBeGreaterThan(0);
    expect(reconciliationResults.every((r) => r.status === 'MATCH')).toBe(true); // no GL activity anywhere -> zero vs zero

    const financialResultStep = regular.steps.find((s) => s.stepCode === CLOSE_STEP_CODES.FINANCIAL_RESULT);
    expect((financialResultStep!.resultSummary as { netResult: string }).netResult).toBe('0');

    const closedPeriod = await financialPeriod.get(tenantId, period.id);
    expect(closedPeriod.status).toBe('HARD_CLOSED');

    const snapshot = await prisma.periodCloseSnapshot.findFirst({ where: { tenantId, closeRunId: regular.id } });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.version).toBe(1);

    // The underlying Phase 4 AccountingPeriod is now closed too — ordinary
    // postings dated inside this period must be blocked (spec section 114).
    const accountingPeriodRow = await prisma.accountingPeriod.findFirst({ where: { tenantId, organizationId, year: 2026, month: 8 } });
    expect(accountingPeriodRow!.status).toBe('CLOSED');
    await expect(accountingPeriod.assertDateIsOpen(tenantId, new Date(Date.UTC(2026, 7, 15)), organizationId)).rejects.toThrow();

    // A second REGULAR_CLOSE run cannot start while the period is hard-closed.
    await expect(orchestrator.start(tenantId, userId, period.id, 'REGULAR_CLOSE')).rejects.toThrow();
  });

  it('supports a controlled reopen that invalidates downstream steps without deleting the original run', async () => {
    const period = await financialPeriod.create(tenantId, membershipId, userId, { organizationId, fiscalYear: 2026, periodNumber: 9 });
    const closed = await orchestrator.start(tenantId, userId, period.id, 'REGULAR_CLOSE');
    expect(closed.status).toBe('COMPLETED');

    const request = await reopenService.request(tenantId, userId, {
      financialPeriodId: period.id,
      reason: 'Late supplier invoice discovered after close',
      affectedModules: [CLOSE_STEP_CODES.INVENTORY_COSTING],
    });
    expect(request.status).toBe('PENDING');

    const approved = await reopenService.approve(tenantId, userId, request.id);
    expect(approved.status).toBe('APPROVED');

    const reopenedPeriod = await financialPeriod.get(tenantId, period.id);
    expect(reopenedPeriod.status).toBe('REOPENED');
    expect(reopenedPeriod.reopenCount).toBe(1);

    const invalidatedSteps = await prisma.periodCloseStep.findMany({ where: { tenantId, closeRunId: closed.id, status: 'INVALIDATED' } });
    expect(invalidatedSteps.length).toBeGreaterThan(0);
    expect(invalidatedSteps.some((s) => s.stepCode === CLOSE_STEP_CODES.RECONCILIATION)).toBe(true); // transitive descendant

    // Original v1 run is untouched, not deleted.
    const originalRun = await prisma.periodCloseRun.findUniqueOrThrow({ where: { id: closed.id } });
    expect(originalRun.status).toBe('COMPLETED');

    // Ordinary posting is allowed again in the reopened period.
    await expect(accountingPeriod.assertDateIsOpen(tenantId, new Date(Date.UTC(2026, 8, 15)), organizationId)).resolves.toBeUndefined();

    const reclose = await orchestrator.start(tenantId, userId, period.id, 'RECLOSE');
    expect(reclose.status).toBe('COMPLETED');
    expect(reclose.supersedesRunId).toBe(closed.id);
    expect(reclose.calculationVersion).toBe(2);

    const reclosedPeriod = await financialPeriod.get(tenantId, period.id);
    expect(reclosedPeriod.status).toBe('HARD_CLOSED');
  });
});
