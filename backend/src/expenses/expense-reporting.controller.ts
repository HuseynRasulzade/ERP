import { Controller, Get, Param, Query } from '@nestjs/common';
import { ExpenseReportingService } from './expense-reporting.service';
import { ExpenseHealthService } from './expense-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/reports')
export class ExpenseReportingController {
  constructor(
    private readonly reports: ExpenseReportingService,
    private readonly health: ExpenseHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('register')
  register(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.register(tenantId, membershipId, organizationId, new Date(fromDate), new Date(toDate));
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_EMPLOYEE_BALANCE)
  @Get('employee-advances')
  employeeAdvances(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.employeeAdvances(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_EMPLOYEE_BALANCE)
  @Get('reimbursements')
  reimbursements(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.reimbursements(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_COST_CENTER)
  @Get('cost-center-pnl')
  costCenterPnl(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.costCenterPnl(tenantId, membershipId, organizationId, new Date(fromDate), new Date(toDate));
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_ACCOUNTING)
  @Get('prepaid-expenses')
  prepaidExpenses(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.prepaidExpenses(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('health')
  checkHealth(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
