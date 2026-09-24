import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InventoryCostingReportingService } from './inventory-costing-reporting.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';
import { CostingPeriodService } from './costing-period.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * Costing calculations/reports API (spec section 114) — deliberately a
 * thin controller: every method delegates straight to a domain service,
 * never holding business logic itself (spec's own "API business logic
 * controller-də saxlanmamalıdır").
 */
@Controller('organizations/:organizationId/inventory-costing')
export class InventoryCostingOperationsController {
  constructor(
    private readonly reporting: InventoryCostingReportingService,
    private readonly recalculation: InventoryCostRecalculationService,
    private readonly periods: CostingPeriodService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('valuation')
  async valuation(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (asOfDate) return this.reporting.valuationAsOf(tenantId, organizationId, this.parseDate(asOfDate), { warehouseId, productId });
    return this.reporting.valuation(tenantId, organizationId, { warehouseId, productId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_COGS)
  @Get('cogs')
  async cogs(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.cogsReport(tenantId, organizationId, from ? this.parseDate(from) : undefined, to ? this.parseDate(to) : undefined);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('layers')
  async layers(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.layerReport(tenantId, organizationId, { productId, warehouseId, status });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_ERRORS)
  @Get('health')
  async health(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.health(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_RECALCULATE)
  @Post('calculations/recalculate')
  async recalculate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.recalculation.processPendingQueue(tenantId, organizationId, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('periods')
  async listPeriods(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_FINALIZE)
  @Post('periods/:year/:month/finalize')
  async finalize(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.finalize(tenantId, organizationId, Number(year), Number(month), user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_REOPEN)
  @Post('periods/:year/:month/reopen')
  async reopen(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @CurrentUser() user: { userId: string },
    @Body() body: { reason?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.reopen(tenantId, organizationId, Number(year), Number(month), user.userId, body?.reason);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
