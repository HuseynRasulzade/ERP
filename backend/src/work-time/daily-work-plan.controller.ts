import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DailyWorkPlanService } from './daily-work-plan.service';
import { GenerateDailyPlanDto } from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/plans')
export class DailyWorkPlanController {
  constructor(private readonly plans: DailyWorkPlanService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.plans.list(tenantId, employmentId, fromDate, toDate);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post('generate')
  generate(
    @CurrentTenantId() tenantId: string,
    @Body() dto: GenerateDailyPlanDto,
  ) {
    return this.plans.generate(tenantId, dto);
  }
}
