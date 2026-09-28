import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PositionService } from './position.service';
import { CreatePositionDto } from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('hr/positions')
export class PositionController {
  constructor(private readonly positions: PositionService) {}

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.positions.list(tenantId, activeOnly === 'true');
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.positions.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePositionDto,
  ) {
    return this.positions.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post(':id/deactivate')
  deactivate(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.positions.deactivate(tenantId, id);
  }
}
