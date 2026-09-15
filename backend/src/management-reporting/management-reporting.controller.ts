import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ManagementSemanticModelService } from './management-semantic-model.service';
import { ManagementMeasureService } from './management-measure.service';
import { KPIService } from './kpi.service';
import { ProfitabilityService } from './profitability.service';
import { CostCenterProjectService } from './cost-center-project.service';
import { ManagementPnLService } from './management-pnl.service';
import { WorkingCapitalAnalyticsService } from './working-capital-kpi.service';
import { TreasuryKPIService } from './treasury-kpi.service';
import { ProductionKPIService } from './production-kpi.service';
import { WorkforceAnalyticsService } from './workforce-kpi.service';
import { SalesProcurementKPIService } from './sales-procurement-kpi.service';
import { ManagementAllocationService } from './management-allocation.service';
import { BudgetService } from './budget.service';
import { ForecastService } from './forecast.service';
import { ScenarioService } from './scenario.service';
import { VarianceAnalysisService } from './variance-analysis.service';
import { ManagementSnapshotService } from './management-snapshot.service';
import { DashboardService } from './dashboard.service';
import { ManagementDrillthroughService } from './management-drillthrough.service';
import { ManagementAlertService } from './management-alert.service';
import { ManagementReportingHealthService } from './management-reporting-health.service';
import {
  CreateSemanticModelDto,
  CreateSemanticModelVersionDto,
  CreateMeasureDto,
  EvaluateMeasureDto,
  CreateKpiDto,
  SetKpiTargetDto,
  CreateAllocationRuleDto,
  RunAllocationDto,
  CreateBudgetVersionDto,
  UpsertBudgetFactDto,
  CreateForecastVersionDto,
  CreateScenarioDto,
  AddScenarioAssumptionDto,
  CreateSnapshotDto,
  CreateDashboardDto,
  CreateAlertRuleDto,
} from './dto/management-reporting.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Management Reporting / KPI Engine / Profitability Engine /
 * Budget-Forecast-Scenario / Dashboard Platform API (docx spec Phase
 * 24). See docs/MANAGEMENT_REPORTING.md. */
