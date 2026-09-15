import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { InventoryRecountService } from './inventory-recount.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryVarianceResolutionService } from './inventory-variance-resolution.service';
import { InventoryCountReconciliationService } from './inventory-count-reconciliation.service';
import { InventoryCountReportingService } from './inventory-count-reporting.service';
import { RecordCountEntryDto, StartSessionDto, CreateRecountDto, CompleteRecountDto, VarianceDecisionDto } from './dto/inventory-count.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Session-scoped commands and queries (spec section 98). Kept as one
 * controller (mirroring `WarehouseInventoryQueriesController`'s own
 * breadth) rather than one per sub-resource, since every route shares the
 * same `:sessionId` path segment and access check.
 */
@Controller('organizations/:organizationId/inventory-count-sessions')
export class InventoryCountSessionController {
  constructor(
    private readonly sessions: InventoryCountSessionService,
    private readonly entries: InventoryCountEntryService,
    private readonly recounts: InventoryRecountService,
    private readonly variances: InventoryVarianceService,
    private readonly resolution: InventoryVarianceResolutionService,
    private readonly reconciliation: InventoryCountReconciliationService,
    private readonly reporting: InventoryCountReportingService,
  ) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.sessions.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.sessions.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CREATE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('planId') planId: string) {
    return this.sessions.create(tenantId, membershipId, organizationId, user.userId, planId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START)
  @Post(':id/start')
  start(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: StartSessionDto) {
    return this.sessions.start(tenantId, membershipId, organizationId, id, user.userId, dto ?? {});
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CREATE_SNAPSHOT)
  @Post(':id/snapshot')
  snapshot(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.sessions.createSnapshot(tenantId, membershipId, organizationId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_FREEZE)
  @Post(':id/freeze')
  freeze(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.sessions.setFrozen(tenantId, membershipId, organizationId, id, user.userId, true);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_FREEZE)
  @Post(':id/unfreeze')
  unfreeze(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.sessions.setFrozen(tenantId, membershipId, organizationId, id, user.userId, false);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START)
  @Post(':id/generate-sheets')
  generateSheets(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.sessions.generateSheets(tenantId, membershipId, organizationId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Get(':id/sheets/:sheetId/expected')
  expected(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Param('sheetId') sheetId: string, @Query('blind') blind: string, @Query('fullBlind') fullBlind: string) {
    return this.entries.blindSafeExpectedList(tenantId, id, sheetId, blind === 'true', fullBlind === 'true');
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Post(':id/entries')
  recordEntry(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordCountEntryDto) {
    return this.entries.record(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START)
  @Post('sheets/:sheetId/complete')
  completeSheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sheetId') sheetId: string, @CurrentUser() user: { userId: string }, @Query('allowUncounted') allowUncounted: string) {
    return this.entries.completeSheet(tenantId, membershipId, organizationId, sheetId, user.userId, allowUncounted === 'true');
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_REVIEW)
  @Get(':id/variances')
  variances_(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.varianceReport(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_REVIEW)
  @Post(':id/calculate-variances')
  calculateVariances(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.variances.calculate(tenantId, membershipId, organizationId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECOUNT)
  @Post(':id/recounts')
  requestRecount(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateRecountDto) {
    return this.recounts.request(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_RECOUNT)
  @Post('recounts/:recountId/complete')
  completeRecount(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('recountId') recountId: string, @CurrentUser() user: { userId: string }, @Body() dto: CompleteRecountDto) {
    return this.recounts.complete(tenantId, membershipId, organizationId, recountId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_APPROVE)
  @Post('variances/:varianceId/decision')
  decide(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('varianceId') varianceId: string, @CurrentUser() user: { userId: string }, @Body() dto: VarianceDecisionDto) {
    return this.resolution.decide(tenantId, membershipId, organizationId, varianceId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_REVIEW)
  @Post(':id/auto-accept-tolerance')
  autoAccept(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.resolution.autoAcceptWithinTolerance(tenantId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_APPROVE)
  @Post(':id/reconcile')
  reconcile(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.reconciliation.reconcile(tenantId, membershipId, organizationId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_CLOSE)
  @Post(':id/close')
  close(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.reconciliation.close(tenantId, membershipId, organizationId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id/progress')
  progress(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.progress(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id/surplus-shortage-report')
  surplusShortage(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.surplusShortageReport(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id/serial-variance-report')
  serialVariance(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.serialVarianceReport(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id/batch-variance-report')
  batchVariance(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.batchVarianceReport(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get(':id/location-reconciliation-suggestions')
  locationSuggestions(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.reporting.locationReconciliationSuggestions(tenantId, id);
  }
}
