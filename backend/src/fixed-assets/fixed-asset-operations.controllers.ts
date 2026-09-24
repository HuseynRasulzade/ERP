import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { withOptionalIdempotency } from './fixed-asset-idempotency';
import { toDate } from './fixed-assets.constants';
import {
  CapitalizeCipDto,
  CipStatusDto,
  ClassifyCandidateDto,
  CreateAssetsFromCandidatesDto,
  CreateCipProjectDto,
  CreateFixedAssetCategoryDto,
  CreateFixedAssetLocationDto,
  CreateFixedAssetPolicyDto,
  CreateInventoryCountDto,
  CreateManualCandidateDto,
  DepreciationPeriodDto,
  ExpenseCipDto,
  PostDepreciationDto,
  ReopenDepreciationPeriodDto,
  ResolveInventoryResultDto,
  ReverseDepreciationDto,
  ReverseDocumentDto,
  ScanInventoryDto,
  UpdateFixedAssetCategoryDto,
} from './dto/fixed-assets.dto';
import { FixedAssetSettingsService } from './fixed-asset-settings.service';
import { FixedAssetAcquisitionService } from './fixed-asset-acquisition.service';
import { FixedAssetCapitalizationService } from './fixed-asset-capitalization.service';
import { CapitalInvestmentService } from './capital-investment.service';
import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { FixedAssetInventoryService } from './fixed-asset-inventory.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetReportingService } from './fixed-asset-reporting.service';
import { FixedAssetReconciliationService } from './fixed-asset-reconciliation.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

type User = { userId: string };

