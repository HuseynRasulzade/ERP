import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { PeriodCloseModule } from '../period-close/period-close.module';
import { FinancialReportingModule } from '../financial-reporting/financial-reporting.module';

import { ManagementMeasureService } from './management-measure.service';
import { ManagementSemanticModelService } from './management-semantic-model.service';
import { KPIService } from './kpi.service';
import { ManagementAllocationService } from './management-allocation.service';
import { ProfitabilityService } from './profitability.service';
import { CostCenterProjectService } from './cost-center-project.service';
import { ManagementPnLService } from './management-pnl.service';
import { WorkingCapitalAnalyticsService } from './working-capital-kpi.service';
import { TreasuryKPIService } from './treasury-kpi.service';
import { ProductionKPIService } from './production-kpi.service';
import { WorkforceAnalyticsService } from './workforce-kpi.service';
import { SalesProcurementKPIService } from './sales-procurement-kpi.service';
import { BudgetService } from './budget.service';
import { ForecastService } from './forecast.service';
import { ScenarioService } from './scenario.service';
import { VarianceAnalysisService } from './variance-analysis.service';
import { ManagementSnapshotService } from './management-snapshot.service';
import { DashboardService } from './dashboard.service';
import { ManagementDrillthroughService } from './management-drillthrough.service';
import { ManagementAlertService } from './management-alert.service';
import { ManagementReportingHealthService } from './management-reporting-health.service';

import { ManagementReportingController } from './management-reporting.controller';

/**
 * Management Reporting / KPI Engine / Profitability Engine /
 * Budget-Forecast-Scenario / Dashboard Platform (docx spec Phase 24).
 * See docs/MANAGEMENT_REPORTING.md. Imports `FinancialReportingModule`
 * for the shared formula engine and Phase 23's own financial-result
 * bridge, and `PeriodCloseModule` for close-version awareness — never a
 * second accounting/costing engine (spec section 2).
 */
@Module({
  imports: [AuditModule, OrgStructureModule, AccountingCoreModule, InventoryCostingModule, TreasuryModule, PeriodCloseModule, FinancialReportingModule],
  controllers: [ManagementReportingController],
  providers: [
    ManagementMeasureService,
    ManagementSemanticModelService,
    KPIService,
    ManagementAllocationService,
    ProfitabilityService,
    CostCenterProjectService,
    ManagementPnLService,
    WorkingCapitalAnalyticsService,
    TreasuryKPIService,
    ProductionKPIService,
    WorkforceAnalyticsService,
    SalesProcurementKPIService,
    BudgetService,
    ForecastService,
    ScenarioService,
    VarianceAnalysisService,
    ManagementSnapshotService,
    DashboardService,
    ManagementDrillthroughService,
    ManagementAlertService,
    ManagementReportingHealthService,
  ],
  exports: [ManagementMeasureService, ManagementSemanticModelService],
})
export class ManagementReportingModule {}
