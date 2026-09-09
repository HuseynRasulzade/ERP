import { Controller, Get, Param, Query } from '@nestjs/common';
import { TaxRegisterService } from './tax-register.service';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

@Controller('organizations/:organizationId/tax/register')
export class TaxRegisterController {
  constructor(
    private readonly register: TaxRegisterService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.TAX_REGISTER_VIEW)
  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.register.list(tenantId, organizationId, { fromDate: parseDate(fromDate), toDate: parseDate(toDate) });
  }

  @RequirePermissions(PermissionCodes.TAX_REGISTER_VIEW)
  @Get('summary')
  async summary(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('taxType') taxType?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.register.taxBalance(tenantId, organizationId, { fromDate: parseDate(fromDate), toDate: parseDate(toDate), taxType });
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
