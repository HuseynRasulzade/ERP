import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SalesInvoiceService } from './sales-invoice.service';
import { CreateSalesInvoiceDto, UpdateSalesInvoiceDto } from './dto/sales-document.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Phase 4 — SalesInvoice controller. Same organization-scoped shape as
 * SalesOrderController. Standalone creation here; order-based creation goes
 * through the generic create-based-on endpoint (SALES_ORDER => SALES_INVOICE).
 */
@Controller('organizations/:organizationId/sales-invoices')
export class SalesInvoiceController {
  constructor(private readonly invoices: SalesInvoiceService) {}

  @RequirePermissions(PermissionCodes.SALES_INVOICE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.invoices.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.SALES_INVOICE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.invoices.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SALES_INVOICE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.invoices.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SALES_INVOICE_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateSalesInvoiceDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.invoices.update(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      expectedVersion,
      patch,
    );
  }
}
