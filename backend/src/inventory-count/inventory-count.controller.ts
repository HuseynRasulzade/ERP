import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes as P } from '../rbac/permission-codes';
import {
  AddAttachmentDto,
  CommentDto,
  CompleteRecountDto,
  CreateAdjustmentsDto,
  CreateInventoryCountPlanDto,
  CreateReasonCodeDto,
  CreateTaskDto,
  GenerateSheetsDto,
  ImportEntriesDto,
  ReasonDto,
  RecordEntriesDto,
  RequestRecountDto,
  ReviewUnknownItemDto,
  ScanDto,
  SnapshotDto,
  UpdateEntryDto,
  UpdateInventoryCountPlanDto,
  UpdateVarianceDto,
} from './dto/inventory-count.dto';
import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountSheetService } from './inventory-count-sheet.service';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryVarianceResolutionService } from './inventory-variance-resolution.service';
import { InventoryRecountService } from './inventory-recount.service';
import { InventoryCountApprovalService } from './inventory-count-approval.service';
import { InventoryCountAdjustmentService } from './inventory-count-adjustment.service';
import { InventoryCountReconciliationService } from './inventory-count-reconciliation.service';
import { InventoryCountReportingService } from './inventory-count-reporting.service';
import { InventoryCountAttachmentService } from './inventory-count-attachment.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountEventsService } from './inventory-count-events.service';

type User = { userId: string };

/**
 * Inventory Count API (spec section 98). `:id` is the inventory count
 * (plan); every session-level command acts on the plan's current session.
 * Posting of the generated adjustment documents also works through the
 * generic `/documents/INVENTORY_COUNT_ADJUSTMENT/:id/post|unpost` surface.
 */
@Controller('organizations/:organizationId/inventory-counts')
export class InventoryCountController {
  constructor(
    private readonly plans: InventoryCountPlanService,
    private readonly sessions: InventoryCountSessionService,
    private readonly sheets: InventoryCountSheetService,
    private readonly entries: InventoryCountEntryService,
    private readonly variances: InventoryVarianceService,
    private readonly resolutions: InventoryVarianceResolutionService,
    private readonly recounts: InventoryRecountService,
    private readonly approvals: InventoryCountApprovalService,
    private readonly adjustments: InventoryCountAdjustmentService,
    private readonly reconciliation: InventoryCountReconciliationService,
    private readonly reporting: InventoryCountReportingService,
    private readonly attachments: InventoryCountAttachmentService,
    private readonly snapshots: InventorySnapshotService,
    private readonly events: InventoryCountEventsService,
  ) {}

  // -- plan -------------------------------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get()
  list(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('status') status?: string) {
    return this.plans.list(t, m, o, { status });
  }

