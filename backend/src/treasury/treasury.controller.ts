import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentRequestService } from './payment-request.service';
import { TreasuryApprovalService } from './treasury-approval.service';
import { PaymentCalendarService } from './payment-calendar.service';
import { LiquidityForecastService } from './liquidity-forecast.service';
import { PaymentInstructionService } from './payment-instruction.service';
import { SettlementPaymentService } from '../settlement/settlement-payment.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { SETTLEMENT_PAYMENT_TYPE } from '../settlement/settlement-payment.repository';
import { BankStatementImportService } from './bank-statement-import.service';
import { BankMatchingService } from './bank-matching.service';
import { BankReconciliationService } from './bank-reconciliation.service';
import { InternalTransferService } from './internal-transfer.service';
import { BankFeeService } from './bank-fee.service';
import { FXConversionService } from './fx-conversion.service';
import { TreasuryHealthService } from './treasury-health.service';
import { TreasuryReportingService } from './treasury-reporting.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  CreatePaymentRequestDto,
  ApproveRequestDto,
  CreatePaymentInstructionDto,
  CreateBankPaymentDto,
  CreateInternalTransferDto,
  CreateBankFeeDto,
  CreateFXConversionDto,
  ImportBankStatementDto,
  ManualMatchDto,
} from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/treasury')
export class TreasuryController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly requests: PaymentRequestService,
    private readonly approvals: TreasuryApprovalService,
    private readonly calendar: PaymentCalendarService,
    private readonly liquidity: LiquidityForecastService,
    private readonly instructions: PaymentInstructionService,
    private readonly payments: SettlementPaymentService,
    private readonly posting: DocumentPostingService,
    private readonly statementImport: BankStatementImportService,
    private readonly matching: BankMatchingService,
    private readonly reconciliation: BankReconciliationService,
    private readonly transfers: InternalTransferService,
    private readonly fees: BankFeeService,
    private readonly fx: FXConversionService,
    private readonly health: TreasuryHealthService,
    private readonly reporting: TreasuryReportingService,
  ) {}

  // --- Payment Requests (Layer 1) ---

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('payment-requests')
  listRequests(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('status') status?: string) {
    return this.requests.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('payment-requests/:id')
  getRequest(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.requests.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_REQUEST_CREATE)
  @Post('payment-requests')
  createRequest(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreatePaymentRequestDto) {
    return this.requests.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_REQUEST_CREATE)
  @Post('payment-requests/:id/submit')
  submitRequest(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.requests.submit(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_REQUEST_APPROVE)
  @Post('payment-requests/:id/approve')
  approveRequest(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ApproveRequestDto) {
    return this.approvals.approve(tenantId, membershipId, organizationId, user.userId, id, dto.approvedAmount, dto.comment);
  }

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_REQUEST_APPROVE)
  @Post('payment-requests/:id/reject')
  rejectRequest(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('comment') comment?: string) {
    return this.approvals.reject(tenantId, membershipId, organizationId, user.userId, id, comment);
  }

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_REQUEST_CREATE)
  @Post('payment-requests/:id/cancel')
  cancelRequest(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.requests.cancel(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_PLAN)
  @Post('payment-instructions')
  createInstruction(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreatePaymentInstructionDto) {
    return this.instructions.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  // --- Calendar / Liquidity (Layer 1) ---

  @RequirePermissions(PermissionCodes.TREASURY_PAYMENT_PLAN)
  @Get('payment-calendar')
  getCalendar(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('bankAccountId') bankAccountId?: string, @Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.calendar.list(tenantId, organizationId, { bankAccountId, fromDate: fromDate ? new Date(fromDate) : undefined, toDate: toDate ? new Date(toDate) : undefined });
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_LIQUIDITY)
  @Get('liquidity')
  getLiquidity(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('bankAccountId') bankAccountId: string) {
    return this.liquidity.position(tenantId, organizationId, bankAccountId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_LIQUIDITY)
  @Get('liquidity/forecast')
  getForecast(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.liquidity.forecastByAccount(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_LIQUIDITY)
  @Get('liquidity/funding-suggestions')
  getFundingSuggestions(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.liquidity.fundingSuggestions(tenantId, organizationId);
  }

  // --- Bank Payments (Layer 2) ---

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('payments')
  async listPayments(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('counterpartyId') counterpartyId?: string) {
    return this.payments.list(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_CREATE_PAYMENT)
  @Post('payments')
  async createPayment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateBankPaymentDto) {
    return this.payments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TREASURY_POST_PAYMENT)
  @Post('payments/:id/post')
  async postPayment(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, SETTLEMENT_PAYMENT_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_CANCEL_PAYMENT)
  @Post('payments/:id/unpost')
  async unpostPayment(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.unpost(tenantId, SETTLEMENT_PAYMENT_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_INTERNAL_TRANSFER)
  @Post('internal-transfers')
  async createTransfer(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateInternalTransferDto) {
    return this.transfers.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TREASURY_INTERNAL_TRANSFER)
  @Post('internal-transfers/:id/credit-destination')
  async creditDestination(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.transfers.creditDestination(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_CREATE_PAYMENT)
  @Post('bank-fees')
  async createFee(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateBankFeeDto) {
    return this.fees.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TREASURY_FX_CONVERSION)
  @Post('fx-conversions')
  async createFx(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateFXConversionDto) {
    return this.fx.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  // --- Bank Statements / Matching / Reconciliation ---

  @RequirePermissions(PermissionCodes.TREASURY_IMPORT_STATEMENT)
  @Post('bank-statements/import')
  async importStatement(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: ImportBankStatementDto) {
    return this.statementImport.import(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_BANK_BALANCE)
  @Get('bank-statements/:id')
  async getStatement(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return { statement: id }; // detail fetched via list endpoints per-account in practice; kept minimal
  }

  @RequirePermissions(PermissionCodes.TREASURY_MATCH_BANK_TRANSACTION)
  @Get('bank-statement-lines/:id/suggestions')
  async suggestMatches(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.matching.suggest(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_MATCH_BANK_TRANSACTION)
  @Post('bank-statement-lines/:id/auto-match')
  async autoMatch(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.matching.autoMatch(tenantId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_MATCH_BANK_TRANSACTION)
  @Post('bank-statement-lines/:id/match')
  async manualMatch(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ManualMatchDto) {
    return this.matching.manualMatch(tenantId, id, dto.matchedDocumentType, dto.matchedDocumentId, user.userId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_OVERRIDE_MATCH)
  @Post('bank-transaction-matches/:id/reverse')
  async reverseMatch(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.matching.reverseMatch(tenantId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_RECONCILE_BANK)
  @Post('reconciliations')
  async createReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('statementId') statementId: string) {
    return this.reconciliation.create(tenantId, membershipId, organizationId, user.userId, statementId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_CLOSE_RECONCILIATION)
  @Post('reconciliations/:id/close')
  async closeReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.reconciliation.close(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TREASURY_CLOSE_RECONCILIATION)
  @Post('reconciliations/:id/reopen')
  async reopenReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('reason') reason: string) {
    return this.reconciliation.reopen(tenantId, membershipId, organizationId, user.userId, id, reason);
  }

  // --- Reports / Health ---

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_BANK_BALANCE)
  @Get('reports/bank-balances')
  async bankBalances(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.bankBalances(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('reports/plan-vs-actual')
  async planVsActual(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) {
    return this.reporting.planVsActual(tenantId, organizationId, new Date(fromDate), new Date(toDate));
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('reports/unmatched-transactions')
  async unmatched(@CurrentTenantId() tenantId: string, @Query('bankAccountId') bankAccountId: string) {
    return this.reporting.unmatchedBankTransactions(tenantId, bankAccountId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('reports/outstanding-payments')
  async outstanding(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('bankAccountId') bankAccountId?: string) {
    return this.reporting.outstandingPayments(tenantId, organizationId, bankAccountId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('reports/bank-fees')
  async bankFees(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('fromDate') fromDate: string, @Query('toDate') toDate: string) {
    return this.reporting.bankFeesReport(tenantId, organizationId, new Date(fromDate), new Date(toDate));
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('reports/internal-transfers')
  async internalTransfers(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.internalTransfersReport(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW)
  @Get('reports/fx-conversions')
  async fxConversions(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.fxConversionsReport(tenantId, organizationId);
  }
}
