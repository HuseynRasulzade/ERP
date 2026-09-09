import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UnitOfMeasureService } from './unit-of-measure.service';
import { CreateUnitOfMeasureDto, UpdateUnitOfMeasureDto } from './dto/unit-of-measure.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('units-of-measure')
export class UnitOfMeasureController {
  constructor(private readonly service: UnitOfMeasureService) {}

  @RequirePermissions(PermissionCodes.UNIT_OF_MEASURE_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(tenantId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.UNIT_OF_MEASURE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateUnitOfMeasureDto,
  ) {
    return this.service.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.UNIT_OF_MEASURE_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.UNIT_OF_MEASURE_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateUnitOfMeasureDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.service.update(tenantId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.UNIT_OF_MEASURE_DEACTIVATE)
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
