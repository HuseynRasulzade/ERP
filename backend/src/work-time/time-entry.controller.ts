import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TimeEntryService } from './time-entry.service';
import { CreateManualTimeEntryDto } from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/time-entries')
export class TimeEntryController {
  constructor(private readonly entries: TimeEntryService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_OWN)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.entries.list(tenantId, employmentId, fromDate, toDate);
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post()
  createManual(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateManualTimeEntryDto,
  ) {
    return this.entries.createManual(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('generate-from-attendance')
  generateFromAttendance(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.entries.generateFromAttendance(
      tenantId,
      employmentId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('generate-from-leave-absence')
  generateFromLeaveAbsence(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.entries.generateFromLeaveAbsence(
      tenantId,
      employmentId,
      fromDate,
      toDate,
    );
  }
}