  @RequirePermissions(P.INVENTORY_COUNT_CREATE)
  @Post()
  create(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @CurrentUser() u: User, @Body() dto: CreateInventoryCountPlanDto) {
    return this.plans.create(t, m, o, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.plans.get(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CREATE)
  @Put(':id')
  update(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: UpdateInventoryCountPlanDto) {
    return this.plans.update(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/scope/preview')
  previewScope(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.plans.previewScope(t, m, o, id, this.sessions.hasPermission(P.INVENTORY_COUNT_VIEW_ACCOUNTING_QTY));
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/audit')
  audit(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.reporting.auditHistory(t, m, o, id);
  }

  // -- session lifecycle --------------------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/session')
  session(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.sessions.getSessionDetail(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_START)
  @Post(':id/start')
  start(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.sessions.start(t, m, o, id, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CREATE_SNAPSHOT)
  @Post(':id/snapshot')
  snapshot(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: SnapshotDto) {
    return this.sessions.snapshot(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW, P.INVENTORY_COUNT_VIEW_ACCOUNTING_QTY)
  @Get(':id/snapshot')
  async getSnapshot(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    const { session } = await this.sessions.loadContext(t, m, o, id);
    const showQty = this.sessions.canSeeAccountingQty(session);
    const showCost = this.sessions.canSeeCost();
    const lines = await this.snapshots.lines(t, session.id, session.snapshotVersion);
    return {
      snapshotVersion: session.snapshotVersion,
      snapshotAt: session.snapshotAt,
      accountingQuantityVisible: showQty,
      lines: lines.map((l) => ({ ...l, accountingQuantity: showQty ? l.accountingQuantity : undefined, baseQuantity: showQty ? l.baseQuantity : undefined, unitCost: showCost ? l.unitCost : undefined, stockValue: showCost ? l.stockValue : undefined })),
    };
  }

  @RequirePermissions(P.INVENTORY_COUNT_FREEZE)
  @Post(':id/freeze')
  freeze(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.sessions.freeze(t, m, o, id, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_FREEZE)
  @Post(':id/unfreeze')
  unfreeze(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ReasonDto) {
    return this.sessions.unfreeze(t, m, o, id, u.userId, dto.reason);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/movements')
  movements(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.sessions.postSnapshotMovements(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CANCEL)
  @Post(':id/cancel')
  cancel(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ReasonDto) {
    return this.sessions.cancel(t, m, o, id, u.userId, dto.reason, false);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CANCEL)
  @Post(':id/reopen')
  reopen(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ReasonDto) {
    return this.sessions.cancel(t, m, o, id, u.userId, dto.reason, true);
  }

  // -- sheets / tasks -------------------------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_START)
  @Post(':id/sheets/generate')
  generateSheets(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: GenerateSheetsDto) {
    return this.sheets.generate(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/sheets')
  listSheets(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.sheets.list(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/sheets/:sheetId')
  getSheet(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('sheetId') sheetId: string) {
    return this.sheets.getSheet(t, m, o, id, sheetId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/sheets/:sheetId/print')
  printSheet(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('sheetId') sheetId: string) {
    return this.sheets.printable(t, m, o, id, sheetId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_START)
  @Post(':id/sheets/:sheetId/tasks')
  createTask(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('sheetId') sheetId: string, @CurrentUser() u: User, @Body() dto: CreateTaskDto) {
    return this.sheets.createTask(t, m, o, id, sheetId, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/tasks/:taskId/complete')
  completeTask(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('taskId') taskId: string, @CurrentUser() u: User) {
    return this.sheets.completeTask(t, m, o, id, taskId, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/sheets/:sheetId/complete')
  completeSheet(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('sheetId') sheetId: string, @CurrentUser() u: User) {
    return this.sheets.completeSheet(t, m, o, id, sheetId, u.userId);
  }

  // -- entries ------------------------------------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/entries')
  recordEntries(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: RecordEntriesDto) {
    return this.entries.record(t, m, o, id, u.userId, dto.entries);
  }

  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/entries/scan')
  scan(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ScanDto) {
    return this.entries.scan(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/entries/import')
  importEntries(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: ImportEntriesDto) {
    return this.entries.importCsv(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/entries')
  listEntries(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Query('sheetId') sheetId?: string, @Query('history') history?: string) {
    return this.entries.list(t, m, o, id, { sheetId, includeHistory: history === 'true' });
  }

  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Patch(':id/entries/:entryId')
  updateEntry(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() u: User, @Body() dto: UpdateEntryDto) {
    return this.entries.update(t, m, o, id, entryId, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/entries/:entryId/void')
  voidEntry(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() u: User, @Body() dto: ReasonDto) {
    return this.entries.void(t, m, o, id, entryId, u.userId, dto.reason);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Post(':id/entries/:entryId/review')
  reviewUnknown(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() u: User, @Body() dto: ReviewUnknownItemDto) {
    return this.entries.reviewUnknown(t, m, o, id, entryId, u.userId, dto);
  }

  // -- completion / variances / recounts ---------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_ENTER)
  @Post(':id/complete-count')
  async completeCount(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    const session = await this.sessions.completeCount(t, m, o, id, u.userId);
    const summary = await this.variances.calculate(t, m, o, id, u.userId);
    return { session: { ...session, status: summary.pendingRecounts > 0 ? 'RECOUNT_REQUIRED' : 'UNDER_REVIEW' }, variances: summary };
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Post(':id/calculate-variances')
  calculate(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.variances.calculate(t, m, o, id, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get(':id/variances')
  listVariances(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Query('varianceType') varianceType?: string, @Query('onlyDifferences') onlyDifferences?: string) {
    return this.variances.list(t, m, o, id, { varianceType, onlyDifferences: onlyDifferences === 'true' });
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get(':id/variances/:varianceId')
  varianceHistory(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('varianceId') varianceId: string) {
    return this.resolutions.history(t, m, o, id, varianceId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Patch(':id/variances/:varianceId')
  updateVariance(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('varianceId') varianceId: string, @CurrentUser() u: User, @Body() dto: UpdateVarianceDto) {
    return this.resolutions.update(t, m, o, id, varianceId, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_RECOUNT)
  @Post(':id/recounts')
  requestRecount(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: RequestRecountDto) {
    return this.recounts.request(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/recounts')
  listRecounts(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Query('status') status?: string) {
    return this.recounts.list(t, m, o, id, { status });
  }

  @RequirePermissions(P.INVENTORY_COUNT_RECOUNT)
  @Post(':id/recounts/:recountId/complete')
  completeRecount(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @Param('recountId') recountId: string, @CurrentUser() u: User, @Body() dto: CompleteRecountDto) {
    return this.recounts.complete(t, m, o, id, recountId, u.userId, dto);
  }

  // -- approval / adjustments / reconciliation ------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Post(':id/submit')
  submit(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.approvals.submit(t, m, o, id, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_APPROVE)
  @Post(':id/approve')
  approve(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: CommentDto) {
    return this.approvals.approve(t, m, o, id, u.userId, dto.comment);
  }

  @RequirePermissions(P.INVENTORY_COUNT_APPROVE)
  @Post(':id/reject')
  reject(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: CommentDto) {
    return this.approvals.reject(t, m, o, id, u.userId, dto.comment);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/approval-steps')
  async approvalSteps(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    const { session } = await this.sessions.loadContext(t, m, o, id);
    return this.approvals.steps(t, session.id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_POST_ADJUSTMENT)
  @Post(':id/create-adjustments')
  createAdjustments(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: CreateAdjustmentsDto) {
    return this.adjustments.createAdjustments(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/adjustments')
  listAdjustments(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.adjustments.list(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_POST_ADJUSTMENT)
  @Post(':id/post-adjustments')
  postAdjustments(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.adjustments.postAdjustments(t, m, o, id, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CLOSE)
  @Post(':id/reconcile')
  reconcile(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.reconciliation.reconcile(t, m, o, id, u.userId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/reconciliation')
  getReconciliation(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.reconciliation.get(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CLOSE)
  @Post(':id/close')
  close(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User) {
    return this.reconciliation.close(t, m, o, id, u.userId);
  }

  // -- progress / reports / attachments / events -------------------------------------------
  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/progress')
  progress(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.reporting.progress(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get(':id/reports/serials')
  serialReport(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.reporting.serialReport(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get(':id/reports/batches')
  batchReport(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.reporting.batchReport(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get(':id/reports/locations')
  locationReport(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.reporting.locationReport(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Post(':id/attachments')
  addAttachment(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string, @CurrentUser() u: User, @Body() dto: AddAttachmentDto) {
    return this.attachments.add(t, m, o, id, u.userId, dto);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/attachments')
  listAttachments(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    return this.attachments.list(t, m, o, id);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get(':id/events')
  async listEvents(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('id') id: string) {
    await this.sessions.loadPlan(t, m, o, id);
    return this.events.list(t, { planId: id });
  }
}

/** Cross-count reports + Phase 22/30 integration queries (spec sections 88-91, 106-107). */
@Controller('organizations/:organizationId/inventory-count-reports')
export class InventoryCountReportsController {
  constructor(private readonly reporting: InventoryCountReportingService) {}

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get('dashboard')
  dashboard(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string) {
    return this.reporting.dashboard(t, m, o);
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get('variances')
  variances(
    @CurrentTenantId() t: string,
    @CurrentMembershipId() m: string,
    @Param('organizationId') o: string,
    @Query('sessionId') sessionId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('onlyDifferences') onlyDifferences?: string,
  ) {
    return this.reporting.varianceReport(t, m, o, { sessionId, warehouseId, productId, from, to, onlyDifferences: onlyDifferences === 'true' });
  }

  @RequirePermissions(P.INVENTORY_COUNT_REVIEW)
  @Get('surplus-shortage')
  surplusShortage(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('groupBy') groupBy?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.surplusShortageReport(t, m, o, { groupBy, from, to });
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get('count-history/:productId')
  countHistory(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Param('productId') productId: string) {
    return this.reporting.countHistory(t, m, o, productId);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get('close-readiness')
  closeReadiness(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string, @Query('from') from: string, @Query('to') to: string) {
    return this.reporting.closeReadiness(t, m, o, from, to);
  }

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get('health')
  health(@CurrentTenantId() t: string, @CurrentMembershipId() m: string, @Param('organizationId') o: string) {
    return this.reporting.health(t, m, o);
  }
}

/** Configurable variance reason catalog (spec section 45). */
@Controller('inventory-count-reason-codes')
export class InventoryCountReasonCodesController {
  constructor(private readonly resolutions: InventoryVarianceResolutionService) {}

  @RequirePermissions(P.INVENTORY_COUNT_VIEW)
  @Get()
  list(@CurrentTenantId() t: string) {
    return this.resolutions.listReasonCodes(t);
  }

  @RequirePermissions(P.INVENTORY_COUNT_CREATE)
  @Post()
  create(@CurrentTenantId() t: string, @CurrentUser() u: User, @Body() dto: CreateReasonCodeDto) {
    return this.resolutions.createReasonCode(t, u.userId, dto);
  }
}
