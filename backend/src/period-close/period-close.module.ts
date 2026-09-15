import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { CurrencyModule } from '../currency/currency.module';
import { PeriodModule } from '../period/period.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';
import { FixedAssetModule } from '../fixed-assets/fixed-asset.module';
import { ExpenseModule } from '../expenses/expense.module';
import { PayrollModule } from '../payroll/payroll.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { SettlementModule } from '../settlement/settlement.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { CashModule } from '../cash/cash.module';

import { FinancialPeriodService } from './financial-period.service';
import { PeriodClosePolicyService } from './period-close-policy.service';
import { CloseDependencyGraphService } from './close-dependency-graph.service';
import { PeriodReadinessService } from './period-readiness.service';
import { PeriodCloseStepExecutor } from './period-close-step-executor.service';
import { PeriodCloseOrchestrator } from './period-close-orchestrator.service';
import { CloseIssueService } from './close-issue.service';
import { CloseReconciliationService } from './close-reconciliation.service';
import { FXRevaluationService } from './fx-revaluation.service';
import { AccrualService } from './accrual.service';
import { DeferredRevenueService } from './deferred-revenue.service';
import { TaxCloseService } from './tax-close.service';
import { FinancialResultService } from './financial-result.service';
import { ClosingEntryService } from './closing-entry.service';
import { PeriodLockService } from './period-lock.service';
import { PeriodReopenService } from './period-reopen.service';
import { CloseSnapshotService } from './close-snapshot.service';
import { CloseHealthService } from './close-health.service';
import { CloseReportingService } from './close-reporting.service';

import { PeriodCloseController } from './period-close.controller';

/**
 * Financial Period Close Orchestrator (docx spec Phase 22). See
 * docs/MONTH_CLOSE.md. Not a `DocumentFrameworkModule` participant — a
 * close run is an orchestration/state-machine entity, not a
 * `DocumentPostingService`-postable document (spec section 26's own
 * `CloseableSubledger` contract is realized by
 * `PeriodCloseStepExecutor` calling each subledger's OWN existing
 * service directly instead). Imports every subledger module whose
 * authoritative close operation it orchestrates, per spec section 2's
 * own "Month Close bu engine-ləri duplicate etmir."
 */
@Module({
  imports: [
    AuditModule,
    OrgStructureModule,
    AccountingCoreModule,
    CurrencyModule,
    PeriodModule,
    TaxEngineModule,
    FixedAssetModule,
    ExpenseModule,
    PayrollModule,
    InventoryCostingModule,
    ManufacturingModule,
    SettlementModule,
    TreasuryModule,
    CashModule,
  ],
  controllers: [PeriodCloseController],
  providers: [
    FinancialPeriodService,
    PeriodClosePolicyService,
    CloseDependencyGraphService,
    PeriodReadinessService,
    PeriodCloseStepExecutor,
    PeriodCloseOrchestrator,
    CloseIssueService,
    CloseReconciliationService,
    FXRevaluationService,
    AccrualService,
    DeferredRevenueService,
    TaxCloseService,
    FinancialResultService,
    ClosingEntryService,
    PeriodLockService,
    PeriodReopenService,
    CloseSnapshotService,
    CloseHealthService,
    CloseReportingService,
  ],
  exports: [FinancialPeriodService, PeriodCloseOrchestrator, FinancialResultService],
})
export class PeriodCloseModule {}
