import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ShiftTemplateService } from './shift-template.service';
import { CreateShiftTemplateDto } from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('work-time/shift-templates')
export class ShiftTemplateController {
  constructor(private readonly shifts: ShiftTemplateService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.shifts.list(tenantId, activeOnly === 'true');
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.shifts.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateShiftTemplateDto,
  ) {
    return this.shifts.create(tenantId, dto);
  }
}
