import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { StartInventoryCountSessionDto } from './dto/inventory-count-session.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-count/sessions')
export class InventoryCountSessionController {
  constructor(private readonly sessions: InventoryCountSessionService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.sessions.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.sessions.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START_SESSION)
  @Post()
  start(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: StartInventoryCountSessionDto,
  ) {
    return this.sessions.start(tenantId, membershipId, organizationId, user.userId, dto.inventoryCountPlanId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START_SESSION)
  @Post(':id/snapshot')
  createSnapshot(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.sessions.createSnapshot(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START_SESSION)
  @Post(':id/begin-counting')
  beginCounting(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.sessions.beginCounting(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Post(':id/complete')
  complete(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.sessions.complete(tenantId, membershipId, organizationId, user.userId, id);
  }
}
