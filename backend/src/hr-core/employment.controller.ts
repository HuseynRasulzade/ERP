import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EmploymentService } from './employment.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/hr/employments')
export class EmploymentController {
  constructor(private readonly employments: EmploymentService) {}

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.employments.list(
      tenantId,
      membershipId,
      organizationId,
      status,
    );
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.employments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get(':id/history')
  history(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.employments.getHistory(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
  }

  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get(':id/state')
  async state(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    await this.employments.get(tenantId, membershipId, organizationId, id);
    return this.employments.getState(
      id,
      asOfDate ? new Date(asOfDate) : new Date(),
    );
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYMENT_CREATE)
  @Post(':id/sync-status')
  syncStatus(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.employments.syncStatus(tenantId, organizationId, id);
  }
}
