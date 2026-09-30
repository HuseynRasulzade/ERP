import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkScheduleAssignmentService } from './work-schedule-assignment.service';
import { LeaveRecordService } from './leave-record.service';
import { AbsenceRecordService } from './absence-record.service';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveAccrualRunService } from './leave-accrual-run.service';
import {
  ApproveLeaveRecordDto,
  AssignWorkScheduleDto,
  CreateAbsenceRecordDto,
  CreateLeaveRecordDto,
  RunLeaveAccrualDto,
  UpsertLeavePolicyDto,
} from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/hr')
export class HrTimeOffController {
  constructor(
    private readonly workSchedules: WorkScheduleAssignmentService,
    private readonly leaves: LeaveRecordService,
    private readonly absences: AbsenceRecordService,
    private readonly leavePolicies: LeavePolicyService,
    private readonly leaveBalances: LeaveBalanceService,
    private readonly leaveAccrualRuns: LeaveAccrualRunService,
  ) {}

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('employments/:employmentId/work-schedule-assignments')
  listWorkSchedules(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('employmentId') employmentId: string,
  ) {
    return this.workSchedules.list(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post('work-schedule-assignments')
  assignWorkSchedule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: AssignWorkScheduleDto,
  ) {
    return this.workSchedules.assign(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_VIEW)
  @Get('leave-records')
  listLeaves(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('employmentId') employmentId?: string,
  ) {
    return this.leaves.list(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_CREATE)
  @Post('leave-records')
  createLeave(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateLeaveRecordDto,
  ) {
    return this.leaves.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_CREATE)
  @Post('leave-records/:id/approve')
  approveLeave(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApproveLeaveRecordDto,
  ) {
    return this.leaves.approve(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_ABSENCE_VIEW)
  @Get('absence-records')
  listAbsences(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('employmentId') employmentId?: string,
  ) {
    return this.absences.list(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_ABSENCE_CREATE)
  @Post('absence-records')
  createAbsence(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAbsenceRecordDto,
  ) {
    return this.absences.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_POLICY_VIEW)
  @Get('leave-policies')
  listLeavePolicies(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.leavePolicies.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_POLICY_EDIT)
  @Post('leave-policies')
  upsertLeavePolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpsertLeavePolicyDto,
  ) {
    return this.leavePolicies.upsert(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_BALANCE_VIEW)
  @Get('employments/:employmentId/leave-balance-movements')
  listLeaveBalanceMovements(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('employmentId') employmentId: string,
  ) {
    return this.leaveBalances.listMovements(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_BALANCE_VIEW)
  @Get('employments/:employmentId/leave-balance')
  getLeaveBalance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('employmentId') employmentId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.leaveBalances.getCurrentBalance(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
      asOfDate,
    );
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_ACCRUAL_RUN)
  @Get('leave-accrual-runs')
  listLeaveAccrualRuns(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.leaveAccrualRuns.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_ACCRUAL_RUN)
  @Post('leave-accrual-runs')
  runLeaveAccrual(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: RunLeaveAccrualDto,
  ) {
    return this.leaveAccrualRuns.run(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto.periodYear,
      dto.periodMonth,
    );
  }
}
