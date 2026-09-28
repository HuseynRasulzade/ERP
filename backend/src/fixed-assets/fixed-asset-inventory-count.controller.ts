import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FixedAssetInventoryCountService } from './fixed-asset-inventory-count.service';
import {
  ApproveInventoryCountDto,
  StartInventoryCountDto,
  SubmitInventoryCountDto,
} from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets/inventory-counts')
export class FixedAssetInventoryCountController {
  constructor(private readonly counts: FixedAssetInventoryCountService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.counts.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.counts.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post()
  start(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: StartInventoryCountDto,
  ) {
    return this.counts.start(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post(':id/submit')
  submit(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SubmitInventoryCountDto,
  ) {
    return this.counts.submitResults(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApproveInventoryCountDto,
  ) {
    return this.counts.approve(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }
}
