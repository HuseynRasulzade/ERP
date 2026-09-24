import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes as P } from '../rbac/permission-codes';
import { AmendContractDto, CreateAbsenceDto, CreateBusinessTripDto, CreateContractDto, CreateLeaveDto, ReturnToWorkDto, ScheduleChangeDto, SuspendDto } from './dto/hr.dto';
import { HrCtx, HrRequestContext } from './hr-context.decorator';
import { parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrHistoryService } from './hr-history.service';
import { HrValidationService } from './hr-validation.service';
import { EmploymentService, WorkScheduleAssignmentService } from './employment.service';
import { EmploymentContractService } from './employment-contract.service';
import { AbsenceService, LeaveFoundationService } from './leave-foundation.service';

class SecondaryAssignmentDto {
  @IsUUID() departmentId!: string;
  @IsUUID() positionId!: string;
  @IsNumber() @Min(0.01) @Max(1) fte!: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() reason?: string;
}

/** Employments, as-of state, history, schedule/suspension events, contracts,
 * leave / absence / business-trip foundation (spec 8-12, 32-42, 51, 112). */
@Controller('hr')
export class HrEmploymentController {
  constructor(
    private readonly employments: EmploymentService,
    private readonly schedules: WorkScheduleAssignmentService,
    private readonly history: HrHistoryService,
    private readonly validation: HrValidationService,
    private readonly contracts: EmploymentContractService,
    private readonly leaves: LeaveFoundationService,
    private readonly absences: AbsenceService,
  ) {}

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employments')
  list(
    @HrCtx() c: HrRequestContext,
    @Query('organizationId') organizationId?: string,
    @Query('asOf') asOf?: string,
    @Query('status') status?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('employeeId') employeeId?: string,
    @Query('search') search?: string,
  ) {
    return this.employments.list(c.tenantId, c.membershipId, { organizationId, asOf, status, includeInactive, employeeId, search });
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employments/:id')
  get(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.employments.getCard(c.tenantId, c.membershipId, id, asOf);
  }

  /** getEmploymentState(employmentId, asOfDate) — spec 51. */
  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employments/:id/state')
  async state(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Query('asOf') asOf?: string) {
    await this.employments.assertAccess(c.tenantId, c.membershipId, id);
    return this.history.getEmploymentState(c.tenantId, id, parseOptionalHrDate(asOf, 'asOf') ?? todayHr());
  }

  /** Effective segments over a period — the payroll/time contract. */
  @RequirePermissions(P.HR_VIEW_HISTORY)
  @Get('employments/:id/segments')
  async segments(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    await this.employments.assertAccess(c.tenantId, c.membershipId, id);
    return this.history.getEffectiveSegments(c.tenantId, id, parseHrDate(from, 'from'), parseHrDate(to, 'to'));
  }

  @RequirePermissions(P.HR_VIEW_HISTORY)
  @Get('history/:employmentId')
  async historyOf(@HrCtx() c: HrRequestContext, @Param('employmentId') id: string) {
    await this.employments.assertAccess(c.tenantId, c.membershipId, id);
    return this.history.getHistory(c.tenantId, id);
  }

  @RequirePermissions(P.HR_VIEW_HISTORY)
  @Get('employments-in-period')
  async inPeriod(@HrCtx() c: HrRequestContext, @Query('from') from: string, @Query('to') to: string, @Query('organizationId') organizationId?: string) {
    const organizationIds = await this.employments.accessibleOrgIds(c.tenantId, c.membershipId, organizationId);
    return this.history.getEmploymentsInPeriod(c.tenantId, { organizationIds, from: parseHrDate(from, 'from'), to: parseHrDate(to, 'to') });
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employments/:id/schedule-assignments')
  async scheduleAssignments(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    await this.employments.assertAccess(c.tenantId, c.membershipId, id);
    return this.schedules.list(c.tenantId, id);
  }

  @RequirePermissions(P.HR_EMPLOYMENT_CREATE)
  @Post('employments/:id/schedule-changes')
  changeSchedule(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: ScheduleChangeDto) {
    return this.schedules.changeSchedule(c.tenantId, c.membershipId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_EMPLOYMENT_CREATE)
  @Post('employments/:id/suspend')
  suspend(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: SuspendDto) {
    return this.employments.suspend(c.tenantId, c.membershipId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_EMPLOYMENT_CREATE)
  @Post('employments/:id/return-to-work')
  returnToWork(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: ReturnToWorkDto) {
    return this.employments.returnToWork(c.tenantId, c.membershipId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_TRANSFER_POST)
  @Post('employments/:id/secondary-assignments')
  secondary(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: SecondaryAssignmentDto) {
    return this.employments.addSecondaryAssignment(c.tenantId, c.membershipId, c.userId, id, dto, this.validation);
  }

  // ------------------------------------------------------------ contracts

  @RequirePermissions(P.HR_CONTRACT_VIEW)
  @Get('contracts')
  listContracts(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('employeeId') employeeId?: string, @Query('employmentId') employmentId?: string, @Query('status') status?: string) {
    return this.contracts.list(c.tenantId, c.membershipId, { organizationId, employeeId, employmentId, status });
  }

  @RequirePermissions(P.HR_CONTRACT_EDIT)
  @Post('contracts')
  createContract(@HrCtx() c: HrRequestContext, @Body() dto: CreateContractDto) {
    return this.contracts.create(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_CONTRACT_VIEW)
  @Get('contracts/:id')
  getContract(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.contracts.get(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_CONTRACT_VIEW)
  @Get('contracts/:id/version')
  contractVersion(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Query('asOf') asOf: string) {
    return this.contracts.getVersionAsOf(c.tenantId, c.membershipId, id, asOf);
  }

  @RequirePermissions(P.HR_CONTRACT_EDIT)
  @Post('contracts/:id/amendments')
  amend(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: AmendContractDto) {
    return this.contracts.amend(c.tenantId, c.membershipId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_CONTRACT_EDIT)
  @Post('contracts/:id/sign')
  sign(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.contracts.sign(c.tenantId, c.membershipId, c.userId, id);
  }

  @RequirePermissions(P.HR_CONTRACT_EDIT)
  @Post('contracts/:id/cancel')
  cancelContract(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.contracts.cancel(c.tenantId, c.membershipId, c.userId, id);
  }

  // ------------------------------------------------------------ leave / absence / trips

  @RequirePermissions(P.HR_LEAVE_VIEW)
  @Get('leaves')
  listLeaves(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('employmentId') employmentId?: string, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.leaves.list(c.tenantId, c.membershipId, { organizationId, employmentId, status, from, to });
  }

  @RequirePermissions(P.HR_LEAVE_MANAGE)
  @Post('leaves')
  createLeave(@HrCtx() c: HrRequestContext, @Body() dto: CreateLeaveDto) {
    return this.leaves.create(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_LEAVE_MANAGE)
  @Post('leaves/:id/approve')
  approveLeave(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.leaves.approve(c.tenantId, c.membershipId, c.userId, id);
  }

  @RequirePermissions(P.HR_LEAVE_MANAGE)
  @Post('leaves/:id/reject')
  rejectLeave(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.leaves.setStatus(c.tenantId, c.membershipId, c.userId, id, 'REJECTED');
  }

  @RequirePermissions(P.HR_LEAVE_MANAGE)
  @Post('leaves/:id/cancel')
  cancelLeave(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.leaves.setStatus(c.tenantId, c.membershipId, c.userId, id, 'CANCELLED');
  }

  @RequirePermissions(P.HR_ABSENCE_VIEW)
  @Get('absences')
  listAbsences(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('employmentId') employmentId?: string, @Query('status') status?: string) {
    return this.absences.list(c.tenantId, c.membershipId, { organizationId, employmentId, status });
  }

  @RequirePermissions(P.HR_ABSENCE_MANAGE)
  @Post('absences')
  createAbsence(@HrCtx() c: HrRequestContext, @Body() dto: CreateAbsenceDto) {
    return this.absences.create(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_ABSENCE_MANAGE)
  @Post('absences/:id/cancel')
  cancelAbsence(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.absences.cancel(c.tenantId, c.membershipId, c.userId, id);
  }

  @RequirePermissions(P.HR_LEAVE_VIEW)
  @Get('business-trips')
  listTrips(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('employmentId') employmentId?: string) {
    return this.absences.listTrips(c.tenantId, c.membershipId, { organizationId, employmentId });
  }

  @RequirePermissions(P.HR_LEAVE_MANAGE)
  @Post('business-trips')
  createTrip(@HrCtx() c: HrRequestContext, @Body() dto: CreateBusinessTripDto) {
    return this.absences.createTrip(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_LEAVE_MANAGE)
  @Post('business-trips/:id/:action(approve|complete|cancel)')
  tripStatus(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Param('action') action: string) {
    const status = action === 'approve' ? 'APPROVED' : action === 'complete' ? 'COMPLETED' : 'CANCELLED';
    return this.absences.setTripStatus(c.tenantId, c.membershipId, c.userId, id, status);
  }
}
