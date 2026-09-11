import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { PurchaseOrderHoldService } from './purchase-order-hold.service';
import { PurchaseOrderPaymentScheduleService } from './purchase-order-payment-schedule.service';
import { GeneratePurchasePaymentScheduleDto, PlacePurchaseOrderHoldDto } from './dto/procurement.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { PURCHASE_ORDER_TYPE } from './purchase-order.repository';

/**
 * PurchaseOrder management surface (spec sections 59, 70, 83, 98) on top
 * of the generic document-framework post/unpost/cancel commands.
 * `confirm`/`reopen` are friendly names for those generic commands (spec
 * section 26's ConfirmPurchaseOrder), matching the SalesOrder precedent —
 * not a second parallel workflow.
 */
@Controller('organizations/:organizationId/purchase-orders/:id')
export class PurchaseOrderExtrasController {
  constructor(
    private readonly posting: DocumentPostingService,
    private readonly holds: PurchaseOrderHoldService,
    private readonly paymentSchedules: PurchaseOrderPaymentScheduleService,
  ) {}

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_CONFIRM)
  @Post('confirm')
  confirm(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: VersionedCommandDto) {
    return this.posting.post(tenantId, PURCHASE_ORDER_TYPE, id, dto.expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_REOPEN)
  @Post('reopen')
  reopen(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: VersionedCommandDto) {
    return this.posting.unpost(tenantId, PURCHASE_ORDER_TYPE, id, dto.expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_HOLD_MANAGE)
  @Get('holds')
  listHolds(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.holds.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_HOLD_MANAGE)
  @Post('holds')
  placeHold(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PlacePurchaseOrderHoldDto,
  ) {
    return this.holds.place(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_PAYMENT_SCHEDULE_VIEW)
  @Get('payment-schedule')
  listPaymentSchedule(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.paymentSchedules.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_PAYMENT_SCHEDULE_MANAGE)
  @Post('payment-schedule')
  generatePaymentSchedule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: GeneratePurchasePaymentScheduleDto,
  ) {
    return this.paymentSchedules.generate(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}

@Controller('organizations/:organizationId/purchase-order-holds')
export class PurchaseOrderHoldReleaseController {
  constructor(private readonly holds: PurchaseOrderHoldService) {}

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_HOLD_MANAGE)
  @Post(':holdId/release')
  release(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('holdId') holdId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.holds.release(tenantId, membershipId, organizationId, holdId, user.userId);
  }
}
