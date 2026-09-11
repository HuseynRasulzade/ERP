import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { CreateInventoryAdjustmentDto } from './dto/warehouse-inventory.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-adjustments')
export class InventoryAdjustmentController {
  constructor(private readonly adjustments: InventoryAdjustmentService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.adjustments.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.adjustments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_WRITE_OFF)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInventoryAdjustmentDto,
  ) {
    return this.adjustments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
