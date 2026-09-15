import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PayrollRateBracketService } from './payroll-rate-bracket.service';
import { PayrollDefinitionsService } from './payroll-definitions.service';
import { EmployeeCompensationService } from './employee-compensation.service';
import { EmployeeTaxProfileService } from './employee-tax-profile.service';
import { PayrollVariableInputService } from './payroll-variable-input.service';
import { PayrollExecutionOrderService } from './payroll-execution-order.service';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollPostingService } from './payroll-posting.service';
import { PayrollLiabilityService } from './payroll-liability.service';
import { PayrollRecalculationService } from './payroll-recalculation.service';
import { PayrollCloseService } from './payroll-close.service';
import { PayrollReportingService } from './payroll-reporting.service';
import {
  CreateRateBracketDto,
  CreateEarningDefinitionDto,
  CreateDeductionDefinitionDto,
  AssignCompensationDto,
  AssignTaxProfileDto,
  CreateVariableInputDto,
  CreateExecutionOrderDto,
  OpenPayrollPeriodDto,
  ReopenPayrollPeriodDto,
  CalculatePayrollDto,
  AllocatePaymentDto,
  FlagRecalculationDto,
} from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Payroll / Gross-to-Net API (docx spec Phase 19). See docs/PAYROLL.md. */
@Controller('organizations/:organizationId/payroll')
export class PayrollController {
  constructor(
    private readonly brackets: PayrollRateBracketService,
    private readonly definitions: PayrollDefinitionsService,
    private readonly compensation: EmployeeCompensationService,
    private readonly taxProfiles: EmployeeTaxProfileService,
    private readonly variableInputs: PayrollVariableInputService,
    private readonly executionOrders: PayrollExecutionOrderService,
    private readonly periods: PayrollPeriodService,
    private readonly calculation: PayrollCalculationService,
    private readonly posting: PayrollPostingService,
    private readonly liabilities: PayrollLiabilityService,
    private readonly recalculation: PayrollRecalculationService,
    private readonly close: PayrollCloseService,
    private readonly reporting: PayrollReportingService,
  ) {}

