import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InternalConsumptionService } from './internal-consumption.service';
import { CreateInternalConsumptionDto } from './dto/warehouse-inventory.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/internal-consumptions')
export class InternalConsumptionController {
  constructor(private readonly consumptions: InternalConsumptionService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.consumptions.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.consumptions.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_CONSUME)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInternalConsumptionDto,
  ) {
    return this.consumptions.create(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
