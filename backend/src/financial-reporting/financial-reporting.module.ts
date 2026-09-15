import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { CurrencyModule } from '../currency/currency.module';
import { SettlementModule } from '../settlement/settlement.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { PeriodCloseModule } from '../period-close/period-close.module';

import { FinancialReportingFrameworkService } from './financial-reporting-framework.service';
import { FinancialStatementDefinitionService } from './financial-statement-definition.service';
import { FinancialReportMappingService } from './financial-report-mapping.service';
import { FinancialReportFormulaService } from './financial-report-formula.service';
import { RowAmountResolverService } from './row-amount-resolver.service';
import { TrialBalanceReportingService } from './trial-balance-reporting.service';
import { BalanceSheetService } from './balance-sheet.service';
import { ProfitLossService } from './profit-loss.service';
import { CashFlowService } from './cash-flow.service';
import { EquityStatementService } from './equity-statement.service';
import { ComparativeReportingService } from './comparative-reporting.service';
import { FinancialTranslationService } from './financial-translation.service';
import { FinancialReportValidationService } from './financial-report-validation.service';
import { FinancialReportDrilldownService } from './financial-report-drilldown.service';
import { SupportingScheduleService } from './supporting-schedule.service';
import { FinancialReportVersionService } from './financial-report-version.service';
import { FinancialReportExportService } from './financial-report-export.service';
import { FinancialReportingHealthService } from './financial-reporting-health.service';

import { FinancialReportingController } from './financial-reporting.controller';

/**
 * Financial Reporting Semantic Layer / Report Mapping Engine /
 * Financial Statement Engine (docx spec Phase 23). See
 * docs/FINANCIAL_REPORTING.md. Imports `PeriodCloseModule` for
 * close-version awareness (Phase 22 `FinancialPeriod`/`PeriodCloseRun`/
 * `FinancialResultService`) and `SettlementModule`/
 * `InventoryCostingModule` for supporting-schedule reuse — never a
 * second accounting balance source (spec section 131).
 */
@Module({
  imports: [AuditModule, OrgStructureModule, AccountingCoreModule, CurrencyModule, SettlementModule, InventoryCostingModule, PeriodCloseModule],
  controllers: [FinancialReportingController],
  providers: [
    FinancialReportingFrameworkService,
    FinancialStatementDefinitionService,
    FinancialReportMappingService,
    FinancialReportFormulaService,
    RowAmountResolverService,
    TrialBalanceReportingService,
    BalanceSheetService,
    ProfitLossService,
    CashFlowService,
    EquityStatementService,
    ComparativeReportingService,
    FinancialTranslationService,
    FinancialReportValidationService,
    FinancialReportDrilldownService,
    SupportingScheduleService,
    FinancialReportVersionService,
    FinancialReportExportService,
    FinancialReportingHealthService,
  ],
  exports: [FinancialReportVersionService, FinancialReportMappingService, FinancialReportFormulaService],
})
export class FinancialReportingModule {}
