import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CreditCheckService } from './credit-check.service';
import { ReservationService } from './reservation.service';
import { ShipmentPlanService } from './shipment-plan.service';
import { PaymentScheduleService } from './payment-schedule.service';
import { OrderHoldService } from './order-hold.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import {
  CreateReservationDto,
  CreateShipmentPlanDto,
  GeneratePaymentScheduleDto,
  PlaceOrderHoldDto,
  VersionedCommandDto,
} from './dto/sales-preorder.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { NotFoundAppError } from '../common/errors/app-error';
import { SALES_ORDER_TYPE } from '../sales-documents/sales-order.repository';

/**
 * Phase 6 order-management surface on top of the existing SalesOrder
 * (= this spec's CustomerOrder — see docs/SALES_PREORDER.md). `confirm`/
 * `reopen` are friendly names for the generic document-framework
 * post/unpost commands (spec section 22's ConfirmCustomerOrder), not a
 * second parallel workflow.
 */
@Controller('organizations/:organizationId/sales-orders/:id')
export class SalesOrderPreorderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: DocumentPostingService,
    private readonly access: OrganizationAccessService,
    private readonly creditCheck: CreditCheckService,
    private readonly reservations: ReservationService,
    private readonly shipmentPlans: ShipmentPlanService,
    private readonly paymentSchedules: PaymentScheduleService,
    private readonly holds: OrderHoldService,
    private readonly fulfillment: OrderFulfillmentService,
  ) {}

  @RequirePermissions(PermissionCodes.SALES_ORDER_CONFIRM)
  @Post('confirm')
  confirm(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.posting.post(tenantId, SALES_ORDER_TYPE, id, dto.expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_REOPEN)
  @Post('reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.posting.unpost(tenantId, SALES_ORDER_TYPE, id, dto.expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_VIEW)
  @Get('check-credit')
  async checkCredit(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.salesOrder.findFirst({ where: { id, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('SalesOrder', id);
    return this.creditCheck.check(tenantId, organizationId, order.counterpartyId, new Decimal(order.grandTotal.toString()));
  }

  @RequirePermissions(PermissionCodes.SALES_FULFILLMENT_VIEW)
  @Get('fulfillment')
  async fulfillmentSummary(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.forOrder(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_RESERVATION_VIEW)
  @Get('reservations')
  listReservations(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.reservations.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_RESERVATION_MANAGE)
  @Post('reservations')
  reserve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservations.create(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SALES_SHIPMENT_PLAN_VIEW)
  @Get('shipment-plans')
  listShipmentPlans(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.shipmentPlans.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_SHIPMENT_PLAN_MANAGE)
  @Post('shipment-plans')
  createShipmentPlan(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateShipmentPlanDto,
  ) {
    return this.shipmentPlans.create(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SALES_PAYMENT_SCHEDULE_VIEW)
  @Get('payment-schedule')
  listPaymentSchedule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.paymentSchedules.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_PAYMENT_SCHEDULE_VIEW)
  @Post('payment-schedule')
  generatePaymentSchedule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: GeneratePaymentScheduleDto,
  ) {
    return this.paymentSchedules.generate(tenantId, membershipId, organizationId, id, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_HOLD_MANAGE)
  @Get('holds')
  listHolds(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.holds.list(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_HOLD_MANAGE)
  @Post('holds')
  placeHold(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PlaceOrderHoldDto,
  ) {
    return this.holds.place(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}

@Controller('organizations/:organizationId/order-holds')
export class OrderHoldReleaseController {
  constructor(private readonly holds: OrderHoldService) {}

  @RequirePermissions(PermissionCodes.SALES_ORDER_HOLD_MANAGE)
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

@Controller('organizations/:organizationId/stock-reservations')
export class StockReservationReleaseController {
  constructor(private readonly reservations: ReservationService) {}

  @RequirePermissions(PermissionCodes.SALES_RESERVATION_MANAGE)
  @Post(':reservationId/release')
  release(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('reservationId') reservationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.reservations.release(tenantId, membershipId, organizationId, reservationId, user.userId, dto.expectedVersion);
  }
}
