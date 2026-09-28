import { Controller, Get, Param } from '@nestjs/common';
import { PayrollReportingService } from './payroll-reporting.service';
import { PayrollHealthService } from './payroll-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payroll')
export class PayrollReportingController {
  constructor(
    private readonly reports: PayrollReportingService,
    private readonly health: PayrollHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_SALARY)
  @Get('periods/:periodId/register')
  register(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.reports.register(tenantId, membershipId, organizationId, periodId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_SALARY)
  @Get('periods/:periodId/payslips/:employmentId')
  payslip(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
    @Param('employmentId') employmentId: string,
  ) {
    return this.reports.payslip(tenantId, membershipId, organizationId, periodId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_ACCOUNTING)
  @Get('periods/:periodId/employer-cost')
  employerCost(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.reports.employerCostByDepartment(tenantId, membershipId, organizationId, periodId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_ACCOUNTING)
  @Get('periods/:periodId/liabilities')
  liabilities(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.reports.liabilityReport(tenantId, membershipId, organizationId, periodId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('health')
  checkHealth(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
