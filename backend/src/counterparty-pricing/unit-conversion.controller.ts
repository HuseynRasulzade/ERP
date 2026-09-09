import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UnitConversionService } from './unit-conversion.service';
import { CreateUnitConversionDto, UpdateUnitConversionDto } from './dto/unit-conversion.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('unit-conversions')
export class UnitConversionController {
  constructor(private readonly service: UnitConversionService) {}

  @RequirePermissions(PermissionCodes.UNIT_CONVERSION_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(tenantId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.UNIT_CONVERSION_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateUnitConversionDto,
  ) {
    return this.service.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.UNIT_CONVERSION_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.UNIT_CONVERSION_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateUnitConversionDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.service.update(tenantId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.UNIT_CONVERSION_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: VersionedCommandDto,
  ) {
    return this.service.deactivate(tenantId, id, user.userId, dto.expectedVersion);
  }
}
