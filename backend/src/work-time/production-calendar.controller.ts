import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProductionCalendarService } from './production-calendar.service';
import {
  BulkAddCalendarDaysDto,
  CreateCalendarVersionDto,
  CreateProductionCalendarDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/calendars')
export class ProductionCalendarController {
  constructor(private readonly calendars: ProductionCalendarService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.calendars.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.calendars.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateProductionCalendarDto,
  ) {
    return this.calendars.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post(':id/days')
  bulkAddDays(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: BulkAddCalendarDaysDto,
  ) {
    return this.calendars.bulkAddDays(tenantId, id, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post(':id/new-version')
  createNewVersion(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCalendarVersionDto,
  ) {
    return this.calendars.createNewVersion(tenantId, user.userId, id, dto);
  }
}
