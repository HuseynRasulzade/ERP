import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkTimePeriodService } from './work-time-period.service';
import {
  OpenWorkTimePeriodDto,
  ReopenWorkTimePeriodDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/work-time/periods')
export class WorkTimePeriodController {
  constructor(private readonly periods: WorkTimePeriodService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.periods.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_LOCK)
  @Post()
  open(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: OpenWorkTimePeriodDto,
  ) {
    dto.organizationId = organizationId;
    return this.periods.open(tenantId, membershipId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_LOCK)
  @Post(':id/lock')
  lock(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.periods.lock(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
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
    @Body() dto: ReopenWorkTimePeriodDto,
  ) {
    return this.periods.reopen(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      dto,
    );
  }
}
