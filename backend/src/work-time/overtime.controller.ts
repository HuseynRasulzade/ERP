import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OvertimeService } from './overtime.service';
import {
  ApproveOvertimeDto,
  CreateOvertimeRequestDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_OWN)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.overtime.list(tenantId, employmentId, fromDate, toDate);
  }

  @RequirePermissions(PermissionCodes.TIME_OVERTIME_CREATE)
  @Post()
  request(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOvertimeRequestDto,
  ) {
    return this.overtime.request(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_OVERTIME_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApproveOvertimeDto,
  ) {
    return this.overtime.approve(tenantId, user.userId, id, dto);
  }
}