@Controller('organizations/:organizationId/management-reports')
export class ManagementReportingController {
  constructor(
    private readonly semanticModel: ManagementSemanticModelService,
    private readonly measures: ManagementMeasureService,
    private readonly kpi: KPIService,
    private readonly profitability: ProfitabilityService,
    private readonly costCenterProject: CostCenterProjectService,
    private readonly pnl: ManagementPnLService,
    private readonly workingCapital: WorkingCapitalAnalyticsService,
    private readonly treasury: TreasuryKPIService,
    private readonly production: ProductionKPIService,
    private readonly workforce: WorkforceAnalyticsService,
    private readonly salesProcurement: SalesProcurementKPIService,
    private readonly allocation: ManagementAllocationService,
    private readonly budget: BudgetService,
    private readonly forecast: ForecastService,
    private readonly scenario: ScenarioService,
    private readonly variance: VarianceAnalysisService,
    private readonly snapshots: ManagementSnapshotService,
    private readonly dashboards: DashboardService,
    private readonly drillthrough: ManagementDrillthroughService,
    private readonly alerts: ManagementAlertService,
    private readonly health: ManagementReportingHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.MGMT_SEMANTIC_MODEL_EDIT)
  @Post('semantic-models')
  createModel(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateSemanticModelDto) {
    return this.semanticModel.createModel(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_SEMANTIC_MODEL_EDIT)
  @Post('semantic-models/:id/versions')
  createModelVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateSemanticModelVersionDto) {
    return this.semanticModel.createVersion(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_SEMANTIC_MODEL_EDIT)
  @Post('semantic-model-versions/:id/activate')
  activateModelVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.semanticModel.activateVersion(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.MGMT_SEMANTIC_MODEL_EDIT)
  @Post('semantic-model-versions/:id/measures')
  createMeasure(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Body() dto: CreateMeasureDto) {
    return this.semanticModel.createMeasure(tenantId, id, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_KPI_VIEW)
  @Post('measures/evaluate')
  evaluateMeasure(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Body() dto: EvaluateMeasureDto) {
    const mode = dto.modeType === 'AS_OF' ? { type: 'AS_OF' as const, asOfDate: new Date(dto.asOfDate!) } : { type: 'PERIOD' as const, periodStart: new Date(dto.periodStart!), periodEnd: new Date(dto.periodEnd!) };
    return this.semanticModel.resolveMeasure(tenantId, organizationId, dto.semanticModelVersionId, dto.measureCode, mode, { customerId: dto.customerId, productId: dto.productId, departmentId: dto.departmentId });
  }

  @RequirePermissions(PermissionCodes.MGMT_KPI_EDIT)
  @Post('kpis')
  createKpi(@CurrentTenantId() tenantId: string, @Body() dto: CreateKpiDto) {
    return this.kpi.create(tenantId, dto.semanticModelVersionId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_KPI_EDIT)
  @Post('kpis/:code/targets')
  setKpiTarget(@CurrentTenantId() tenantId: string, @Param('code') code: string, @Body() dto: SetKpiTargetDto) {
    return this.kpi.setTargetByCode(tenantId, code, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_KPI_VIEW)
  @Get('kpis/:code')
  async evaluateKpi(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('code') code: string, @Query('period') period: string, @Query('periodStart') periodStart?: string, @Query('periodEnd') periodEnd?: string, @Query('asOfDate') asOfDate?: string, @Query('scenario') scenario?: string) {
    const mode = asOfDate ? { type: 'AS_OF' as const, asOfDate: new Date(asOfDate) } : { type: 'PERIOD' as const, periodStart: new Date(periodStart!), periodEnd: new Date(periodEnd!) };
    return this.kpi.evaluate(tenantId, organizationId, code, mode, period, {}, scenario);
  }

  @RequirePermissions(PermissionCodes.MGMT_CUSTOMER_PROFITABILITY)
  @Get('profitability/customers')
  customerProfitability(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.profitability.byCustomer(tenantId, organizationId, { type: 'PERIOD', periodStart: new Date(periodStart), periodEnd: new Date(periodEnd) });
  }

  @RequirePermissions(PermissionCodes.MGMT_PRODUCT_PROFITABILITY)
  @Get('profitability/products')
  productProfitability(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.profitability.byProduct(tenantId, organizationId, { type: 'PERIOD', periodStart: new Date(periodStart), periodEnd: new Date(periodEnd) });
  }

  @RequirePermissions(PermissionCodes.MGMT_PROFITABILITY_VIEW)
  @Get('profitability/channels')
  channelProfitability() {
    return this.profitability.byChannel();
  }

  @RequirePermissions(PermissionCodes.MGMT_COST_CENTER_VIEW)
  @Get('cost-centers/:id/pnl')
  costCenterPnl(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.costCenterProject.costCenterPnL(tenantId, organizationId, id, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.MGMT_PROJECT_PNL)
  @Get('projects/:id/pnl')
  projectPnl(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.costCenterProject.projectPnL(tenantId, organizationId, id, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.MGMT_WORKING_CAPITAL_VIEW)
  @Get('working-capital')
  workingCapital_(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.workingCapital.calculate(tenantId, organizationId, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.MGMT_PRODUCTION_VIEW)
  @Get('production-kpis/:productionOrderId')
  productionKpis(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('productionOrderId') productionOrderId: string) {
    return this.production.orderKPIs(tenantId, organizationId, productionOrderId);
  }

  @RequirePermissions(PermissionCodes.MGMT_WORKFORCE_COST_VIEW)
  @Get('workforce-kpis/:departmentId')
  workforceKpis(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('departmentId') departmentId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.workforce.departmentCost(tenantId, organizationId, departmentId, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.MGMT_REPORT_VIEW)
  @Get('sales-kpis')
  salesKpis(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.salesProcurement.salesKPIs(tenantId, organizationId, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.MGMT_ALLOCATION_EDIT)
  @Post('allocation-rules')
  createAllocationRule(@CurrentTenantId() tenantId: string, @Body() dto: CreateAllocationRuleDto) {
    return this.allocation.createRule(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_ALLOCATION_EDIT)
  @Post('allocation-rules/:code/run')
  runAllocation(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('code') code: string, @CurrentUser() user: { userId: string }, @Body() dto: RunAllocationDto) {
    return this.allocation.run(tenantId, user.userId, code, organizationId, dto.period, dto.poolAmount, dto.targetKeys);
  }

  @RequirePermissions(PermissionCodes.MGMT_BUDGET_EDIT)
  @Post('budgets')
  createBudgetVersion(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateBudgetVersionDto) {
    return this.budget.createVersion(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_BUDGET_EDIT)
  @Post('budgets/:id/facts')
  upsertBudgetFact(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpsertBudgetFactDto) {
    return this.budget.upsertFact(tenantId, id, dto.expectedRecordVersion, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_BUDGET_APPROVE)
  @Post('budgets/:id/publish')
  publishBudget(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.budget.approve(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.MGMT_FORECAST_EDIT)
  @Post('forecasts')
  createForecast(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateForecastVersionDto) {
    return this.forecast.createVersion(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_SCENARIO_CREATE)
  @Post('scenarios')
  createScenario(@CurrentTenantId() tenantId: string, @Body() dto: CreateScenarioDto) {
    return this.scenario.create(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_SCENARIO_CREATE)
  @Post('scenarios/:code/assumptions')
  addAssumption(@CurrentTenantId() tenantId: string, @Param('code') code: string, @Body() dto: AddScenarioAssumptionDto) {
    return this.scenario.addAssumptionByCode(tenantId, code, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_SNAPSHOT_CREATE)
  @Post('snapshots')
  createSnapshot(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateSnapshotDto) {
    return this.snapshots.create(tenantId, user.userId, { organizationId, ...dto });
  }

  @RequirePermissions(PermissionCodes.MGMT_DASHBOARD_VIEW)
  @Get('dashboards/:id')
  getDashboard(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.dashboards.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.MGMT_SEMANTIC_MODEL_EDIT)
  @Post('dashboards')
  createDashboard(@CurrentTenantId() tenantId: string, @Body() dto: CreateDashboardDto) {
    return this.dashboards.create(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_ALLOCATION_EDIT)
  @Post('alert-rules')
  createAlertRule(@CurrentTenantId() tenantId: string, @Body() dto: CreateAlertRuleDto) {
    return this.alerts.createRule(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.MGMT_REPORT_VIEW)
  @Get('alerts')
  listAlerts(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('period') period?: string) {
    return this.alerts.list(tenantId, organizationId, period);
  }

  @RequirePermissions(PermissionCodes.MGMT_REPORT_VIEW)
  @Get('health')
  getHealth(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.health.check(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.MGMT_KPI_VIEW)
  @Get('drillthrough/explain')
  explainMeasure(@Query('measureCode') measureCode: string, @Query('modeType') modeType: string, @Query() filters: Record<string, unknown>) {
    return this.drillthrough.explainMeasure(measureCode, { type: modeType }, filters);
  }

}
