import { Controller, Get, Param, Query } from '@nestjs/common';
import { ExpectedStockService } from './expected-stock.service';
import { ProcurementPlanningService } from './procurement-planning.service';
import { SupplierSelectionService } from './supplier-selection.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Read-only procurement planning surface (spec section 98):
 * GET /procurement/expected-stock, /open-requirements, /demand-coverage,
 * plus supplier-candidate comparison for a product.
 */
@Controller('organizations/:organizationId/procurement')
export class ProcurementQueriesController {
  constructor(
    private readonly expectedStock: ExpectedStockService,
    private readonly planning: ProcurementPlanningService,
    private readonly supplierSelection: SupplierSelectionService,
  ) {}

  @RequirePermissions(PermissionCodes.PURCHASE_EXPECTED_RECEIPT_VIEW)
  @Get('expected-stock')
  expectedStockForProduct(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.expectedStock.forProduct(tenantId, membershipId, organizationId, productId, warehouseId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_EXPECTED_RECEIPT_VIEW)
  @Get('open-purchase-orders')
  openPurchaseOrders(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.expectedStock.openPurchaseOrders(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_EXPECTED_RECEIPT_VIEW)
  @Get('late-purchase-orders')
  latePurchaseOrders(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    return this.expectedStock.latePurchaseOrders(tenantId, membershipId, organizationId, asOfDate ? new Date(asOfDate) : new Date());
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLY_PLANNING_VIEW)
  @Get('open-requirements')
  openRequirements(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.planning.openRequirements(tenantId, membershipId, organizationId, productId, warehouseId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLY_PLANNING_VIEW)
  @Get('demand-coverage')
  demandCoverage(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.planning.aggregateDemand(tenantId, membershipId, organizationId, productId, warehouseId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLIER_SELECTION_VIEW)
  @Get('supplier-candidates')
  supplierCandidates(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId: string,
    @Query('quantity') quantity: string,
    @Query('date') date?: string,
  ) {
    return this.supplierSelection.candidatesForProduct(tenantId, membershipId, organizationId, productId, Number(quantity ?? 1), date ? new Date(date) : new Date());
  }
}
