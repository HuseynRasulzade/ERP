import { Controller, Get, Param, Query } from '@nestjs/common';
import { FixedAssetReportingService } from './fixed-asset-reporting.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets/reports')
export class FixedAssetReportingController {
  constructor(private readonly reports: FixedAssetReportingService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get('register')
  register(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.register(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get('depreciation-schedule')
  depreciationSchedule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('assetId') assetId: string,
  ) {
    return this.reports.depreciationSchedule(
      tenantId,
      membershipId,
      organizationId,
      assetId,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get('fully-depreciated-active')
  fullyDepreciatedActive(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.fullyDepreciatedActiveAssets(
      tenantId,
      membershipId,
      organizationId,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get('not-commissioned')
  notCommissioned(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.assetsNotCommissioned(
      tenantId,
      membershipId,
      organizationId,
    );
  }
}
