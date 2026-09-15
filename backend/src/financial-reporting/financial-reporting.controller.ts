import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FinancialReportingFrameworkService } from './financial-reporting-framework.service';
import { FinancialStatementDefinitionService } from './financial-statement-definition.service';
import { FinancialReportMappingService } from './financial-report-mapping.service';
import { TrialBalanceReportingService } from './trial-balance-reporting.service';
import { BalanceSheetService } from './balance-sheet.service';
import { ProfitLossService } from './profit-loss.service';
import { CashFlowService } from './cash-flow.service';
import { EquityStatementService } from './equity-statement.service';
import { FinancialReportVersionService } from './financial-report-version.service';
import { FinancialReportDrilldownService } from './financial-report-drilldown.service';
import { FinancialReportExportService } from './financial-report-export.service';
import { FinancialReportingHealthService } from './financial-reporting-health.service';
import { SupportingScheduleService } from './supporting-schedule.service';
import {
  CreateFrameworkDto,
  CreateFrameworkVersionDto,
  CreateStatementDefinitionDto,
  CreateStatementVersionDto,
  AddRowDto,
  CreateMappingDto,
  CreateReportRunDto,
  SignReportDto,
  RestateReportDto,
  TrialBalanceRunDto,
  BalanceSheetRunDto,
  ProfitLossRunDto,
  CashFlowRunDto,
  CreateEquityComponentDto,
} from './dto/financial-reporting.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Financial Reporting Semantic Layer / Report Mapping Engine /
 * Financial Statement Engine API (docx spec Phase 23). See
 * docs/FINANCIAL_REPORTING.md. */
