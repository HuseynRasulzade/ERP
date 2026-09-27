import { Controller, Get, Param } from '@nestjs/common';
import { CashHealthService } from './cash-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-desk-health')
export class CashHealthController {
  constructor(private readonly health: CashHealthService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW_ACCOUNTING)
  @Get()
  check(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
