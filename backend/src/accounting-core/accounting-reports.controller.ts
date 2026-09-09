import { Controller, Get, Param, Query } from '@nestjs/common';
import { AccountingQueryService } from './accounting-query.service';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/accounting')
export class AccountingReportsController {
  constructor(private readonly query: AccountingQueryService) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_TRIAL_BALANCE_VIEW)
  @Get('trial-balance')
  trialBalance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.query.trialBalance(tenantId, membershipId, organizationId, {
      fromDate: parseDate(fromDate),
      toDate: parseDate(toDate),
      accountId,
    });
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_GENERAL_LEDGER_VIEW)
  @Get('general-ledger')
  generalLedger(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.query.generalLedger(tenantId, membershipId, organizationId, {
      fromDate: parseDate(fromDate),
      toDate: parseDate(toDate),
      accountId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_GENERAL_LEDGER_VIEW)
  @Get('accounts/:accountId/card')
  accountCard(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('accountId') accountId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.query.accountCard(tenantId, membershipId, organizationId, accountId, {
      fromDate: parseDate(fromDate),
      toDate: parseDate(toDate),
    });
  }
}

function parseDate(s: string): Date {
  return new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
}
