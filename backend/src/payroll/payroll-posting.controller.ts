import { Controller, Get, Param, Post } from '@nestjs/common';
import { PayrollPostingService } from './payroll-posting.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Drafts/reads the PayrollPosting document for a period. Actually posting
 * it to the GL (running PayrollPostingHandler) is the generic
 * `POST documents/PAYROLL_POSTING/:id/post` command — see
 * DocumentCommandsController.
 */
@Controller('organizations/:organizationId/payroll/periods/:periodId/posting')
export class PayrollPostingController {
  constructor(private readonly posting: PayrollPostingService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_ACCOUNTING)
  @Get()
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.posting.get(tenantId, membershipId, organizationId, periodId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_POST)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.posting.createForPeriod(tenantId, membershipId, organizationId, user.userId, periodId);
  }
}
