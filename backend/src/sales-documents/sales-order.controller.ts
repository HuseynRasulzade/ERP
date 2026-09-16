import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-document.dto';
import { ApprovalDecisionDto } from '../approvals/dto/approval-decision.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Phase 4 — SalesOrder controller. Organization-scoped, shaped like
 * CounterpartyController/ProductController: every route carries
 * :organizationId and the service enforces the OrganizationAccess grant.
 * Posting flows through the generic /documents/SALES_ORDER/:id/post command.
 */
@Controller('organizations/:organizationId/sales-orders')
export class SalesOrderController {
  constructor(private readonly orders: SalesOrderService) {}

  @RequirePermissions(PermissionCodes.SALES_ORDER_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.orders.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.orders.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSalesOrderDto,
  ) {
    return this.orders.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateSalesOrderDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.orders.update(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      expectedVersion,
      patch,
    );
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_APPROVE)
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

  @RequirePermissions(PermissionCodes.SALES_ORDER_REJECT)
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
}
