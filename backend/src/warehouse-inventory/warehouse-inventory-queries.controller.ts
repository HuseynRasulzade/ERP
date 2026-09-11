import { Controller, Get, Param, Query } from '@nestjs/common';
import { StockAvailabilityService } from './stock-availability.service';
import { WarehouseInventoryReportingService } from './warehouse-inventory-reporting.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId')
export class WarehouseInventoryQueriesController {
  constructor(
    private readonly availability: StockAvailabilityService,
    private readonly reporting: WarehouseInventoryReportingService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get('warehouses/:warehouseId/products/:productId/stock')
  async snapshot(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('warehouseId') warehouseId: string,
    @Param('productId') productId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.availability.getSnapshot(tenantId, warehouseId, productId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get('inventory-reports/stock-balance')
  stockBalance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.reporting.stockBalance(tenantId, membershipId, organizationId, { warehouseId, productId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW_MOVEMENTS)
  @Get('inventory-reports/stock-card')
  stockCard(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('warehouseId') warehouseId: string,
    @Query('productId') productId: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.reporting.stockCard(tenantId, membershipId, organizationId, warehouseId, productId, batchId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get('inventory-reports/batches')
  batchReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productId') productId?: string) {
    return this.reporting.batchReport(tenantId, membershipId, organizationId, productId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get('inventory-reports/serials')
  serialReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productId') productId?: string) {
    return this.reporting.serialReport(tenantId, membershipId, organizationId, productId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW_SERIAL_HISTORY)
  @Get('inventory-reports/serials/:serialId/history')
  serialHistory(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('serialId') serialId: string) {
    return this.reporting.serialHistory(tenantId, membershipId, organizationId, serialId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get('inventory-reports/negative-stock')
  negativeStock(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.negativeStockReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_VIEW)
  @Get('inventory-reports/min-max')
  minMax(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('warehouseId') warehouseId?: string) {
    return this.reporting.minMaxReport(tenantId, membershipId, organizationId, warehouseId);
  }
}
