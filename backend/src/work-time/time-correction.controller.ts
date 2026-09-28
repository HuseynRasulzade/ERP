import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TimeCorrectionService } from './time-correction.service';
import { CreateTimeCorrectionDto } from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/corrections')
export class TimeCorrectionController {
  constructor(private readonly corrections: TimeCorrectionService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_OWN)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
  ) {
    return this.corrections.list(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.TIME_CORRECTION_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTimeCorrectionDto,
  ) {
    return this.corrections.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_CORRECTION_APPROVE)
  @Post(':id/apply')
  apply(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.corrections.apply(tenantId, user.userId, id);
  }
}
