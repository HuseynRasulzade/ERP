import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { FixedAssetCategoryService } from './fixed-asset-category.service';
import { FixedAssetAcquisitionCandidateService } from './fixed-asset-acquisition-candidate.service';
import { CapitalInvestmentProjectService } from './capital-investment-project.service';
import { FixedAssetCapitalizationService } from './fixed-asset-capitalization.service';
import { FIXED_ASSET_CAPITALIZATION_TYPE } from './fixed-asset-capitalization.repository';
import { FixedAssetService } from './fixed-asset.service';
import { FixedAssetCommissioningService } from './fixed-asset-commissioning.service';
import { FixedAssetTransferService } from './fixed-asset-transfer.service';
import { FIXED_ASSET_TRANSFER_TYPE } from './fixed-asset-transfer.repository';
import { FixedAssetModernizationService } from './fixed-asset-modernization.service';
import { FIXED_ASSET_MODERNIZATION_TYPE } from './fixed-asset-modernization.repository';
import { FixedAssetImpairmentService } from './fixed-asset-impairment.service';
import { FIXED_ASSET_IMPAIRMENT_TYPE } from './fixed-asset-impairment.repository';
import { FixedAssetRevaluationService } from './fixed-asset-revaluation.service';
import { FIXED_ASSET_REVALUATION_TYPE } from './fixed-asset-revaluation.repository';
import { FixedAssetSuspensionService } from './fixed-asset-suspension.service';
import { FixedAssetDisposalService } from './fixed-asset-disposal.service';
import { FIXED_ASSET_DISPOSAL_TYPE } from './fixed-asset-disposal.repository';
import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { FixedAssetInventoryService } from './fixed-asset-inventory.service';
import { FixedAssetOpeningBalanceService } from './fixed-asset-opening-balance.service';
import { FixedAssetReportingService } from './fixed-asset-reporting.service';
import { FixedAssetHealthService } from './fixed-asset-health.service';
import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';
import {
  CreateFixedAssetCategoryDto,
  ClassifyCandidateDto,
  CreateCipProjectDto,
  AddCipCostLineDto,
  CapitalizeFixedAssetDto,
  CommissionFixedAssetDto,
  CreateFixedAssetTransferDto,
  CreateFixedAssetModernizationDto,
  CreateFixedAssetImpairmentDto,
  CreateFixedAssetRevaluationDto,
  SuspendFixedAssetDto,
  CreateFixedAssetDisposalDto,
  StartInventoryCountDto,
  RecordInventoryLineDto,
  MigrateOpeningBalanceDto,
} from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Fixed Assets API (docx spec Phase 16, section 143). See docs/FIXED_ASSETS.md. */
@Controller('organizations/:organizationId/fixed-assets')
export class FixedAssetController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly categories: FixedAssetCategoryService,
    private readonly candidates: FixedAssetAcquisitionCandidateService,
    private readonly cip: CapitalInvestmentProjectService,
    private readonly capitalization: FixedAssetCapitalizationService,
    private readonly assets: FixedAssetService,
    private readonly commissioning: FixedAssetCommissioningService,
    private readonly transfers: FixedAssetTransferService,
    private readonly modernizations: FixedAssetModernizationService,
    private readonly impairments: FixedAssetImpairmentService,
    private readonly revaluations: FixedAssetRevaluationService,
    private readonly suspensions: FixedAssetSuspensionService,
    private readonly disposals: FixedAssetDisposalService,
    private readonly depreciation: FixedAssetDepreciationService,
    private readonly inventory: FixedAssetInventoryService,
    private readonly openingBalances: FixedAssetOpeningBalanceService,
    private readonly reporting: FixedAssetReportingService,
    private readonly health: FixedAssetHealthService,
    private readonly reconciliation: FixedAssetReconciliationService,
    private readonly posting: DocumentPostingService,
  ) {}

  // --- Categories ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('categories')
  listCategories(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.categories.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('categories')
  createCategory(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFixedAssetCategoryDto) {
    return this.categories.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  // --- Acquisition candidates ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('acquisition-candidates')
  listCandidates(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('status') status?: string) {
    return this.candidates.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('acquisition-candidates/:id/classify')
  classifyCandidate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ClassifyCandidateDto) {
    return this.candidates.classify(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  // --- CIP ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('cip')
  listCip(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('status') status?: string) {
    return this.cip.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('cip')
  createCip(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCipProjectDto) {
    return this.cip.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('cip/:id/cost-lines')
  addCipCostLine(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: AddCipCostLineDto) {
    return this.cip.addCostLine(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get('cip/:id/summary')
  cipSummary(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.cip.summary(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('cip/:id/ready-for-capitalization')
  cipReady(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.cip.markReadyForCapitalization(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_ACCEPT)
  @Post('cip/:id/close')
  cipClose(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.cip.close(tenantId, membershipId, organizationId, user.userId, id);
  }

  // --- Capitalization / asset card ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('')
  listAssets(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('status') status?: string, @Query('categoryId') categoryId?: string) {
    return this.assets.list(tenantId, membershipId, organizationId, status, categoryId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_ACCEPT)
  @Post('capitalize')
  capitalize(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CapitalizeFixedAssetDto) {
    return this.capitalization.capitalize(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_ACCEPT)
  @Post('capitalizations/:id/post')
  postCapitalization(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, FIXED_ASSET_CAPITALIZATION_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_COMMISSION)
  @Post(':id/commission')
  commission(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: CommissionFixedAssetDto) {
    return this.commissioning.commission(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  // --- Transfer ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_TRANSFER)
  @Post('transfers')
  createTransfer(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFixedAssetTransferDto) {
    return this.transfers.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_TRANSFER)
  @Post('transfers/:id/post')
  postTransfer(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, FIXED_ASSET_TRANSFER_TYPE, id, expectedVersion, user.userId);
  }

  // --- Modernization ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_MODERNIZE)
  @Post('modernizations')
  createModernization(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFixedAssetModernizationDto) {
    return this.modernizations.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MODERNIZE)
  @Post('modernizations/:id/post')
  postModernization(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, FIXED_ASSET_MODERNIZATION_TYPE, id, expectedVersion, user.userId);
  }

  // --- Impairment ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_IMPAIR)
  @Post('impairments')
  createImpairment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFixedAssetImpairmentDto) {
    return this.impairments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_IMPAIR)
  @Post('impairments/:id/post')
  postImpairment(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, FIXED_ASSET_IMPAIRMENT_TYPE, id, expectedVersion, user.userId);
  }

  // --- Revaluation ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_REVALUE)
  @Post('revaluations')
  createRevaluation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFixedAssetRevaluationDto) {
    return this.revaluations.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_REVALUE)
  @Post('revaluations/:id/post')
  postRevaluation(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, FIXED_ASSET_REVALUATION_TYPE, id, expectedVersion, user.userId);
  }

  // --- Suspension ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post('suspensions')
  suspend(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: SuspendFixedAssetDto) {
    return this.suspensions.suspend(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post('suspensions/:id/end')
  endSuspension(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('endDate') endDate: string) {
    return this.suspensions.end(tenantId, membershipId, organizationId, user.userId, id, endDate);
  }

  // --- Disposal ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_DISPOSE)
  @Post('disposals')
  createDisposal(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFixedAssetDisposalDto) {
    return this.disposals.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DISPOSE)
  @Post('disposals/:id/post')
  postDisposal(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, FIXED_ASSET_DISPOSAL_TYPE, id, expectedVersion, user.userId);
  }

  // --- Depreciation ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('depreciation/preview')
  previewDepreciation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('period') period: string) {
    return this.depreciation.preview(tenantId, membershipId, organizationId, period);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Post('depreciation/calculate')
  calculateDepreciation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('period') period: string, @Body('runType') runType?: 'PERIODIC' | 'RECALCULATION') {
    return this.depreciation.calculate(tenantId, membershipId, organizationId, user.userId, period, runType);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_POST)
  @Post('depreciation/runs/:runId/post')
  postDepreciation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('runId') runId: string, @CurrentUser() user: { userId: string }) {
    return this.depreciation.post(tenantId, membershipId, organizationId, user.userId, runId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_PERIOD_OVERRIDE)
  @Post('depreciation/runs/:runId/reverse')
  reverseDepreciation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('runId') runId: string, @CurrentUser() user: { userId: string }) {
    return this.depreciation.reverse(tenantId, membershipId, organizationId, user.userId, runId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('depreciation/runs')
  listDepreciationRuns(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.depreciation.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('depreciation/runs/:runId/entries')
  depreciationEntries(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('runId') runId: string) {
    return this.depreciation.entries(tenantId, membershipId, organizationId, runId);
  }

  // --- Inventory ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post('inventory-counts')
  startInventory(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: StartInventoryCountDto) {
    return this.inventory.start(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post('inventory-counts/:id/lines')
  recordInventoryLine(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordInventoryLineDto) {
    return this.inventory.recordLine(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post('inventory-counts/:id/complete')
  completeInventory(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.inventory.complete(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('inventory-counts')
  listInventoryCounts(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.inventory.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('inventory-counts/:id/differences')
  inventoryDifferences(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.inventory.differences(tenantId, membershipId, organizationId, id);
  }

  // --- Opening balance / migration ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post('opening-balances')
  migrateOpeningBalance(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: MigrateOpeningBalanceDto) {
    return this.openingBalances.migrate(tenantId, membershipId, organizationId, user.userId, dto);
  }

  // --- Reports ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('reports/register')
  reportRegister(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.register(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get(':id/reports/depreciation-schedule')
  reportDepreciationSchedule(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reporting.depreciationSchedule(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get('reports/movements')
  reportMovements(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.reporting.movementsReport(tenantId, membershipId, organizationId, periodStart, periodEnd);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('reports/fully-depreciated')
  reportFullyDepreciated(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.fullyDepreciated(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('reports/not-commissioned')
  reportNotCommissioned(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.notCommissioned(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('reports/disposals')
  reportDisposals(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.disposalsReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('reports/modernizations')
  reportModernizations(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.modernizationReport(tenantId, membershipId, organizationId);
  }

  // --- Health / reconciliation ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('reconciliation/asset-status')
  async reconcileAssetStatus(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reconciliation.reconcileAssetStatus(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('reconciliation/cip')
  async reconcileCip(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reconciliation.reconcileCIP(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('reconciliation/disposals')
  async validateDisposals(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reconciliation.validateDisposals(tenantId, organizationId);
  }

  // --- Single-asset-by-id routes MUST stay last: ':id' would otherwise
  // greedily match any other single-segment GET route declared after it
  // (e.g. 'health', 'inventory-counts') before Nest ever reaches the
  // literal-path handler. ---
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  getAsset(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.assets.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get(':id/movements')
  getAssetMovements(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.assets.movements(tenantId, membershipId, organizationId, id);
  }
}
