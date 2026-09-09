import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PriceListService } from './price-list.service';
import { CreatePriceListDto, UpdatePriceListDto, CreateProductPriceDto } from './dto/price-list.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/price-lists')
export class PriceListController {
  constructor(private readonly service: PriceListService) {}

  @RequirePermissions(PermissionCodes.PRICE_LIST_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('type') type?: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId, includeInactive === 'true', type);
  }

  @RequirePermissions(PermissionCodes.PRICE_LIST_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePriceListDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRICE_LIST_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PRICE_LIST_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePriceListDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.service.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.PRICE_LIST_DEACTIVATE)
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

  @RequirePermissions(PermissionCodes.PRODUCT_PRICE_MANAGE)
  @Post(':id/prices')
  addPrice(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') priceListId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateProductPriceDto,
  ) {
    return this.service.addPrice(tenantId, membershipId, organizationId, priceListId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PRODUCT_PRICE_VIEW)
  @Get(':id/resolve-price/:productId')
  resolvePrice(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('productId') productId: string,
    @Query('type') type: string,
    @Query('date') date: string,
    @Query('quantity') quantity?: string,
    @Query('counterpartyId') counterpartyId?: string,
  ) {
    return this.service.resolvePrice(
      tenantId, membershipId, organizationId, type, productId, new Date(date),
      quantity ? parseFloat(quantity) : 1, counterpartyId,
    );
  }
}
