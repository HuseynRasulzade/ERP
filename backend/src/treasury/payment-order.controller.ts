import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PaymentOrderService } from './payment-order.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { ApplyAdvanceDto, CreatePaymentOrderDto, ReconcilePaymentOrderDto, SetPaymentAllocationsDto, UpdatePaymentOrderDto } from './dto/treasury.dto';
import { ApprovalDecisionDto } from '../approvals/dto/approval-decision.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payment-orders')
export class PaymentOrderController {
  constructor(
    private readonly orders: PaymentOrderService,
    private readonly allocations: PaymentAllocationService,
  ) {}

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.orders.list(tenantId, membershipId, organizationId);
  }

  /** Every still-unapplied advance for a counterparty, across every
   * posted payment order — the source list for "apply advance to this
   * invoice" on a Purchase Invoice or Payment Request screen. Must be
   * declared before ':id' below or Nest would swallow this literal
   * path as an :id match. */
  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_VIEW)
  @Get('unmatched-advances')
  listUnmatchedAdvances(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('counterpartyId') counterpartyId: string,
  ) {
    return this.allocations.listUnmatchedAdvances(tenantId, membershipId, organizationId, counterpartyId);
  }

  /** Applies part or all of a previously unmatched advance to a specific
   * open invoice — see PaymentAllocationService.applyAdvance. */
  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_EDIT)
  @Post('allocations/:allocationId/apply')
  applyAdvance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('allocationId') allocationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApplyAdvanceDto,
  ) {
    return this.allocations.applyAdvance(tenantId, membershipId, organizationId, allocationId, user.userId, dto.purchaseInvoiceId, dto.amount);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.orders.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePaymentOrderDto,
  ) {
    return this.orders.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePaymentOrderDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.orders.update(tenantId, membershipId, organizationId, id, user.userId, patch, expectedVersion);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.orders.approve(tenantId, membershipId, organizationId, id, user.userId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_REJECT)
  @Post(':id/reject')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.orders.reject(tenantId, membershipId, organizationId, id, user.userId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_VIEW)
  @Get(':id/allocations')
  listAllocations(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.allocations.list(tenantId, membershipId, organizationId, id);
  }

  /** Replace-all: the caller always sends the complete desired split,
   * which must sum exactly to the order's own amount (a line with no
   * purchaseInvoiceId covers any unmatched advance). Only allowed while
   * NOT_POSTED — see PaymentAllocationService.set. */
  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_EDIT)
  @Put(':id/allocations')
  setAllocations(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SetPaymentAllocationsDto,
  ) {
    return this.allocations.set(tenantId, membershipId, organizationId, id, user.userId, dto.allocations);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_RECONCILE)
  @Post(':id/reconcile')
  reconcile(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReconcilePaymentOrderDto,
  ) {
    return this.orders.reconcile(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}
