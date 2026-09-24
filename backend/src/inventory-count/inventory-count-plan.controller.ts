import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventoryCountScopeService } from './inventory-count-scope.service';
import { CreateInventoryCountPlanDto, CreateInventoryCountScopeDto } from './dto/inventory-count-plan.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-count/plans')
export class InventoryCountPlanController {
  constructor(
    private readonly plans: InventoryCountPlanService,
    private readonly scopes: InventoryCountScopeService,
  ) {}

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

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_PLAN)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInventoryCountPlanDto,
  ) {
    return this.plans.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_PLAN)
  @Post(':id/mark-ready')
  markReady(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body('expectedVersion') expectedVersion: number,
  ) {
    return this.plans.markReady(tenantId, membershipId, organizationId, user.userId, id, expectedVersion);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id/scopes')
  listScopes(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.scopes.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_MANAGE_SCOPE)
  @Post(':id/scopes')
  addScope(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: CreateInventoryCountScopeDto,
  ) {
    return this.scopes.add(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_MANAGE_SCOPE)
  @Delete(':id/scopes/:scopeId')
  removeScope(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Param('scopeId') scopeId: string,
  ) {
    return this.scopes.remove(tenantId, membershipId, organizationId, user.userId, id, scopeId);
  }
}
