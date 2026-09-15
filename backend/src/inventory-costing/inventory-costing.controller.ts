import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { InventoryValuationService } from './inventory-valuation.service';
import { CostingReportingService } from './costing-reporting.service';
import { CostingReconciliationService } from './costing-reconciliation.service';
import { CostingPeriodService } from './costing-period.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';
import { InventoryCostAdjustmentService } from './inventory-cost-adjustment.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CreateInventoryCostingPolicyDto, FinalizePeriodDto, ReopenPeriodDto } from './dto/inventory-costing.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Query + command surface for the Inventory Costing Engine (spec section
 * 114). Organization-scoped, mirroring every other reporting controller
 * in this codebase (`WarehouseInventoryQueriesController` etc.) — business
 * logic lives entirely in the injected services, never here.
 */
@Controller('organizations/:organizationId/inventory-costing')
export class InventoryCostingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly valuation: InventoryValuationService,
    private readonly reporting: CostingReportingService,
    private readonly reconciliation: CostingReconciliationService,
    private readonly periods: CostingPeriodService,
    private readonly recalculation: InventoryCostRecalculationService,
    private readonly adjustments: InventoryCostAdjustmentService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COST_POLICY_MANAGE)
  @Get('policies')
  async listPolicies(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.policies.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_POLICY_MANAGE)
  @Post('policies')
  async createPolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInventoryCostingPolicyDto,
  ) {
    return this.policies.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('valuation')
  async valuationReport(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (asOfDate) return this.valuation.valuationAsOf(tenantId, new Date(asOfDate), { organizationId, warehouseId, productId });
    return this.valuation.valuation(tenantId, { organizationId, warehouseId, productId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('layers')
  async layers(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId?: string,
    @Query('costingKey') costingKey?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.layerReport(tenantId, { organizationId, productId, costingKey });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('layers/:costingKey/trace')
  async trace(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('costingKey') costingKey: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.valuation.layerTrace(tenantId, costingKey);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_COGS)
  @Get('cogs')
  async cogs(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('productId') productId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.cogsReport(tenantId, { organizationId, productId, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('adjustments-report')
  async adjustmentsReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.adjustmentReport(tenantId, { organizationId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_ERRORS)
  @Get('health')
  async health(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reconciliation.health(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('calculations')
  async calculations(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCostCalculationRun.findMany({ where: { tenantId, organizationId }, orderBy: { startedAt: 'desc' }, take: 100 });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_RECALCULATE)
  @Post('calculations/recalculate')
  async recalculate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const results = await this.recalculation.processQueue(tenantId, user.userId, organizationId);
    const drafts = [];
    for (const { runId, deltas } of results) {
      const draft = await this.prisma.runInTransaction((tx) => this.adjustments.createFromRecalculationDeltas(tenantId, organizationId, runId, deltas, user.userId, tx));
      if (draft) drafts.push(draft);
    }
    return { runs: results.map((r) => r.runId), draftAdjustments: drafts.map((d) => d?.id) };
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('calculations/preview-finalize')
  async previewFinalize(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('period') period: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.preview(tenantId, organizationId, period);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_FINALIZE)
  @Post('calculations/finalize')
  async finalize(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: FinalizePeriodDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.finalize(tenantId, organizationId, dto.period, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_REOPEN)
  @Post('periods/reopen')
  async reopen(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: ReopenPeriodDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.reopen(tenantId, organizationId, dto.period, user.userId, dto.reason);
  }
}
