import { Controller, Get, Param, Query } from '@nestjs/common';
import { CashFlowReportService } from './cash-flow-report.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { ValidationAppError } from '../common/errors/app-error';

function parseDate(s: string): Date {
  const date = new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
  if (Number.isNaN(date.getTime())) throw new ValidationAppError(`Invalid date: ${s}`);
  return date;
}

@Controller('organizations/:organizationId/cash-flow')
export class CashFlowReportController {
  constructor(private readonly report: CashFlowReportService) {}

  @RequirePermissions(PermissionCodes.CASH_FLOW_VIEW)
  @Get()
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.report.get(tenantId, membershipId, organizationId, { fromDate: parseDate(fromDate), toDate: parseDate(toDate) });
  }
}
