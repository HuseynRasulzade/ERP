import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkScheduleAssignmentService } from './work-schedule-assignment.service';
import { LeaveRecordService } from './leave-record.service';
import { AbsenceRecordService } from './absence-record.service';
import {
  ApproveLeaveRecordDto,
  AssignWorkScheduleDto,
  CreateAbsenceRecordDto,
  CreateLeaveRecordDto,
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
}
