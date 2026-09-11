import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryStatusTransferService } from './inventory-status-transfer.service';
import { CreateInventoryStatusTransferDto } from './dto/warehouse-inventory.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-status-transfers')
export class InventoryStatusTransferController {
  constructor(private readonly transfers: InventoryStatusTransferService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.transfers.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.transfers.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_STATUS_CHANGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInventoryStatusTransferDto,
  ) {
    return this.transfers.create(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
