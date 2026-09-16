import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PaymentOrderService } from './payment-order.service';
import { CreatePaymentOrderDto, ReconcilePaymentOrderDto, UpdatePaymentOrderDto } from './dto/treasury.dto';
import { ApprovalDecisionDto } from '../approvals/dto/approval-decision.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payment-orders')
export class PaymentOrderController {
  constructor(private readonly orders: PaymentOrderService) {}

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.orders.list(tenantId, membershipId, organizationId);
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
