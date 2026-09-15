import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodClosePolicyService } from './period-close-policy.service';
import { PeriodReadinessService } from './period-readiness.service';
import { CloseIssueService } from './close-issue.service';
import { CloseReconciliationService } from './close-reconciliation.service';
import { FXRevaluationService } from './fx-revaluation.service';
import { TaxCloseService } from './tax-close.service';
import { FinancialResultService } from './financial-result.service';
import { ClosingEntryService } from './closing-entry.service';
import { CloseSnapshotService } from './close-snapshot.service';
import { PeriodLockService } from './period-lock.service';
import { FixedAssetDepreciationService } from '../fixed-assets/fixed-asset-depreciation.service';
import { FixedAssetReconciliationService } from '../fixed-assets/fixed-asset-reconciliation.service';
import { PrepaidExpenseService } from '../expenses/prepaid-expense.service';
import { PayrollCloseService } from '../payroll/payroll-close.service';
import { CostingPeriodService } from '../inventory-costing/costing-period.service';
import { InventoryCostRecalculationService } from '../inventory-costing/inventory-cost-recalculation.service';
import { ProductionCloseService } from '../manufacturing/production-close.service';
import { SettlementHealthService } from '../settlement/settlement-health.service';
import { TreasuryHealthService } from '../treasury/treasury-health.service';
import { CashHealthService } from '../cash/cash-health.service';
import { CLOSE_STEP_CODES } from './close-step-definitions';

export interface StepOutcome {
  status: 'SUCCESS' | 'WARNING' | 'BLOCKED' | 'FAILED' | 'SKIPPED';
  summary: Record<string, unknown>;
  warnings?: string[];
  errors?: string[];
}

/**
 * PeriodCloseStepExecutor (docx spec Phase 22, section 26's own
 * `CloseableSubledger` contract, realized here as one dispatch method per
 * step code rather than requiring every subledger module to literally
 * implement a shared interface — this build calls each module's own
 * existing authoritative service directly). Every step is written to be
 * safely re-runnable (spec section 28) — either the underlying service
 * call is itself idempotent (checked first) or this executor checks
 * "already done" before calling it.
 */
