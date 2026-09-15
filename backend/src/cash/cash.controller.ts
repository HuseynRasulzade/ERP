import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CashDeskService } from './cash-desk.service';
import { CashierAssignmentService } from './cashier-assignment.service';
import { CashDeskTransferService } from './cash-desk-transfer.service';
import { CashPhysicalCountService } from './cash-physical-count.service';
import { CashCountAdjustmentService } from './cash-count-adjustment.service';
import { CashDailyCloseService } from './cash-daily-close.service';
import { CashierHandoverService } from './cashier-handover.service';
import { CashHealthService } from './cash-health.service';
import { SettlementPaymentService } from '../settlement/settlement-payment.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { SETTLEMENT_PAYMENT_TYPE } from '../settlement/settlement-payment.repository';
import { CASH_DESK_TRANSFER_TYPE } from './cash-desk-transfer.repository';
import { CASH_COUNT_ADJUSTMENT_TYPE } from './cash-count-adjustment.repository';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  CreateCashPaymentDto,
  CreateCashDeskTransferDto,
  ReceiveCashDeskTransferDto,
  CashPhysicalCountDto,
  SeedDenominationMasterDto,
  CreateCashCountAdjustmentDto,
  AssignCashierDto,
  InitiateHandoverDto,
  DailyCloseAttemptDto,
  ReopenDailyCloseDto,
} from './dto/cash.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Cash / Kassa API (docx spec Phase 15). Cash receipt/expense orders are
 * `SettlementPayment` with `cashDeskId` set (see schema.prisma's own doc
 * on that model) — this controller reuses `SettlementPaymentService` and
 * the shared `DocumentPostingService` lifecycle for them rather than
 * duplicating create/post/unpost routes a third time.
 */
@Controller('organizations/:organizationId/cash')
export class CashController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly desks: CashDeskService,
    private readonly assignments: CashierAssignmentService,
    private readonly transfers: CashDeskTransferService,
    private readonly physicalCounts: CashPhysicalCountService,
    private readonly countAdjustments: CashCountAdjustmentService,
    private readonly dailyClose: CashDailyCloseService,
    private readonly handovers: CashierHandoverService,
    private readonly health: CashHealthService,
    private readonly payments: SettlementPaymentService,
    private readonly posting: DocumentPostingService,
  ) {}

  // --- Cash desks & cashier assignment ---

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('desks')
  listDesks(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.desks.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('desks/:id/balance')
  deskBalance(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.desks.balance(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_ASSIGN_CASHIER)
  @Post('cashier-assignments')
  assignCashier(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: AssignCashierDto) {
    return this.assignments.assign(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_ASSIGN_CASHIER)
  @Post('cashier-assignments/:id/end')
  endCashierAssignment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.assignments.end(tenantId, membershipId, organizationId, user.userId, id);
  }

  // --- Cash receipt/expense orders (= SettlementPayment with cashDeskId) ---

  @RequirePermissions(PermissionCodes.CASH_CREATE_PAYMENT)
  @Post('payments')
  createPayment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCashPaymentDto) {
    return this.payments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('payments')
  listPayments(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('counterpartyId') counterpartyId?: string) {
    return this.payments.list(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.CASH_POST_PAYMENT)
  @Post('payments/:id/post')
  postPayment(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, SETTLEMENT_PAYMENT_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.CASH_CANCEL_PAYMENT)
  @Post('payments/:id/unpost')
  unpostPayment(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.unpost(tenantId, SETTLEMENT_PAYMENT_TYPE, id, expectedVersion, user.userId);
  }

  // --- Cash desk transfers ---

  @RequirePermissions(PermissionCodes.CASH_TRANSFER)
  @Post('transfers')
  createTransfer(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCashDeskTransferDto) {
    return this.transfers.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSFER)
  @Post('transfers/:id/post')
  postTransfer(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, CASH_DESK_TRANSFER_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSFER)
  @Post('transfers/:id/receive')
  receiveTransfer(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ReceiveCashDeskTransferDto) {
    return this.transfers.receive(tenantId, membershipId, organizationId, user.userId, id, dto.receivedAmount);
  }

  // --- Physical count / denominations ---

  @RequirePermissions(PermissionCodes.CASH_COUNT)
  @Post('physical-counts')
  count(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CashPhysicalCountDto) {
    return this.physicalCounts.count(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('denominations/:currencyId')
  listDenominations(@Param('currencyId') currencyId: string, @CurrentTenantId() tenantId: string) {
    return this.physicalCounts.listDenominationMaster(tenantId, currencyId);
  }

  @RequirePermissions(PermissionCodes.CASH_OVERRIDE_LIMIT)
  @Post('denominations/seed')
  seedDenominations(@CurrentTenantId() tenantId: string, @Body() dto: SeedDenominationMasterDto) {
    return this.physicalCounts.seedDenominationMaster(tenantId, dto.currencyId, dto.values);
  }

  // --- Count adjustments ---

  @RequirePermissions(PermissionCodes.CASH_CREATE_ADJUSTMENT)
  @Post('count-adjustments')
  createAdjustment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCashCountAdjustmentDto) {
    return this.countAdjustments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('count-adjustments')
  listAdjustments(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('cashDeskId') cashDeskId?: string) {
    return this.countAdjustments.list(tenantId, membershipId, organizationId, cashDeskId);
  }

  @RequirePermissions(PermissionCodes.CASH_APPROVE_ADJUSTMENT)
  @Post('count-adjustments/:id/post')
  postAdjustment(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, CASH_COUNT_ADJUSTMENT_TYPE, id, expectedVersion, user.userId);
  }

  // --- Cashier handover ---

  @RequirePermissions(PermissionCodes.CASH_HANDOVER)
  @Post('handovers')
  initiateHandover(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: InitiateHandoverDto) {
    return this.handovers.initiate(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_HANDOVER)
  @Post('handovers/:id/resolve-difference')
  resolveHandoverDifference(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('resolutionNote') resolutionNote: string) {
    return this.handovers.resolveDifference(tenantId, membershipId, organizationId, user.userId, id, resolutionNote);
  }

  @RequirePermissions(PermissionCodes.CASH_HANDOVER)
  @Post('handovers/:id/complete')
  completeHandover(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.handovers.complete(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_HANDOVER)
  @Post('handovers/:id/cancel')
  cancelHandover(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.handovers.cancel(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('handovers')
  listHandovers(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('cashDeskId') cashDeskId: string) {
    return this.handovers.list(tenantId, membershipId, organizationId, cashDeskId);
  }

  // --- Daily close ---

  @RequirePermissions(PermissionCodes.CASH_DAILY_CLOSE)
  @Post('daily-close')
  attemptClose(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: DailyCloseAttemptDto) {
    return this.dailyClose.attempt(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_REOPEN_DAY)
  @Post('daily-close/:id/reopen')
  reopenClose(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ReopenDailyCloseDto) {
    return this.dailyClose.reopen(tenantId, membershipId, organizationId, user.userId, id, dto.reason);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('daily-close')
  listCloses(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('cashDeskId') cashDeskId: string) {
    return this.dailyClose.list(tenantId, membershipId, organizationId, cashDeskId);
  }

  // --- Health ---

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }
}