  // --- Configuration ---
  @RequirePermissions(PermissionCodes.PAYROLL_CONFIG_EDIT)
  @Post('config/seed-azerbaijan-2026')
  seedAz2026(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }) {
    return this.brackets.seedAzerbaijan2026(tenantId, user.userId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CONFIG_EDIT)
  @Post('config/seed-definitions')
  seedDefinitions(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }) {
    return this.definitions.seedDefaults(tenantId, user.userId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CONFIG_EDIT)
  @Post('config/rate-brackets')
  createBracket(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateRateBracketDto) {
    return this.brackets.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('config/rate-brackets')
  listBrackets(@CurrentTenantId() tenantId: string, @Query('bracketType') bracketType?: string) {
    return this.brackets.list(tenantId, bracketType);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CONFIG_EDIT)
  @Post('config/earning-definitions')
  createEarningDef(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateEarningDefinitionDto) {
    return this.definitions.createEarning(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CONFIG_EDIT)
  @Post('config/deduction-definitions')
  createDeductionDef(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateDeductionDefinitionDto) {
    return this.definitions.createDeduction(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('config/earning-definitions')
  listEarningDefs(@CurrentTenantId() tenantId: string) {
    return this.definitions.listEarnings(tenantId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('config/deduction-definitions')
  listDeductionDefs(@CurrentTenantId() tenantId: string) {
    return this.definitions.listDeductions(tenantId);
  }

  // --- Compensation / tax profile ---
  @RequirePermissions(PermissionCodes.PAYROLL_COMPENSATION_EDIT)
  @Post('compensation')
  assignCompensation(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: AssignCompensationDto) {
    return this.compensation.assign(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('employments/:employmentId/compensation')
  compensationHistory(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string) {
    return this.compensation.history(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_TAX_PROFILE_EDIT)
  @Post('tax-profiles')
  assignTaxProfile(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: AssignTaxProfileDto) {
    return this.taxProfiles.assign(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('employments/:employmentId/tax-profiles')
  taxProfileHistory(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string) {
    return this.taxProfiles.history(tenantId, employmentId);
  }

  // --- Variable inputs / execution orders ---
  @RequirePermissions(PermissionCodes.PAYROLL_VARIABLE_INPUT_CREATE)
  @Post('variable-inputs')
  createVariableInput(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateVariableInputDto) {
    return this.variableInputs.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('variable-inputs')
  listVariableInputs(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId?: string) {
    return this.variableInputs.list(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_EXECUTION_ORDER_EDIT)
  @Post('execution-orders')
  createExecutionOrder(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateExecutionOrderDto) {
    return this.executionOrders.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('execution-orders')
  listExecutionOrders(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId?: string) {
    return this.executionOrders.list(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('employments/:employmentId/carry-forward-balances')
  carryForwardBalances(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string) {
    return this.executionOrders.outstandingCarryForward(tenantId, employmentId);
  }

  // --- Periods ---
  @RequirePermissions(PermissionCodes.PAYROLL_PERIOD_MANAGE)
  @Post('periods')
  openPeriod(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: OpenPayrollPeriodDto) {
    return this.periods.open(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_APPROVE)
  @Post('periods/:id/approve')
  approvePeriod(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.periods.approve(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_REOPEN)
  @Post('periods/:id/reopen')
  reopenPeriod(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ReopenPayrollPeriodDto) {
    return this.periods.reopen(tenantId, membershipId, organizationId, user.userId, id, dto.reason);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('periods')
  listPeriods(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.periods.list(tenantId, membershipId, organizationId);
  }

  // --- Calculation ---
  @RequirePermissions(PermissionCodes.PAYROLL_CALCULATE)
  @Post('periods/:id/calculate')
  calculate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CalculatePayrollDto) {
    return this.calculation.calculate(tenantId, membershipId, organizationId, user.userId, id, dto.runType, dto.regime);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('periods/:id/results')
  listResults(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.calculation.listResults(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('results/:resultId')
  getResult(@CurrentTenantId() tenantId: string, @Param('resultId') resultId: string) {
    return this.calculation.getResult(tenantId, resultId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('runs/:runId/errors')
  listErrors(@CurrentTenantId() tenantId: string, @Param('runId') runId: string) {
    return this.calculation.listErrors(tenantId, runId);
  }

  // --- Posting ---
  @RequirePermissions(PermissionCodes.PAYROLL_POST)
  @Post('runs/:runId/post')
  postRun(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('runId') runId: string, @CurrentUser() user: { userId: string }) {
    return this.posting.post(tenantId, membershipId, organizationId, user.userId, runId);
  }

  // --- Liabilities / payslip ---
  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('liabilities')
  listLiabilities(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('employmentId') employmentId?: string, @Query('liabilityType') liabilityType?: string) {
    return this.liabilities.list(tenantId, membershipId, organizationId, employmentId, liabilityType);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_LIABILITY_MANAGE)
  @Post('liabilities/:id/allocate')
  allocatePayment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: AllocatePaymentDto) {
    return this.liabilities.allocate(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_LIABILITY_MANAGE)
  @Post('allocations/:id/reverse')
  reverseAllocation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.liabilities.reverseAllocation(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_PAYSLIP)
  @Get('employments/:employmentId/payslip/:periodId')
  payslip(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('employmentId') employmentId: string, @Param('periodId') periodId: string) {
    return this.liabilities.payslip(tenantId, membershipId, organizationId, employmentId, periodId);
  }

  // --- Recalculation ---
  @RequirePermissions(PermissionCodes.PAYROLL_RECALCULATION_MANAGE)
  @Post('recalculation-requests')
  flagRecalculation(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: FlagRecalculationDto) {
    return this.recalculation.flag(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_RECALCULATION_MANAGE)
  @Post('recalculation-requests/:id/resolve')
  resolveRecalculation(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.recalculation.resolve(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('recalculation-requests')
  pendingRecalculations(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.recalculation.pending(tenantId, organizationId);
  }

  // --- Close ---
  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('periods/:id/close-checks')
  closeChecks(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.close.runChecks(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CLOSE)
  @Post('periods/:id/close')
  closePeriod(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.close.close(tenantId, membershipId, organizationId, user.userId, id);
  }

  // --- Reports ---
  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_STATUTORY_REPORT)
  @Get('periods/:id/reports/statutory')
  statutoryReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reporting.statutoryReport(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('periods/:id/reports/employer-cost')
  employerCostReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reporting.employerCostReport(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('periods/:id/reports/by-department')
  analyticsByDepartment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reporting.analyticsByDepartment(tenantId, membershipId, organizationId, id);
  }
}
