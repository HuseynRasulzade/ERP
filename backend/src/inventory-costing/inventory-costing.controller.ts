import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { NotFoundAppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryCostingPolicyService } from './costing-policy.service';
import { InventoryCostingService } from './inventory-costing.service';
import { CostingPeriodService } from './costing-period.service';
import { CostingReportingService } from './costing-reporting.service';
import { ManualCostAdjustmentService } from './manual-cost-adjustment.service';
import { CreateCostingPolicyDto, CreateManualAdjustmentDto, FinalizeDto, RecalculateDto, ReopenPeriodDto, ResolveErrorDto } from './dto/inventory-costing.dto';

/**
 * Inventory Costing API (spec section 114). Thin: every rule lives in the
 * services. Cost data is sensitive (spec 97) — every route requires an
 * `inventory_cost.*` permission, never just `inventory.view`.
 */
@Controller('organizations/:organizationId/inventory-costing')
export class InventoryCostingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly costing: InventoryCostingService,
    private readonly periods: CostingPeriodService,
    private readonly reporting: CostingReportingService,
    private readonly manual: ManualCostAdjustmentService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('policies')
  async listPolicies(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.policies.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_POLICY_MANAGE)
  @Post('policies')
  async createPolicy(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCostingPolicyDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.policies.create(tenantId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('valuation')
  async valuation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string, @Query('warehouseId') warehouseId?: string, @Query('productId') productId?: string, @Query('costStatus') costStatus?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.valuation(tenantId, organizationId, { asOfDate, warehouseId, productId, costStatus });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('layers')
  async layers(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productId') productId?: string, @Query('costingKey') costingKey?: string, @Query('openOnly') openOnly?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.layers(tenantId, organizationId, { productId, costingKey, openOnly: openOnly === 'true' });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('layers/:layerId')
  async layerCard(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('layerId') layerId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.layerCard(tenantId, organizationId, layerId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_LAYERS)
  @Get('trace')
  async trace(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('documentType') documentType: string, @Query('documentId') documentId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.trace(tenantId, organizationId, { documentType, documentId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_COGS)
  @Get('cogs')
  async cogs(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('productId') productId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.cogs(tenantId, organizationId, { from, to, productId });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_ERRORS)
  @Get('health')
  async health(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.health(tenantId, organizationId, asOfDate);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_ACCOUNTING)
  @Get('reconciliation')
  async reconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return { value: await this.reporting.reconciliation(tenantId, organizationId, asOfDate), quantity: await this.reporting.quantityReconciliation(tenantId, organizationId, asOfDate ? new Date(asOfDate) : new Date()) };
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('preview/issue-cost')
  async previewIssueCost(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('productId') productId: string, @Query('quantity') quantity: string, @Query('warehouseId') warehouseId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.costing.previewIssueCost(tenantId, organizationId, productId, warehouseId ?? null, quantity ?? '1');
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('calculations')
  async calculations(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.calculations(tenantId, organizationId);
  }

  /** "Run Provisional Costing" — drains the pending backdated queue. */
  @RequirePermissions(PermissionCodes.INVENTORY_COST_RECALCULATE)
  @Post('calculations/provisional')
  async provisional(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.costing.recalculate(tenantId, organizationId, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_RECALCULATE)
  @Post('calculations/recalculate')
  async recalculate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecalculateDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.costing.recalculate(tenantId, organizationId, user.userId, { fullRebuild: dto.fullRebuild, fromDate: dto.fromDate ? new Date(dto.fromDate) : undefined });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Post('calculations/finalize-preview')
  async finalizePreview(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: FinalizeDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.finalize(tenantId, organizationId, dto.period, user.userId, { preview: true });
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_FINALIZE)
  @Post('calculations/finalize')
  async finalize(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: FinalizeDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.finalize(tenantId, organizationId, dto.period, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW)
  @Get('periods')
  async listPeriods(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.periods(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_REOPEN)
  @Post('periods/:period/reopen')
  async reopen(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('period') period: string, @CurrentUser() user: { userId: string }, @Body() dto: ReopenPeriodDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.periods.reopen(tenantId, organizationId, period, user.userId, dto.reason);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_ERRORS)
  @Get('errors')
  async errors(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('includeResolved') includeResolved?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.errors(tenantId, organizationId, includeResolved === 'true');
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_RECALCULATE)
  @Post('errors/:errorId/resolve')
  async resolveError(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('errorId') errorId: string, @CurrentUser() user: { userId: string }, @Body() dto: ResolveErrorDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const error = await this.prisma.inventoryCostingError.findFirst({ where: { id: errorId, tenantId, organizationId } });
    if (!error) throw new NotFoundAppError('InventoryCostingError', errorId);
    const updated = await this.prisma.inventoryCostingError.update({ where: { id: errorId }, data: { resolved: true, resolvedBy: user.userId, resolvedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COSTING_ERROR_RESOLVED', entityType: 'InventoryCostingError', entityId: errorId, action: 'RESOLVE', userId: user.userId, reason: dto.comment });
    return updated;
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_VIEW_ACCOUNTING)
  @Get('adjustments')
  async adjustments(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.adjustments(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_ADJUST)
  @Post('adjustments')
  async createAdjustment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateManualAdjustmentDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.manual.create(tenantId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COST_ADJUST)
  @Post('adjustments/:adjustmentId/post')
  async postAdjustment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('adjustmentId') adjustmentId: string, @CurrentUser() user: { userId: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.manual.post(tenantId, organizationId, adjustmentId, user.userId);
  }
}