/** Tenant-wide configuration: categories and policies (spec sections 7, 78). */
@Controller('fixed-asset-settings')
export class FixedAssetSettingsController {
  constructor(private readonly settings: FixedAssetSettingsService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('categories')
  listCategories(@CurrentTenantId() t: string) {
    return this.settings.listCategories(t);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_SETTINGS_MANAGE)
  @Post('categories')
  createCategory(@CurrentTenantId() t: string, @CurrentUser() u: User, @Body() dto: CreateFixedAssetCategoryDto) {
    return this.settings.createCategory(t, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_SETTINGS_MANAGE)
  @Patch('categories/:id')
  updateCategory(@CurrentTenantId() t: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: UpdateFixedAssetCategoryDto) {
    return this.settings.updateCategory(t, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('policies')
  listPolicies(@CurrentTenantId() t: string) {
    return this.settings.listPolicies(t);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_SETTINGS_MANAGE)
  @Post('policies')
  createPolicy(@CurrentTenantId() t: string, @CurrentUser() u: User, @Body() dto: CreateFixedAssetPolicyDto) {
    return this.settings.createPolicy(t, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_SETTINGS_MANAGE)
  @Post('policies/:id/deactivate')
  deactivatePolicy(@CurrentTenantId() t: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.settings.deactivatePolicy(t, id, u.userId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('methods')
  methods() {
    return { supported: this.settings.supportedMethods() };
  }
}

@Controller('organizations/:organizationId/fixed-asset-locations')
export class FixedAssetLocationsController {
  constructor(private readonly settings: FixedAssetSettingsService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string) {
    return this.settings.listLocations(t, m, o);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_SETTINGS_MANAGE)
  @Post()
  create(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Body() dto: CreateFixedAssetLocationDto) {
    return this.settings.createLocation(t, m, o, dto);
  }
}

/** Acquisition workbench (spec sections 4-6, 108). */
@Controller('organizations/:organizationId/fixed-assets/acquisition-candidates')
export class FixedAssetAcquisitionController {
  constructor(
    private readonly acquisition: FixedAssetAcquisitionService,
    private readonly capitalization: FixedAssetCapitalizationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('status') status?: string, @Query('unprocessed') unprocessed?: string, @Query('sourceDocumentId') sourceDocumentId?: string) {
    return this.acquisition.list(t, m, o, { status, unprocessed: unprocessed === 'true', sourceDocumentId });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  createManual(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: CreateManualCandidateDto, @Headers('idempotency-key') key?: string) {
    return withOptionalIdempotency(this.idempotency, t, key, 'FA_MANUAL_CANDIDATE', dto, () => this.acquisition.createManual(t, m, o, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post('create-assets')
  createAssets(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: CreateAssetsFromCandidatesDto, @Headers('idempotency-key') key?: string) {
    return withOptionalIdempotency(this.idempotency, t, key, 'FA_CREATE_ASSETS', dto, () => this.capitalization.createFromCandidates(t, m, o, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.acquisition.get(t, m, o, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/classify')
  classify(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ClassifyCandidateDto) {
    return this.acquisition.classify(t, m, o, id, u.userId, dto);
  }
}

/** Capital investment / construction in progress (spec sections 8-12, 109). */
@Controller('organizations/:organizationId/fixed-assets/cip')
export class CapitalInvestmentController {
  constructor(
    private readonly cip: CapitalInvestmentService,
    private readonly capitalization: FixedAssetCapitalizationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('status') status?: string) {
    return this.cip.list(t, m, o, { status });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  create(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: CreateCipProjectDto) {
    return this.cip.create(t, m, o, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.cip.get(t, m, o, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/status')
  status(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: CipStatusDto) {
    return this.cip.setStatus(t, m, o, id, u.userId, dto.status, dto.reason);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/capitalize')
  capitalize(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: CapitalizeCipDto, @Headers('idempotency-key') key?: string) {
    return withOptionalIdempotency(this.idempotency, t, key, `FA_CIP_CAPITALIZE:${id}`, dto, () => this.capitalization.capitalizeCip(t, m, o, id, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/expense')
  expense(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ExpenseCipDto) {
    return this.cip.expenseResidual(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/close')
  close(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.cip.close(t, m, o, id, u.userId);
  }
}

/** Depreciation workbench (spec sections 28-34, 92-93, 110). */
@Controller('organizations/:organizationId/fixed-assets/depreciation')
export class FixedAssetDepreciationController {
  constructor(
    private readonly depreciation: FixedAssetDepreciationService,
    private readonly orgAccess: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('preview')
  preview(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('period') period: string, @Query('bookCode') bookCode?: string) {
    return this.depreciation.preview(t, m, o, period, bookCode);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('status')
  status(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('period') period: string, @Query('bookCode') bookCode?: string) {
    return this.depreciation.status(t, m, o, period, bookCode);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Post('calculate')
  calculate(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: DepreciationPeriodDto) {
    return this.depreciation.calculate(t, m, o, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_POST)
  @Post('post')
  post(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: PostDepreciationDto) {
    return this.depreciation.post(t, m, o, u.userId, dto.runId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('runs')
  runs(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('period') period?: string, @Query('bookCode') bookCode?: string) {
    return this.depreciation.listRuns(t, m, o, { period, bookCode });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('runs/:runId')
  run(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('runId') runId: string) {
    return this.depreciation.getRunChecked(t, m, o, runId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_POST)
  @Post('runs/:runId/reverse')
  reverse(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('runId') runId: string, @CurrentUser() u: User, @Body() dto: ReverseDepreciationDto) {
    return this.depreciation.reverse(t, m, o, u.userId, runId, dto.reason);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_CALCULATE)
  @Get('close-validation')
  async closeValidation(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('period') period: string, @Query('bookCode') bookCode?: string) {
    await this.orgAccess.assertAccess(t, m, o);
    return this.depreciation.validateClose(t, o, period, bookCode);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DEPRECIATION_POST)
  @Post('finalize')
  finalize(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: DepreciationPeriodDto) {
    return this.depreciation.finalize(t, m, o, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_PERIOD_OVERRIDE)
  @Post('reopen')
  reopen(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: ReopenDepreciationPeriodDto) {
    return this.depreciation.reopen(t, m, o, u.userId, dto);
  }
}

/** Physical asset inventory (spec sections 59-64, 113). */
@Controller('organizations/:organizationId/fixed-assets/inventory-counts')
export class FixedAssetInventoryController {
  constructor(private readonly inventory: FixedAssetInventoryService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Get()
  list(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string) {
    return this.inventory.list(t, m, o);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post()
  create(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: CreateInventoryCountDto) {
    return this.inventory.create(t, m, o, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Get(':id')
  get(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.inventory.get(t, m, o, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post(':id/scan')
  scan(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ScanInventoryDto) {
    return this.inventory.scan(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post(':id/complete')
  complete(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.inventory.complete(t, m, o, id, u.userId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_INVENTORY)
  @Post('results/:resultId/resolve')
  resolve(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('resultId') resultId: string, @CurrentUser() u: User, @Body() dto: ResolveInventoryResultDto) {
    return this.inventory.resolve(t, m, o, resultId, u.userId, dto);
  }
}

/** Lifecycle document journal + dependency-safe reversal (spec sections 83, 132-135). */
@Controller('organizations/:organizationId/fixed-assets/documents')
export class FixedAssetDocumentsController {
  constructor(
    private readonly documents: FixedAssetDocumentService,
    private readonly orgAccess: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  async list(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('documentType') documentType?: string, @Query('assetId') assetId?: string) {
    await this.orgAccess.assertAccess(t, m, o);
    return this.documents.list(t, o, { documentType, assetId });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  async get(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    await this.orgAccess.assertAccess(t, m, o);
    return this.documents.get(t, o, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post(':id/reverse')
  async reverse(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ReverseDocumentDto) {
    await this.orgAccess.assertAccess(t, m, o);
    return this.documents.reverse(t, o, id, u.userId, dto);
  }
}

/** Reports, reconciliation and health (spec sections 114-125). */
@Controller('organizations/:organizationId/fixed-assets/reports')
export class FixedAssetReportsController {
  constructor(
    private readonly reporting: FixedAssetReportingService,
    private readonly reconciliation: FixedAssetReconciliationService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('register')
  register(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('asOf') asOf?: string, @Query('categoryId') categoryId?: string, @Query('status') status?: string, @Query('departmentId') departmentId?: string) {
    return this.reporting.register(t, m, o, { asOf, categoryId, status, departmentId });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('depreciation-schedule')
  schedule(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('assetId') assetId?: string, @Query('fromPeriod') fromPeriod?: string, @Query('toPeriod') toPeriod?: string, @Query('bookCode') bookCode?: string) {
    return this.reporting.depreciationSchedule(t, m, o, { assetId, fromPeriod, toPeriod, bookCode });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('movements')
  movements(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('from') from: string, @Query('to') to: string) {
    return this.reporting.movements(t, m, o, { from, to });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('cip')
  cip(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('from') from: string, @Query('to') to: string) {
    return this.reporting.cip(t, m, o, { from, to });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('fully-depreciated')
  fullyDepreciated(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string) {
    return this.reporting.fullyDepreciated(t, m, o);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('not-commissioned')
  notCommissioned(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('asOf') asOf?: string) {
    return this.reporting.notCommissioned(t, m, o, { asOf });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('inventory-differences')
  inventoryDifferences(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('countId') countId?: string) {
    return this.reporting.inventoryDifferences(t, m, o, { countId });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('modernizations')
  modernizations(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string) {
    return this.reporting.modernizations(t, m, o);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('disposals')
  disposals(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.disposals(t, m, o, { from, to });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('book-tax-difference')
  bookTax(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('asOf') asOf?: string) {
    return this.reporting.bookTaxDifference(t, m, o, { asOf });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('reconciliation')
  reconcile(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('asOf') asOf?: string) {
    return this.reconciliation.reconcileChecked(t, m, o, asOf ? toDate(asOf) : toDate(new Date()));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_ACCOUNTING)
  @Get('health')
  health(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('asOf') asOf?: string, @Query('staleDays') staleDays?: string) {
    return this.reporting.health(t, m, o, { asOf, staleDays: staleDays ? Number(staleDays) : undefined });
  }
}
