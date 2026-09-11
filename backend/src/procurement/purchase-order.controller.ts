import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { ProcurementPlanningService } from './procurement-planning.service';
import { CancelPurchaseOrderLineDto, CreatePurchaseOrderDto, CreatePurchaseOrderFromRequirementsDto, UpdatePurchaseOrderDto } from './dto/procurement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * PurchaseOrder controller (spec section 98). Organization-scoped like
 * SalesOrderController. Confirm/reopen/cancel flow through the generic
 * /documents/PURCHASE_ORDER/:id/post|unpost|cancel commands (see
 * DocumentCommandsController) — not duplicated here, matching the
 * SalesOrder precedent.
 */
@Controller('organizations/:organizationId/purchase-orders')
export class PurchaseOrderController {
  constructor(
    private readonly orders: PurchaseOrderService,
    private readonly planning: ProcurementPlanningService,
  ) {}

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.orders.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.orders.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.orders.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  /** Combines one or more OPEN/PARTIALLY_ORDERED purchase requirements
   * (all from the same department — enforced server-side) into a single
   * new order, auto-filling every remaining product/unit/quantity line.
   * See ProcurementPlanningService.createPurchaseOrderFromRequirements. */
  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_CREATE)
  @Post('from-requirements')
  createFromRequirements(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePurchaseOrderFromRequirementsDto,
  ) {
    return this.planning.createPurchaseOrderFromRequirements(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.orders.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_EDIT)
  @Post(':id/lines/:lineId/cancel')
  cancelLine(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CancelPurchaseOrderLineDto,
  ) {
    return this.orders.cancelLine(tenantId, membershipId, organizationId, id, lineId, user.userId, dto.cancelQuantity);
  }
}
