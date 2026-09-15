import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SettlementPaymentService } from './settlement-payment.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { AdvanceService } from './advance.service';
import { DebtAdjustmentService } from './debt-adjustment.service';
import { SettlementOffsetService } from './settlement-offset.service';
import { SettlementReconciliationService } from './settlement-reconciliation.service';
import { SettlementReportingService } from './settlement-reporting.service';
import { AgeingService } from './ageing.service';
import { CreditExposureService } from './credit-exposure.service';
import { SettlementHealthService } from './settlement-health.service';
import { SettlementPolicyService } from './settlement-policy.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CreateSettlementPaymentDto, ManualAllocationDto, AutoAllocationDto, ApplyAdvanceDto, CreateDebtAdjustmentDto, CreateSettlementOffsetDto, GenerateReconciliationDto } from './dto/settlement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Settlement API (spec section 146). One controller for the whole module
 * — every route shares the `:organizationId` path segment and access
 * check; business logic lives entirely in the injected services.
 */
@Controller('organizations/:organizationId/settlements')
export class SettlementController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly payments: SettlementPaymentService,
    private readonly allocations: PaymentAllocationService,
    private readonly advances: AdvanceService,
    private readonly debtAdjustments: DebtAdjustmentService,
    private readonly offsets: SettlementOffsetService,
    private readonly reconciliation: SettlementReconciliationService,
    private readonly reporting: SettlementReportingService,
    private readonly ageing: AgeingService,
    private readonly creditExposure: CreditExposureService,
    private readonly health: SettlementHealthService,
    private readonly policies: SettlementPolicyService,
  ) {}

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('open-items')
  async openItems(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('role') role: 'CUSTOMER' | 'SUPPLIER', @Query('counterpartyId') counterpartyId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return role === 'SUPPLIER' ? this.reporting.openPayables(tenantId, organizationId, counterpartyId) : this.reporting.openReceivables(tenantId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('customer-ageing')
  async customerAgeing(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.ageing.customerAgeing(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('supplier-ageing')
  async supplierAgeing(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.ageing.supplierAgeing(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('advances')
  async advancesList(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('role') role?: 'CUSTOMER' | 'SUPPLIER') {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.advancesReport(tenantId, organizationId, role);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('unallocated-payments')
  async unallocated(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.reporting.unallocatedPaymentsReport(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('credit-exposure/:counterpartyId')
  async creditExposureFor(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('counterpartyId') counterpartyId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const [current, available] = await Promise.all([this.creditExposure.getCurrentExposure(tenantId, organizationId, counterpartyId), this.creditExposure.getAvailableCredit(tenantId, organizationId, counterpartyId)]);
    return { currentExposure: current.toString(), availableCredit: available?.toString() ?? null };
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW_ALL)
  @Post('payments')
  async createPayment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateSettlementPaymentDto) {
    return this.payments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_ALLOCATE)
  @Post('allocations')
  async allocateManual(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: ManualAllocationDto) {
    return this.allocations.allocateManual(tenantId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_AUTO_ALLOCATE)
  @Post('allocations/auto')
  async allocateAuto(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: AutoAllocationDto) {
    return this.allocations.allocateAutomatic(tenantId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('allocations/preview')
  async previewAuto(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('counterpartyId') counterpartyId: string, @Query('role') role: 'CUSTOMER' | 'SUPPLIER', @Query('amount') amount: string) {
    return this.allocations.previewAutomatic(tenantId, organizationId, counterpartyId, role, Number(amount));
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_REVERSE_ALLOCATION)
  @Post('allocations/:id/reverse')
  async reverseAllocation(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.allocations.reverse(tenantId, id, user.userId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_APPLY_ADVANCE)
  @Post('advances/:id/apply')
  async applyAdvance(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ApplyAdvanceDto) {
    return this.advances.apply(tenantId, organizationId, user.userId, id, dto.openItemType, dto.openItemId, dto.amount);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_APPLY_ADVANCE)
  @Post('payments/:id/convert-to-advance')
  async convertToAdvance(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.advances.createFromUnallocatedPayment(tenantId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_CREATE_ADJUSTMENT)
  @Post('debt-adjustments')
  async createDebtAdjustment(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateDebtAdjustmentDto) {
    return this.debtAdjustments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_OFFSET)
  @Post('offsets')
  async createOffset(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateSettlementOffsetDto) {
    return this.offsets.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_RECONCILE)
  @Post('reconciliations')
  async generateReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: GenerateReconciliationDto) {
    return this.reconciliation.generate(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_RECONCILE)
  @Post('reconciliations/:id/confirm')
  async confirmReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('by') by: 'US' | 'COUNTERPARTY') {
    return this.reconciliation.confirm(tenantId, membershipId, organizationId, user.userId, id, by);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_RECONCILE)
  @Post('reconciliations/:id/close')
  async closeReconciliation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.reconciliation.close(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get('policies')
  async listPolicies(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.policies.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_CREATE_ADJUSTMENT)
  @Post('policies')
  async createPolicy(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: Record<string, unknown>) {
    return this.policies.create(tenantId, organizationId, user.userId, dto as any);
  }
}
