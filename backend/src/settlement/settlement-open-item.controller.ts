import { Controller, Get, Param, Query } from '@nestjs/common';
import { OpenItemService } from './open-item.service';
import { AgeingService } from './ageing.service';
import { CreditExposureService } from './credit-exposure.service';
import { SettlementHealthService } from './settlement-health.service';
import { SettlementReportingService } from './settlement-reporting.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/settlements')
export class SettlementOpenItemController {
  constructor(
    private readonly openItems: OpenItemService,
    private readonly ageingService: AgeingService,
    private readonly creditExposure: CreditExposureService,
    private readonly health: SettlementHealthService,
    private readonly reporting: SettlementReportingService,
  ) {}

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('open-items')
  listOpenItems(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('counterpartyId') counterpartyId?: string,
    @Query('itemType') itemType?: string,
    @Query('status') status?: string,
    @Query('includeSettled') includeSettled?: string,
  ) {
    return this.openItems.list(tenantId, membershipId, organizationId, { counterpartyId, itemType, status, includeSettled: includeSettled === 'true' });
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('open-items/:id')
  getOpenItem(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.openItems.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('balances/:counterpartyId')
  netPosition(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('counterpartyId') counterpartyId: string) {
    return this.openItems.netPosition(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('customer-ageing')
  customerAgeing(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    return this.ageingService.ageing(tenantId, membershipId, organizationId, 'CUSTOMER', asOfDate ? new Date(asOfDate) : undefined);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('supplier-ageing')
  supplierAgeing(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    return this.ageingService.ageing(tenantId, membershipId, organizationId, 'SUPPLIER', asOfDate ? new Date(asOfDate) : undefined);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('advances')
  advances(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('role') role: 'CUSTOMER' | 'SUPPLIER' = 'CUSTOMER') {
    return this.reporting.advances(tenantId, membershipId, organizationId, role);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('unallocated-payments')
  unallocatedPayments(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.unallocatedPayments(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('reports/open-receivables')
  openReceivables(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.openReceivables(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('reports/open-payables')
  openPayables(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.openPayables(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('reports/overdue-debt')
  overdueDebt(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('role') role: 'CUSTOMER' | 'SUPPLIER' = 'CUSTOMER') {
    return this.reporting.overdueDebt(tenantId, membershipId, organizationId, role);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('reports/statement/:counterpartyId')
  statement(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('counterpartyId') counterpartyId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    return this.reporting.statement(tenantId, membershipId, organizationId, counterpartyId, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('reports/debt-movement/:counterpartyId')
  debtMovement(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('counterpartyId') counterpartyId: string,
    @Query('periodStart') periodStart: string,
    @Query('periodEnd') periodEnd: string,
  ) {
    return this.reporting.debtMovement(tenantId, membershipId, organizationId, counterpartyId, new Date(periodStart), new Date(periodEnd));
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('credit-exposure/:customerId')
  creditExposureFor(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('customerId') customerId: string) {
    return this.creditExposure.getAvailableCredit(tenantId, membershipId, organizationId, customerId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('health')
  healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
