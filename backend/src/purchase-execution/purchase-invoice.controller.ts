import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { CreatePurchaseInvoiceDto, UpdatePurchaseInvoiceDto } from './dto/purchase-execution.dto';
import { ApprovalDecisionDto } from '../approvals/dto/approval-decision.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/purchase-invoices')
export class PurchaseInvoiceController {
  constructor(private readonly invoices: PurchaseInvoiceService) {}

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.invoices.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.invoices.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.invoices.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdatePurchaseInvoiceDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.invoices.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_INVOICE_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.invoices.approve(tenantId, membershipId, organizationId, id, user.userId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_INVOICE_REJECT)
  @Post(':id/reject')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.invoices.reject(tenantId, membershipId, organizationId, id, user.userId, dto.comment);
  }
}
