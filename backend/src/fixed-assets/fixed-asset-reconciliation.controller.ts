import { Controller, Get, Param } from '@nestjs/common';
import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';
import { FixedAssetHealthService } from './fixed-asset-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets')
export class FixedAssetReconciliationController {
  constructor(
    private readonly reconciliation: FixedAssetReconciliationService,
    private readonly health: FixedAssetHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('reconciliation')
  reconcile(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reconciliation.reconcileAll(
      tenantId,
      membershipId,
      organizationId,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('health')
  checkHealth(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
