import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PeriodReopenRequestService } from './period-reopen-request.service';
import { CreatePeriodReopenRequestDto, DecidePeriodReopenRequestDto } from './dto/period.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('period-reopen-requests')
export class PeriodReopenRequestController {
  constructor(private readonly requests: PeriodReopenRequestService) {}

  @RequirePermissions(PermissionCodes.PERIODS_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('periodId') periodId?: string) {
    return this.requests.list(tenantId, periodId);
  }

  @RequirePermissions(PermissionCodes.PERIODS_REOPEN_REQUEST)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreatePeriodReopenRequestDto) {
    return this.requests.request(tenantId, dto.periodId, user.userId, dto.reason);
  }

  @RequirePermissions(PermissionCodes.PERIODS_REOPEN)
  @Post(':id/approve')
  approve(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: DecidePeriodReopenRequestDto) {
    return this.requests.approve(tenantId, id, user.userId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.PERIODS_REOPEN)
  @Post(':id/reject')
  reject(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: DecidePeriodReopenRequestDto) {
    return this.requests.reject(tenantId, id, user.userId, dto.comment);
  }
}
