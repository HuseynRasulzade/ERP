import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryCountPlanService } from './inventory-count-plan.service';
import { CreateInventoryCountPlanDto, CreateInventoryCountScopeDto } from './dto/inventory-count.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-counts')
export class InventoryCountPlanController {
  constructor(private readonly plans: InventoryCountPlanService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.plans.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.plans.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CREATE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateInventoryCountPlanDto) {
    return this.plans.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CREATE)
  @Post(':id/scopes')
  addScope(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateInventoryCountScopeDto) {
    return this.plans.addScope(tenantId, membershipId, organizationId, id, user.userId, dto as unknown as Record<string, unknown>);
  }
}
