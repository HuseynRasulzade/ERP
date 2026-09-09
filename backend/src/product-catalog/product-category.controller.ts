import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProductCategoryService } from './product-category.service';
import { CreateProductCategoryDto, UpdateProductCategoryDto } from './dto/product-category.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/product-categories')
export class ProductCategoryController {
  constructor(private readonly service: ProductCategoryService) {}

  @RequirePermissions(PermissionCodes.PRODUCT_CATEGORY_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.PRODUCT_CATEGORY_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateProductCategoryDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCT_CATEGORY_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCT_CATEGORY_VIEW)
  @Get(':id/descendants')
  getDescendants(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.getDescendants(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRODUCT_CATEGORY_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateProductCategoryDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.service.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.PRODUCT_CATEGORY_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.service.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
