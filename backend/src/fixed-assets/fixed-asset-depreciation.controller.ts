import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { CalculateDepreciationDto } from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { DocumentCommandDto } from '../document-framework/dto/document-command.dto';

@Controller('organizations/:organizationId/fixed-assets/depreciation-runs')
export class FixedAssetDepreciationController {
  constructor(private readonly depreciation: FixedAssetDepreciationService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.depreciation.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.depreciation.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Post('calculate')
  calculate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CalculateDepreciationDto,
  ) {
    return this.depreciation.calculate(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_POST)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DocumentCommandDto,
  ) {
    return this.depreciation.post(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }
}
