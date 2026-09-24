import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CostingPolicyService } from './costing-policy.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { UpsertInventoryCostingPolicyDto } from './dto/inventory-costing-policy.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Costing policy adoption (spec section 4) — the "opt in per organization"
 * step this module requires before any costing hook stops being a no-op,
 * mirroring Accounting Core's chart-adopt / Tax Engine's localization-seed.
 */
@Controller('organizations/:organizationId/inventory-costing/policy')
export class InventoryCostingPolicyController {
  constructor(
    private readonly policies: CostingPolicyService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get()
  async list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.policies.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_MANAGE_POLICY)
  @Post()
  async upsert(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpsertInventoryCostingPolicyDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.policies.upsert(tenantId, organizationId, user.userId, dto);
  }
}
