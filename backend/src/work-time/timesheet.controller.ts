import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TimesheetService } from './timesheet.service';
import {
  ApproveTimesheetDto,
  GenerateTimesheetDto,
  LockTimesheetDto,
  ReopenTimesheetDto,
  SubmitTimesheetDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/work-time/timesheets')
export class TimesheetController {
  constructor(private readonly timesheets: TimesheetService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.timesheets.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.timesheets.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_CREATE)
  @Post('generate')
  generate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: GenerateTimesheetDto,
  ) {
    dto.organizationId = organizationId;
    return this.timesheets.generate(tenantId, membershipId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_EDIT)
  @Post(':id/submit')
  submit(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SubmitTimesheetDto,
  ) {
    return this.timesheets.submit(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApproveTimesheetDto,
  ) {
    return this.timesheets.approve(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_LOCK)
  @Post(':id/lock')
  lock(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: LockTimesheetDto,
  ) {
    return this.timesheets.lock(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_REOPEN)
  @Post(':id/reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReopenTimesheetDto,
  ) {
    return this.timesheets.reopen(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
