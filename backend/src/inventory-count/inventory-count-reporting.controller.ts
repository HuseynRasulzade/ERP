import { Controller, Get, Param, Query } from '@nestjs/common';
import { InventoryCountReportingService } from './inventory-count-reporting.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-count')
export class InventoryCountReportingController {
  constructor(private readonly reporting: InventoryCountReportingService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('sessions/:sessionId/dashboard')
  dashboard(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reporting.dashboard(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('sessions/:sessionId/reports/variance')
  varianceReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reporting.varianceReport(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('sessions/:sessionId/reports/surplus-shortage')
  surplusShortageReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reporting.surplusShortageReport(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('sessions/:sessionId/reports/serial-variance')
  serialVarianceReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reporting.serialVarianceReport(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('sessions/:sessionId/reports/batch-variance')
  batchVarianceReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reporting.batchVarianceReport(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('sessions/:sessionId/reports/location-reconciliation')
  locationReconciliationReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.reporting.locationReconciliationReport(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get('reports/count-history')
  countHistoryReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productId') productId: string) {
    return this.reporting.countHistoryReport(tenantId, membershipId, organizationId, productId);
  }
}
