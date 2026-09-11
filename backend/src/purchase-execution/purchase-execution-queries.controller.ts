import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PurchaseMatchingService } from './purchase-matching.service';
import { PurchaseReportingService } from './purchase-reporting.service';
import { PurchaseFulfillmentService } from './purchase-fulfillment.service';
import { SupplierSettlementService } from './supplier-settlement.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId')
export class PurchaseExecutionQueriesController {
  constructor(
    private readonly matching: PurchaseMatchingService,
    private readonly reporting: PurchaseReportingService,
    private readonly fulfillment: PurchaseFulfillmentService,
    private readonly settlement: SupplierSettlementService,
  ) {}

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get('purchase-invoices/:id/matching')
  computeMatching(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.matching.compute(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Post('purchase-invoices/:id/check-matching')
  checkMatching(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.matching.checkAndPersist(tenantId, membershipId, organizationId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get('purchase-invoices/:id/matching-history')
  matchingHistory(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.matching.history(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get('supplier-orders/:id/fulfillment')
  fulfillment_(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.forPurchaseOrder(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get('supplier-payables')
  supplierPayables(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('counterpartyId') counterpartyId?: string,
  ) {
    return this.settlement.list(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW_ACCOUNTING)
  @Get('reports/purchase-register')
  purchaseRegister(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('counterpartyId') counterpartyId?: string,
  ) {
    return this.reporting.purchaseRegister(tenantId, membershipId, organizationId, { fromDate: new Date(fromDate), toDate: new Date(toDate) }, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW_ACCOUNTING)
  @Get('reports/supplier-invoice-register')
  supplierInvoiceRegister(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reporting.supplierInvoiceRegister(tenantId, membershipId, organizationId, { fromDate: new Date(fromDate), toDate: new Date(toDate) });
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW_ACCOUNTING)
  @Get('reports/goods-received-not-invoiced')
  grni(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.goodsReceivedNotInvoiced(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW_ACCOUNTING)
  @Get('reports/purchase-price-variance')
  priceVariance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reporting.purchasePriceVariance(tenantId, membershipId, organizationId, { fromDate: new Date(fromDate), toDate: new Date(toDate) });
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW_ACCOUNTING)
  @Get('reports/purchase-returns')
  returnsReport(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reporting.purchaseReturns(tenantId, membershipId, organizationId, { fromDate: new Date(fromDate), toDate: new Date(toDate) });
  }
}
