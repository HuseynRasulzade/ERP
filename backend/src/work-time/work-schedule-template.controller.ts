import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkScheduleTemplateService } from './work-schedule-template.service';
import {
  BulkSetSchedulePatternDto,
  CreateWorkScheduleTemplateDto,
  SetSchedulePatternDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/schedules')
export class WorkScheduleTemplateController {
  constructor(private readonly templates: WorkScheduleTemplateService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.templates.list(tenantId, activeOnly === 'true');
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.templates.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateWorkScheduleTemplateDto,
  ) {
    return this.templates.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post(':id/patterns')
  setPattern(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetSchedulePatternDto,
  ) {
    return this.templates.setPattern(tenantId, id, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post(':id/patterns/bulk')
  bulkSetPattern(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: BulkSetSchedulePatternDto,
  ) {
    return this.templates.bulkSetPattern(tenantId, id, dto);
  }
}
