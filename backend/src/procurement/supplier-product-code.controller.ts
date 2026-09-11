import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SupplierProductCodeService } from './supplier-product-code.service';
import { UpsertSupplierProductCodeDto } from './dto/procurement.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/supplier-product-codes')
export class SupplierProductCodeController {
  constructor(private readonly codes: SupplierProductCodeService) {}

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLIER_PRODUCT_CODE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('counterpartyId') counterpartyId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.codes.list(tenantId, membershipId, organizationId, counterpartyId, productId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLIER_PRODUCT_CODE_MANAGE)
  @Post()
  upsert(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpsertSupplierProductCodeDto,
  ) {
    return this.codes.upsert(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLIER_PRODUCT_CODE_MANAGE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.codes.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
