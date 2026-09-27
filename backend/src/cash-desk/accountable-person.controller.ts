import { Controller, Get, Param, Query } from '@nestjs/common';
import { AccountablePersonService } from './accountable-person.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/accountable-persons')
export class AccountablePersonController {
  constructor(private readonly accountablePersons: AccountablePersonService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get(':personId/balance')
  getBalance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('personId') personId: string,
  ) {
    return this.accountablePersons.getBalance(
      tenantId,
      membershipId,
      organizationId,
      personId,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('ageing')
  ageing(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.accountablePersons.ageing(
      tenantId,
      membershipId,
      organizationId,
      asOfDate ? new Date(asOfDate) : undefined,
    );
  }
}
