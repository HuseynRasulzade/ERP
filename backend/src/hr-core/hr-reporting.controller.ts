import { Controller, Get, Param, Query } from '@nestjs/common';
import { HrReportingService } from './hr-reporting.service';
import { HrHealthService } from './hr-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/hr/reports')
export class HrReportingController {
  constructor(
    private readonly reports: HrReportingService,
    private readonly health: HrHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.HR_REPORT_VIEW)
  @Get('org-chart')
  orgChart(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.reports.orgChart(
      tenantId,
      membershipId,
      organizationId,
      asOfDate ? new Date(asOfDate) : undefined,
    );
  }

  @RequirePermissions(PermissionCodes.HR_REPORT_VIEW)
  @Get('headcount')
  headcount(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.headcountReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_REPORT_VIEW)
  @Get('staffing-capacity')
  staffingCapacity(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.staffingCapacityReport(
      tenantId,
      membershipId,
      organizationId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_REPORT_VIEW)
  @Get('contract-expiry')
  contractExpiry(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('withinDays') withinDays?: string,
  ) {
    return this.reports.contractExpiryReport(
      tenantId,
      membershipId,
      organizationId,
      withinDays ? Number(withinDays) : undefined,
    );
  }

  @RequirePermissions(PermissionCodes.HR_REPORT_VIEW)
  @Get('probation')
  probation(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.probationReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_REPORT_VIEW)
  @Get('health')
  healthCheck(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
