import { Controller, Get, Param, Query } from '@nestjs/common';
import { CashReportingService } from './cash-reporting.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-desk-reports')
export class CashReportingController {
  constructor(private readonly reports: CashReportingService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW_BALANCE)
  @Get('cash-book')
  cashBook(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('cashboxId') cashboxId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.cashBook(
      tenantId,
      membershipId,
      organizationId,
      cashboxId,
      new Date(fromDate),
      new Date(toDate),
    );
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW_BALANCE)
  @Get('balances')
  balances(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.balanceReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('cashier-turnover')
  cashierTurnover(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.cashierTurnover(
      tenantId,
      membershipId,
      organizationId,
      new Date(fromDate),
      new Date(toDate),
    );
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('differences')
  differences(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.reports.differenceReport(
      tenantId,
      membershipId,
      organizationId,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get('transfers')
  transfers(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('cashboxId') cashboxId?: string,
  ) {
    return this.reports.transferReport(
      tenantId,
      membershipId,
      organizationId,
      cashboxId,
    );
  }
}
