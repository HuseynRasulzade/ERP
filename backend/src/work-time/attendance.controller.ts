import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AttendanceEventService } from './attendance-event.service';
import { AttendanceInterpretationService } from './attendance-interpretation.service';
import {
  CreateAttendanceEventDto,
  InterpretAttendanceDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/attendance')
export class AttendanceController {
  constructor(
    private readonly events: AttendanceEventService,
    private readonly interpretation: AttendanceInterpretationService,
  ) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_OWN)
  @Get('events')
  listEvents(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.events.list(tenantId, employmentId, fromDate, toDate);
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_IMPORT)
  @Post('events')
  createEvent(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAttendanceEventDto,
  ) {
    return this.events.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('interpret')
  interpret(
    @CurrentTenantId() tenantId: string,
    @Body() dto: InterpretAttendanceDto,
  ) {
    return this.interpretation.interpret(
      tenantId,
      dto.employmentId,
      dto.fromDate,
      dto.toDate,
    );
  }
}
