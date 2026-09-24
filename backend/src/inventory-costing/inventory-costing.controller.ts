import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { InventoryValuationService } from './inventory-valuation.service';
import { CreateInventoryCostingPolicyDto } from './dto/inventory-costing.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-costing')
export class InventoryCostingController {
  constructor(
    private readonly policies: InventoryCostingPolicyService,
    private readonly valuation: InventoryValuationService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COST_POLICY_MANAGE)
  @Get('policies')
  listPolicies(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.policies.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_POLICY_MANAGE)
  @Post('policies')
  createPolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInventoryCostingPolicyDto,
  ) {
    return this.policies.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('valuation')
  valuationReport(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.valuation.valuation(tenantId, membershipId, organizationId, { productId, warehouseId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('layers')
  layers(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId?: string,
  ) {
    return this.valuation.layers(tenantId, membershipId, organizationId, { productId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_COGS)
  @Get('cogs')
  cogs(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.valuation.cogs(tenantId, membershipId, organizationId, {
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
  }
}
