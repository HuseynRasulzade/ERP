import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FixedAssetService } from './fixed-asset.service';
import {
  AcceptFixedAssetDto,
  ChangeUsefulLifeDto,
  CommissionFixedAssetDto,
  CreateFixedAssetDto,
  CreateOpeningBalanceDto,
  TransferFixedAssetDto,
} from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets')
export class FixedAssetController {
  constructor(private readonly assets: FixedAssetService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.assets.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.assets.getWithBalances(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateFixedAssetDto,
  ) {
    return this.assets.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('opening-balances')
  createOpeningBalance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOpeningBalanceDto,
  ) {
    return this.assets.createOpeningBalance(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_ACCEPT)
  @Post(':id/accept')
  accept(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: AcceptFixedAssetDto,
  ) {
    return this.assets.accept(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_COMMISSION)
  @Post(':id/commission')
  commission(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CommissionFixedAssetDto,
  ) {
    return this.assets.commission(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_TRANSFER)
  @Post(':id/transfer')
  transfer(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: TransferFixedAssetDto,
  ) {
    return this.assets.transfer(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CHANGE_USEFUL_LIFE)
  @Post(':id/change-useful-life')
  changeUsefulLife(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangeUsefulLifeDto,
  ) {
    return this.assets.changeUsefulLife(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
