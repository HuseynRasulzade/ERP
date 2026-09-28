import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FixedAssetCategoryService } from './fixed-asset-category.service';
import { CreateFixedAssetCategoryDto } from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('fixed-asset-categories')
export class FixedAssetCategoryController {
  constructor(private readonly categories: FixedAssetCategoryService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.categories.list(tenantId, includeInactive !== 'true');
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.categories.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateFixedAssetCategoryDto,
  ) {
    return this.categories.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.categories.deactivate(tenantId, id, user.userId);
  }
}
