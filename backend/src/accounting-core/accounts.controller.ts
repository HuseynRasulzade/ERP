import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AccountService } from './account.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/accounting-core.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Chart of Accounts is tenant-wide (spec section 7: one adopted chart per
 * tenant, optionally scoped per Account to an Organization via
 * `organizationId`) — no `:organizationId` in the path, unlike Phase 1-4's
 * organization-scoped resources.
 */
@Controller('accounting/accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountService,
    private readonly charts: ChartOfAccountsService,
  ) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_ACCOUNT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.accounts.list(tenantId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_ACCOUNT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.accounts.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_ACCOUNT_CREATE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateAccountDto) {
    return this.accounts.create(tenantId, user.userId, dto as any);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_ACCOUNT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateAccountDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.accounts.update(tenantId, id, user.userId, expectedVersion, patch);
  }
}

@Controller('accounting/chart')
export class ChartOfAccountsController {
  constructor(private readonly charts: ChartOfAccountsService) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_CHART_MANAGE)
  @Post('adopt')
  adopt(@CurrentTenantId() tenantId: string) {
    return this.charts.ensureAdopted(tenantId);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_CHART_VIEW)
  @Get()
  get(@CurrentTenantId() tenantId: string) {
    return this.charts.getTenantChart(tenantId);
  }
}