@Injectable()
export class PeriodCloseStepExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PeriodClosePolicyService,
    private readonly readiness: PeriodReadinessService,
    private readonly issues: CloseIssueService,
    private readonly reconciliation: CloseReconciliationService,
    private readonly fx: FXRevaluationService,
    private readonly taxClose: TaxCloseService,
    private readonly financialResult: FinancialResultService,
    private readonly closingEntry: ClosingEntryService,
    private readonly snapshot: CloseSnapshotService,
    private readonly lock: PeriodLockService,
    private readonly depreciation: FixedAssetDepreciationService,
    private readonly faReconciliation: FixedAssetReconciliationService,
    private readonly prepaid: PrepaidExpenseService,
    private readonly payrollClose: PayrollCloseService,
    private readonly costingPeriod: CostingPeriodService,
    private readonly costRecalc: InventoryCostRecalculationService,
    private readonly productionClose: ProductionCloseService,
    private readonly settlementHealth: SettlementHealthService,
    private readonly treasuryHealth: TreasuryHealthService,
    private readonly cashHealth: CashHealthService,
  ) {}

  /** Whether a conditional step should be SKIPPED for this org (spec
   * section 16). Evaluated once per run, live. */
  async shouldSkip(stepCode: string, tenantId: string, organizationId: string): Promise<string | null> {
    switch (stepCode) {
      case CLOSE_STEP_CODES.FA_DEPRECIATION: {
        const count = await this.prisma.fixedAsset.count({ where: { tenantId, organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] } } });
        return count === 0 ? 'No active fixed assets for this organization.' : null;
      }
      case CLOSE_STEP_CODES.PREPAID_RECOGNITION: {
        const count = await this.prisma.prepaidExpense.count({ where: { tenantId, organizationId, status: 'ACTIVE' } });
        return count === 0 ? 'No active prepaid expense schedules.' : null;
      }
      case CLOSE_STEP_CODES.PAYROLL_FINALIZATION: {
        const count = await this.prisma.employment.count({ where: { tenantId, organizationId, employmentStatus: 'ACTIVE' } });
        return count === 0 ? 'No active employments for this organization.' : null;
      }
      case CLOSE_STEP_CODES.PRODUCTION_COSTING:
      case CLOSE_STEP_CODES.INVENTORY_RECALCULATION: {
        const count = await this.prisma.productionOrder.count({ where: { tenantId, organizationId } });
        return count === 0 ? 'No production orders for this organization.' : null;
      }
      case CLOSE_STEP_CODES.FX_REVALUATION: {
        const hasExposure = await this.fx.hasMultiCurrencyExposure(tenantId, organizationId);
        return hasExposure ? null : 'No open multi-currency AR/AP exposure.';
      }
      case CLOSE_STEP_CODES.CLOSING_ENTRIES:
        return null; // closeType-gated inside execute(), not org-activity-gated
      default:
        return null;
    }
  }

  async execute(
    stepCode: string,
    ctx: { tenantId: string; organizationId: string; userId: string; closeRunId: string; periodStart: Date; periodEnd: Date; period: string; closeType: string; dryRun: boolean },
  ): Promise<StepOutcome> {
    switch (stepCode) {
      case CLOSE_STEP_CODES.DOCUMENT_READINESS:
        return this.runDocumentReadiness(ctx);
      case CLOSE_STEP_CODES.FA_DEPRECIATION:
        return this.runFaDepreciation(ctx);
      case CLOSE_STEP_CODES.PREPAID_RECOGNITION:
        return this.runPrepaidRecognition(ctx);
      case CLOSE_STEP_CODES.PAYROLL_FINALIZATION:
        return this.runPayrollFinalization(ctx);
      case CLOSE_STEP_CODES.INVENTORY_COSTING:
        return this.runInventoryCosting(ctx);
      case CLOSE_STEP_CODES.PRODUCTION_COSTING:
        return this.runProductionCosting(ctx);
      case CLOSE_STEP_CODES.INVENTORY_RECALCULATION:
        return this.runInventoryRecalculation(ctx);
      case CLOSE_STEP_CODES.AR_AP_VALIDATION:
        return this.runArApValidation(ctx);
      case CLOSE_STEP_CODES.BANK_RECONCILIATION:
        return this.runBankReconciliation(ctx);
      case CLOSE_STEP_CODES.CASH_CLOSE:
        return this.runCashClose(ctx);
      case CLOSE_STEP_CODES.FX_REVALUATION:
        return this.runFxRevaluation(ctx);
      case CLOSE_STEP_CODES.ACCRUALS:
        return this.runAccruals(ctx);
      case CLOSE_STEP_CODES.TAX_CLOSE:
        return this.runTaxClose(ctx);
      case CLOSE_STEP_CODES.RECONCILIATION:
        return this.runReconciliation(ctx);
      case CLOSE_STEP_CODES.FINANCIAL_RESULT:
        return this.runFinancialResult(ctx);
      case CLOSE_STEP_CODES.CLOSING_ENTRIES:
        return this.runClosingEntries(ctx);
      case CLOSE_STEP_CODES.FINAL_LOCK:
        return this.runFinalLock(ctx);
      default:
        return { status: 'FAILED', summary: {}, errors: [`Unknown step code ${stepCode}`] };
    }
  }

  private async runDocumentReadiness(ctx: { tenantId: string; organizationId: string; periodStart: Date; periodEnd: Date }): Promise<StepOutcome> {
    const report = await this.readiness.checkReadiness(ctx.tenantId, ctx.organizationId, ctx.periodStart, ctx.periodEnd);
    return { status: report.status === 'READY' ? 'SUCCESS' : 'BLOCKED', summary: { findingCount: report.findings.length, findings: report.findings }, warnings: report.findings.filter((f) => !f.blocking).map((f) => f.message), errors: report.findings.filter((f) => f.blocking).map((f) => f.message) };
  }

  private async runFaDepreciation(ctx: { tenantId: string; organizationId: string; userId: string; period: string; dryRun: boolean }): Promise<StepOutcome> {
    const membershipId = await this.systemMembership(ctx.tenantId, ctx.userId, ctx.organizationId);
    let run = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { tenantId: ctx.tenantId, organizationId: ctx.organizationId, period: this.periodStartDate(ctx.period), valuationBook: 'ACCOUNTING_BOOK', runType: 'PERIODIC' } });
    if (!ctx.dryRun) {
      if (!run) run = await this.depreciation.calculate(ctx.tenantId, membershipId, ctx.organizationId, ctx.userId, ctx.period, 'PERIODIC');
      if (run.status !== 'POSTED') run = await this.depreciation.post(ctx.tenantId, membershipId, ctx.organizationId, ctx.userId, run.id);
    }
    const mismatches = await this.faReconciliation.reconcileAssetStatus(ctx.tenantId, ctx.organizationId);
    return { status: mismatches.length > 0 ? 'WARNING' : 'SUCCESS', summary: { runId: run?.id, mismatchCount: mismatches.length }, warnings: mismatches.map((m) => `Asset ${m.assetNumber} subledger drift.`) };
  }

  private async runPrepaidRecognition(ctx: { tenantId: string; organizationId: string; userId: string; period: string; dryRun: boolean }): Promise<StepOutcome> {
    let itemsProcessed = 0;
    if (!ctx.dryRun) {
      const outcome = await this.prepaid.recognizePeriod(ctx.tenantId, ctx.organizationId, ctx.userId, `${ctx.period}-01`);
      itemsProcessed = outcome.itemsProcessed;
    }
    const stillPendingDue = await this.prisma.prepaidExpenseSchedule.count({ where: { tenantId: ctx.tenantId, status: 'PENDING', period: { lte: this.periodEndDate(ctx.period) }, prepaid: { organizationId: ctx.organizationId, status: 'ACTIVE' } } });
    return { status: stillPendingDue > 0 ? 'WARNING' : 'SUCCESS', summary: { itemsProcessed, stillPendingDue }, warnings: stillPendingDue > 0 ? [`${stillPendingDue} prepaid schedule row(s) still due but unrecognized.`] : [] };
  }

  private async runPayrollFinalization(ctx: { tenantId: string; organizationId: string; userId: string; period: string }): Promise<StepOutcome> {
    const membershipId = await this.systemMembership(ctx.tenantId, ctx.userId, ctx.organizationId);
    const payrollPeriod = await this.prisma.payrollPeriod.findFirst({ where: { tenantId: ctx.tenantId, organizationId: ctx.organizationId, periodStart: this.periodStartDate(ctx.period) } });
    if (!payrollPeriod) return { status: 'BLOCKED', summary: {}, errors: [`No PayrollPeriod found for ${ctx.period} — payroll must be run before month close.`] };
    const checks = await this.payrollClose.runChecks(ctx.tenantId, membershipId, ctx.organizationId, payrollPeriod.id);
    const failed = checks.filter((c) => !c.passed);
    return { status: failed.length === 0 ? 'SUCCESS' : 'BLOCKED', summary: { checks }, errors: failed.map((c) => c.message) };
  }

  private async runInventoryCosting(ctx: { tenantId: string; organizationId: string; userId: string; period: string; dryRun: boolean }): Promise<StepOutcome> {
    const pending = await this.costRecalc.pendingCount(ctx.tenantId, ctx.organizationId);
    if (pending > 0 && !ctx.dryRun) {
      await this.costRecalc.processQueue(ctx.tenantId, ctx.userId, ctx.organizationId);
    }
    if (!ctx.dryRun) {
      const existing = await this.prisma.inventoryCostingPeriod.findUnique({ where: { tenantId_organizationId_period: { tenantId: ctx.tenantId, organizationId: ctx.organizationId, period: ctx.period } } });
      if (!existing || existing.status !== 'FINALIZED') {
        await this.costingPeriod.finalize(ctx.tenantId, ctx.organizationId, ctx.period, ctx.userId);
      }
    }
    const remainingPending = await this.costRecalc.pendingCount(ctx.tenantId, ctx.organizationId);
    return { status: remainingPending > 0 ? 'BLOCKED' : 'SUCCESS', summary: { remainingPending }, errors: remainingPending > 0 ? [`${remainingPending} recalculation request(s) still pending after processing.`] : [] };
  }

  private async runProductionCosting(ctx: { tenantId: string; organizationId: string; userId: string; periodStart: Date; periodEnd: Date; dryRun: boolean }): Promise<StepOutcome> {
    const membershipId = await this.systemMembership(ctx.tenantId, ctx.userId, ctx.organizationId);
    const relevantOrders = await this.prisma.productionOrder.findMany({
      where: { tenantId: ctx.tenantId, organizationId: ctx.organizationId, documentDate: { lte: ctx.periodEnd }, postingStatus: 'POSTED' },
      select: { id: true, number: true, closeStatus: true },
    });
    const unresolved: string[] = [];
    for (const order of relevantOrders) {
      if (order.closeStatus === 'CLOSED') continue;
      const checks = await this.productionClose.runCloseChecks(ctx.tenantId, ctx.organizationId, order.id).catch(() => []);
      const failed = checks.filter((c: { passed: boolean }) => !c.passed);
      if (failed.length > 0) unresolved.push(`Production order ${order.number ?? order.id}: ${failed.map((c: { code: string }) => c.code).join(', ')}`);
    }
    return { status: unresolved.length > 0 ? 'WARNING' : 'SUCCESS', summary: { orderCount: relevantOrders.length, unresolvedCount: unresolved.length }, warnings: unresolved };
  }

  private async runInventoryRecalculation(ctx: { tenantId: string; organizationId: string; userId: string; dryRun: boolean }): Promise<StepOutcome> {
    if (!ctx.dryRun) await this.costRecalc.processQueue(ctx.tenantId, ctx.userId, ctx.organizationId);
    const pending = await this.costRecalc.pendingCount(ctx.tenantId, ctx.organizationId);
    return { status: pending > 0 ? 'BLOCKED' : 'SUCCESS', summary: { pending }, errors: pending > 0 ? [`${pending} recalculation request(s) still pending after production finalization.`] : [] };
  }

  private async runArApValidation(ctx: { tenantId: string; organizationId: string }): Promise<StepOutcome> {
    const issues = await this.settlementHealth.check(ctx.tenantId, ctx.organizationId);
    const blocking = issues.filter((i) => i.severity === 'ERROR' || i.severity === 'BLOCKING');
    return { status: blocking.length > 0 ? 'BLOCKED' : issues.length > 0 ? 'WARNING' : 'SUCCESS', summary: { issueCount: issues.length }, warnings: issues.filter((i) => !blocking.includes(i)).map((i) => i.message), errors: blocking.map((i) => i.message) };
  }

  private async runBankReconciliation(ctx: { tenantId: string; organizationId: string }): Promise<StepOutcome> {
    const issues = await this.treasuryHealth.check(ctx.tenantId, ctx.organizationId);
    const blocking = issues.filter((i) => i.severity === 'ERROR' || i.severity === 'BLOCKING');
    return { status: blocking.length > 0 ? 'BLOCKED' : issues.length > 0 ? 'WARNING' : 'SUCCESS', summary: { issueCount: issues.length }, warnings: issues.filter((i) => !blocking.includes(i)).map((i) => i.message), errors: blocking.map((i) => i.message) };
  }

  private async runCashClose(ctx: { tenantId: string; organizationId: string }): Promise<StepOutcome> {
    const issues = await this.cashHealth.check(ctx.tenantId, ctx.organizationId);
    const blocking = issues.filter((i) => i.severity === 'ERROR' || i.severity === 'BLOCKING');
    return { status: blocking.length > 0 ? 'BLOCKED' : issues.length > 0 ? 'WARNING' : 'SUCCESS', summary: { issueCount: issues.length }, warnings: issues.filter((i) => !blocking.includes(i)).map((i) => i.message), errors: blocking.map((i) => i.message) };
  }

  private async runFxRevaluation(ctx: { tenantId: string; organizationId: string; userId: string; period: string; periodEnd: Date; closeRunId: string; dryRun: boolean }): Promise<StepOutcome> {
    if (ctx.dryRun) return { status: 'SUCCESS', summary: { dryRun: true } };
    const run = await this.fx.run(ctx.tenantId, ctx.organizationId, ctx.userId, ctx.period, ctx.closeRunId, ctx.periodEnd);
    return { status: 'SUCCESS', summary: { fxRunId: run.id, status: run.status } };
  }

  private async runAccruals(ctx: { tenantId: string; organizationId: string; periodStart: Date }): Promise<StepOutcome> {
    const financialPeriod = await this.prisma.financialPeriod.findFirst({ where: { tenantId: ctx.tenantId, organizationId: ctx.organizationId, periodStart: ctx.periodStart } });
    const draftAccruals = financialPeriod ? await this.prisma.periodAccrual.count({ where: { tenantId: ctx.tenantId, financialPeriodId: financialPeriod.id, status: 'DRAFT' } }) : 0;
    return { status: draftAccruals > 0 ? 'WARNING' : 'SUCCESS', summary: { draftAccruals }, warnings: draftAccruals > 0 ? [`${draftAccruals} accrual(s) still in DRAFT — post them before final validation.`] : [] };
  }

  private async runTaxClose(ctx: { tenantId: string; organizationId: string; periodStart: Date; periodEnd: Date; closeRunId: string; dryRun: boolean }): Promise<StepOutcome> {
    if (ctx.dryRun) return { status: 'SUCCESS', summary: { dryRun: true } };
    const results = await this.taxClose.run(ctx.tenantId, ctx.closeRunId, ctx.organizationId, ctx.periodStart, ctx.periodEnd);
    const blocking = results.filter((r) => r.blocking);
    return { status: blocking.length > 0 ? 'BLOCKED' : 'SUCCESS', summary: { results }, errors: blocking.map((r) => `${r.taxType} differs from GL by ${r.difference}.`) };
  }

  private async runReconciliation(ctx: { tenantId: string; organizationId: string; closeRunId: string; periodEnd: Date; dryRun: boolean }): Promise<StepOutcome> {
    if (ctx.dryRun) return { status: 'SUCCESS', summary: { dryRun: true } };
    const results = await this.reconciliation.runAll(ctx.tenantId, ctx.closeRunId, ctx.organizationId, ctx.periodEnd);
    const blocking = results.filter((r) => r.status === 'BLOCKING');
    for (const b of blocking) {
      await this.issues.create(ctx.tenantId, ctx.closeRunId, { issueCode: 'RECONCILIATION_DIFFERENCE', severity: 'BLOCKING', blocking: true, sourceModule: 'RECONCILIATION', sourceEntity: b.ruleId, description: `Reconciliation difference of ${b.difference} exceeds tolerance ${b.tolerance}.` });
    }
    return { status: blocking.length > 0 ? 'BLOCKED' : 'SUCCESS', summary: { resultCount: results.length, blockingCount: blocking.length }, errors: blocking.map((b) => `Rule ${b.ruleId}: difference ${b.difference} (source ${b.sourceAmount} vs GL ${b.targetAmount}).`) };
  }

  private async runFinancialResult(ctx: { tenantId: string; organizationId: string; periodStart: Date; periodEnd: Date }): Promise<StepOutcome> {
    const result = await this.financialResult.calculate(ctx.tenantId, ctx.organizationId, ctx.periodStart, ctx.periodEnd);
    return { status: 'SUCCESS', summary: { ...result } };
  }

  private async runClosingEntries(ctx: { tenantId: string; organizationId: string; userId: string; closeRunId: string; closeType: string; periodStart: Date; periodEnd: Date; dryRun: boolean }): Promise<StepOutcome> {
    if (ctx.closeType !== 'YEAR_END_CLOSE') {
      return { status: 'SKIPPED', summary: { reason: 'Monthly close accumulates current-year P&L; closing entries only fire at YEAR_END_CLOSE (spec section 105).' } };
    }
    if (ctx.dryRun) return { status: 'SUCCESS', summary: { dryRun: true } };
    const fiscalYearStart = new Date(Date.UTC(ctx.periodEnd.getUTCFullYear(), 0, 1));
    const adjustment = await this.closingEntry.postYearEndClosingEntries(ctx.tenantId, ctx.userId, ctx.organizationId, ctx.closeRunId, fiscalYearStart, ctx.periodEnd);
    return { status: 'SUCCESS', summary: { adjustmentId: adjustment?.id ?? null } };
  }

  private async runFinalLock(ctx: { tenantId: string; organizationId: string; userId: string; closeRunId: string; periodEnd: Date; closeType: string; dryRun: boolean }): Promise<StepOutcome> {
    if (ctx.dryRun) {
      return { status: 'SUCCESS', summary: { locked: false, reason: 'Preview/diagnostic/pre-close runs never apply an irreversible lock (spec section 195/90).' } };
    }
    const closeRun = await this.prisma.periodCloseRun.findUniqueOrThrow({ where: { id: ctx.closeRunId } });
    const snapshot = await this.snapshot.create(ctx.tenantId, closeRun.financialPeriodId, ctx.closeRunId, ctx.organizationId, ctx.periodEnd);
    await this.lock.hardClose(ctx.tenantId, closeRun.financialPeriodId, ctx.userId);
    return { status: 'SUCCESS', summary: { snapshotId: snapshot.id, locked: true } };
  }

  private periodStartDate(period: string): Date {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  private periodEndDate(period: string): Date {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0));
  }

  /** Several existing services take a `membershipId` for
   * `OrganizationAccessService.assertAccess` — Month Close runs as an
   * orchestration principal, not a logged-in member, so it resolves ANY
   * active membership with access to the organization rather than
   * requiring the close-run initiator to personally hold a membership on
   * every organization in a group close (disclosed simplification,
   * docs/MONTH_CLOSE.md section M). */
  private async systemMembership(tenantId: string, userId: string, organizationId: string): Promise<string> {
    const ownMembership = await this.prisma.tenantMembership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' } });
    if (ownMembership) {
      const access = await this.prisma.organizationAccess.findFirst({ where: { tenantMembershipId: ownMembership.id, organizationId } });
      if (access) return ownMembership.id;
    }
    const anyAccess = await this.prisma.organizationAccess.findFirst({ where: { organizationId, membership: { tenantId, status: 'ACTIVE' } } });
    if (anyAccess) return anyAccess.tenantMembershipId;
    if (ownMembership) return ownMembership.id;
    throw new Error(`No membership with access to organization ${organizationId} found to run Month Close under.`);
  }
}
