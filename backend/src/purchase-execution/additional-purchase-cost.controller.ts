import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AdditionalPurchaseCostService } from './additional-purchase-cost.service';
import { CreateAdditionalPurchaseCostDto } from './dto/purchase-execution.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/additional-purchase-costs')
export class AdditionalPurchaseCostController {
  constructor(private readonly costs: AdditionalPurchaseCostService) {}

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.costs.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.costs.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAdditionalPurchaseCostDto,
  ) {
    return this.costs.create(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