@Controller('organizations/:organizationId/financial-reports')
export class FinancialReportingController {
  constructor(
    private readonly frameworks: FinancialReportingFrameworkService,
    private readonly statementDefinitions: FinancialStatementDefinitionService,
    private readonly mappings: FinancialReportMappingService,
    private readonly trialBalance: TrialBalanceReportingService,
    private readonly balanceSheet: BalanceSheetService,
    private readonly profitLoss: ProfitLossService,
    private readonly cashFlow: CashFlowService,
    private readonly equity: EquityStatementService,
    private readonly runs: FinancialReportVersionService,
    private readonly drilldown: FinancialReportDrilldownService,
    private readonly exportService: FinancialReportExportService,
    private readonly health: FinancialReportingHealthService,
    private readonly schedules: SupportingScheduleService,
  ) {}

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_VIEW)
  @Get('frameworks')
  listFrameworks(@CurrentTenantId() tenantId: string) {
    return this.frameworks.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_EDIT)
  @Post('frameworks')
  createFramework(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFrameworkDto) {
    return this.frameworks.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_EDIT)
  @Post('frameworks/:id/versions')
  createFrameworkVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFrameworkVersionDto) {
    return this.frameworks.createVersion(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_APPROVE)
  @Post('framework-versions/:id/activate')
  activateFrameworkVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.frameworks.activate(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_VIEW)
  @Get('statements')
  listStatements(@CurrentTenantId() tenantId: string) {
    return this.statementDefinitions.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_EDIT)
  @Post('statements')
  createStatement(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateStatementDefinitionDto) {
    return this.statementDefinitions.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_EDIT)
  @Post('statements/:id/versions')
  createStatementVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateStatementVersionDto) {
    return this.statementDefinitions.createVersion(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_EDIT)
  @Post('statement-versions/:id/rows')
  addRow(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Body() dto: AddRowDto) {
    return this.statementDefinitions.addRow(tenantId, id, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_APPROVE)
  @Post('statement-versions/:id/activate')
  activateStatementVersion(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.statementDefinitions.activateVersion(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_VIEW)
  @Get('mappings')
  listMappings(@CurrentTenantId() tenantId: string, @Query('statementVersionId') statementVersionId: string) {
    return this.mappings.list(tenantId, statementVersionId);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_EDIT)
  @Post('mappings')
  createMapping(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateMappingDto) {
    return this.mappings.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_APPROVE)
  @Post('mappings/:id/approve')
  approveMapping(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.mappings.approve(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_MAPPING_VIEW)
  @Get('mappings/coverage')
  mappingCoverage(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('statementVersionId') statementVersionId: string, @Query('asOfDate') asOfDate: string) {
    return this.mappings.coverage(tenantId, organizationId, statementVersionId, new Date(asOfDate));
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_TRIAL_BALANCE)
  @Post('trial-balance/run')
  runTrialBalance(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Body() dto: TrialBalanceRunDto) {
    return this.trialBalance.run(tenantId, membershipId, organizationId, new Date(dto.periodStart), new Date(dto.periodEnd), dto.accountId);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_BALANCE_SHEET)
  @Post('balance-sheet/run')
  runBalanceSheet(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Body() dto: BalanceSheetRunDto) {
    return this.balanceSheet.run(tenantId, organizationId, dto.statementVersionId, new Date(dto.asOfDate));
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_PNL)
  @Post('pnl/run')
  runProfitLoss(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Body() dto: ProfitLossRunDto) {
    return this.profitLoss.run(tenantId, organizationId, dto.statementVersionId, new Date(dto.periodStart), new Date(dto.periodEnd));
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_CASH_FLOW)
  @Post('cash-flow/run')
  runCashFlow(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Body() dto: CashFlowRunDto) {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    return dto.method === 'INDIRECT' ? this.cashFlow.indirectMethod(tenantId, organizationId, periodStart, periodEnd) : this.cashFlow.directMethod(tenantId, organizationId, periodStart, periodEnd);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_EQUITY)
  @Post('equity/run')
  runEquity(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Body() dto: { periodStart: string; periodEnd: string }) {
    return this.equity.run(tenantId, organizationId, new Date(dto.periodStart), new Date(dto.periodEnd));
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_EQUITY)
  @Post('equity-components')
  createEquityComponent(@CurrentTenantId() tenantId: string, @Body() dto: CreateEquityComponentDto) {
    return this.equity.createComponent(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_GENERATE)
  @Post('runs')
  createRun(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateReportRunDto) {
    return this.runs.create(tenantId, user.userId, { organizationId, ...dto });
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_VIEW)
  @Get('runs/:id')
  getRun(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.runs.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_DRILLDOWN)
  @Get('runs/:id/drilldown')
  drilldownCell(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Query('rowCode') rowCode: string) {
    return this.drilldown.explainCell(tenantId, id, rowCode);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_VIEW)
  @Get('runs/:id/validations')
  getValidations(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.runs.get(tenantId, id).then((r) => r.validationResults);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_GENERATE)
  @Post('runs/:id/review')
  reviewRun(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.runs.review(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_APPROVE)
  @Post('runs/:id/approve')
  approveRun(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.runs.approve(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_FINALIZE)
  @Post('runs/:id/finalize')
  finalizeRun(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.runs.finalize(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_SIGN)
  @Post('runs/:id/sign')
  signRun(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: SignReportDto) {
    return this.runs.sign(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_RESTATE)
  @Post('runs/:id/restate')
  restateRun(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: RestateReportDto) {
    return this.runs.restate(tenantId, user.userId, id, dto.reason, dto.newCloseRunId);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_EXPORT)
  @Get('runs/:id/export')
  async exportRun(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Query('format') format?: string) {
    await this.exportService.assertExportable(tenantId, id);
    return format === 'csv' ? { csv: await this.exportService.toCsv(tenantId, id) } : this.exportService.toJson(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_VIEW)
  @Get('health')
  getHealth(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('statementVersionId') statementVersionId?: string) {
    return this.health.check(tenantId, organizationId, statementVersionId);
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_VIEW)
  @Get('schedules/ar-ageing')
  arAgeing(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    return this.schedules.arAgeing(tenantId, organizationId, asOfDate ? new Date(asOfDate) : new Date());
  }

  @RequirePermissions(PermissionCodes.FIN_REPORT_VIEW)
  @Get('schedules/ap-ageing')
  apAgeing(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    return this.schedules.apAgeing(tenantId, organizationId, asOfDate ? new Date(asOfDate) : new Date());
  }
}
