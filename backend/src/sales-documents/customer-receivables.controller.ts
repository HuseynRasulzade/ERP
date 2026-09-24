import { Controller, Get, Param, Query } from '@nestjs/common';
import { CustomerSettlementService } from './customer-settlement.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/customer-receivables')
export class CustomerReceivablesController {
  constructor(private readonly settlement: CustomerSettlementService) {}

  @RequirePermissions(PermissionCodes.SALES_INVOICE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('counterpartyId') counterpartyId?: string,
  ) {
    return this.settlement.list(tenantId, membershipId, organizationId, counterpartyId);
  }
}
