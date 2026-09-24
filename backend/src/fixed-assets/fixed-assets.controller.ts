import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { RequestContextService } from '../common/context/request-context.service';
import { PermissionDeniedError } from '../common/errors/app-error';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { withOptionalIdempotency } from './fixed-asset-idempotency';
import { WRITE_OFF_DISPOSAL_TYPES } from './fixed-assets.constants';
import {
  AcceptAssetDto,
  ChangeParametersDto,
  ChangeStatusDto,
  CommissionAssetDto,
  CreateFixedAssetDto,
  DisposeAssetDto,
  ImpairAssetDto,
  ModernizeAssetDto,
  OpeningBalancesDto,
  RepairAssetDto,
  ReplaceComponentDto,
  RevalueAssetDto,
  StartModernizationDto,
  TransferAssetsDto,
  TransferOneAssetDto,
  UpdateFixedAssetDto,
  WithdrawCapitalizationDto,
} from './dto/fixed-assets.dto';
import { FixedAssetService } from './fixed-asset.service';
import { FixedAssetAcceptanceService } from './fixed-asset-acceptance.service';
import { FixedAssetCommissioningService } from './fixed-asset-commissioning.service';
import { FixedAssetTransferService } from './fixed-asset-transfer.service';
import { FixedAssetModernizationService } from './fixed-asset-modernization.service';
import { FixedAssetImpairmentService } from './fixed-asset-impairment.service';
import { FixedAssetRevaluationService } from './fixed-asset-revaluation.service';
import { FixedAssetDisposalService } from './fixed-asset-disposal.service';
import { FixedAssetComponentService } from './fixed-asset-component.service';
import { FixedAssetCapitalizationService } from './fixed-asset-capitalization.service';

type User = { userId: string };

/**
 * Fixed asset card + lifecycle commands (spec section 143). Registered
 * LAST in FixedAssetsModule so the `:id` routes never shadow the more
 * specific sibling controllers (acquisition-candidates, cip, depreciation,
 * inventory-counts, documents, reports).
 */
@Controller('organizations/:organizationId/fixed-assets')
export class FixedAssetsController {
  constructor(
    private readonly assets: FixedAssetService,
    private readonly acceptance: FixedAssetAcceptanceService,
    private readonly commissioning: FixedAssetCommissioningService,
    private readonly transfers: FixedAssetTransferService,
    private readonly modernization: FixedAssetModernizationService,
    private readonly impairment: FixedAssetImpairmentService,
    private readonly revaluation: FixedAssetRevaluationService,
    private readonly disposal: FixedAssetDisposalService,
    private readonly components: FixedAssetComponentService,
    private readonly capitalization: FixedAssetCapitalizationService,
    private readonly ctx: RequestContextService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() t: string,
    @CurrentMembershipId() m: string,
    @Param('organizationId') o: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('locationId') locationId?: string,
    @Query('responsiblePersonId') responsiblePersonId?: string,
    @Query('parentAssetId') parentAssetId?: string,
    @Query('search') search?: string,
  ) {
    return this.assets.list(t, m, o, { status, categoryId, departmentId, locationId, responsiblePersonId, parentAssetId, search });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get('lookup')
  lookup(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('code') code: string) {
    return this.assets.findByCode(t, m, o, code);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  create(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: CreateFixedAssetDto) {
    return this.assets.create(t, m, o, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post('opening-balances')
  openingBalances(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: OpeningBalancesDto, @Headers('idempotency-key') key?: string) {
    return withOptionalIdempotency(this.idempotency, t, key, 'FA_OPENING_BALANCES', dto, () => this.acceptance.openingBalances(t, m, o, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_TRANSFER)
  @Post('transfer')
  transferMany(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: TransferAssetsDto) {
    return this.transfers.transfer(t, m, o, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.assets.getCard(t, m, o, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Patch(':id')
  update(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: UpdateFixedAssetDto) {
    return this.assets.update(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post(':id/withdraw-capitalization')
  withdraw(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: WithdrawCapitalizationDto) {
    return this.capitalization.withdraw(t, m, o, id, u.userId, dto.reason);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_ACCEPT)
  @Post(':id/accept')
  accept(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: AcceptAssetDto, @Headers('idempotency-key') key?: string) {
    return withOptionalIdempotency(this.idempotency, t, key, `FA_ACCEPT:${id}`, dto, () => this.acceptance.accept(t, m, o, id, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_COMMISSION)
  @Post(':id/commission')
  commission(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: CommissionAssetDto) {
    return this.commissioning.commission(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CHANGE_USEFUL_LIFE)
  @Post(':id/change-parameters')
  changeParameters(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ChangeParametersDto) {
    return this.commissioning.changeParameters(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MANUAL_ADJUSTMENT)
  @Post(':id/status')
  changeStatus(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ChangeStatusDto) {
    return this.commissioning.changeStatus(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_TRANSFER)
  @Post(':id/transfer')
  transfer(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: TransferOneAssetDto) {
    return this.transfers.transfer(t, m, o, u.userId, { ...dto, assetIds: [id] });
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MODERNIZE)
  @Post(':id/modernization/start')
  startModernization(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: StartModernizationDto) {
    return this.modernization.start(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MODERNIZE)
  @Post(':id/modernize')
  modernize(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ModernizeAssetDto, @Headers('idempotency-key') key?: string) {
    return withOptionalIdempotency(this.idempotency, t, key, `FA_MODERNIZE:${id}`, dto, () => this.modernization.modernize(t, m, o, id, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MODERNIZE)
  @Post(':id/repairs')
  repair(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: RepairAssetDto) {
    return this.modernization.repair(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_IMPAIR)
  @Post(':id/impair')
  impair(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ImpairAssetDto) {
    return this.impairment.impair(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_IMPAIR)
  @Post(':id/impairment-reversal')
  reverseImpairment(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ImpairAssetDto) {
    return this.impairment.reverseImpairment(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_REVALUE)
  @Post(':id/revalue')
  revalue(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: RevalueAssetDto) {
    return this.revaluation.revalue(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW, PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Post(':id/disposal-preview')
  disposalPreview(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Body() dto: DisposeAssetDto) {
    return this.disposal.preview(t, m, o, id, dto).then(({ _d, ...rest }) => rest);
  }

  /** Sale / donation / transfer-out need FIXED_ASSET_DISPOSE; write-off,
   * scrap, loss and theft need FIXED_ASSET_WRITE_OFF. */
  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Post(':id/dispose')
  dispose(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: DisposeAssetDto, @Headers('idempotency-key') key?: string) {
    const needed = WRITE_OFF_DISPOSAL_TYPES.includes(dto.disposalType) ? PermissionCodes.FIXED_ASSET_WRITE_OFF : PermissionCodes.FIXED_ASSET_DISPOSE;
    if (!this.ctx.hasPermission(needed)) throw new PermissionDeniedError(needed);
    return withOptionalIdempotency(this.idempotency, t, key, `FA_DISPOSE:${id}`, dto, () => this.disposal.dispose(t, m, o, id, u.userId, dto));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id/components')
  listComponents(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.components.list(t, m, o, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_DISPOSE)
  @Post(':id/components/replace')
  replaceComponent(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ReplaceComponentDto) {
    return this.components.replace(t, m, o, id, u.userId, dto);
  }
}
