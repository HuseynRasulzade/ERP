import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PeriodService } from './period.service';
import { CreatePeriodDto, ReopenPeriodDto } from './dto/period.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('periods')
export class PeriodController {
  constructor(private readonly periods: PeriodService) {}

  @RequirePermissions(PermissionCodes.PERIODS_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.periods.list(tenantId);
  }

  // Creating a period is period administration, not a read: it is what
  // makes the period guard start governing a month, so it requires the
  // same right as closing one (was periods.view — any viewer could create).
  @RequirePermissions(PermissionCodes.PERIODS_CLOSE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreatePeriodDto) {
    return this.periods.createPeriod(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.PERIODS_CLOSE)
  @Post(':periodId/close')
  close(
    @CurrentTenantId() tenantId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.periods.close(tenantId, periodId, user.userId);
  }

  @RequirePermissions(PermissionCodes.PERIODS_REOPEN)
  @Post(':periodId/reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @Param('periodId') periodId: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.periods.reopen(tenantId, periodId, user.userId, dto.reason);
  }
}
