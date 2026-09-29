import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExpensePeriodService } from './expense-period.service';
import { CreateExpensePeriodDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/periods')
export class ExpensePeriodController {
  constructor(private readonly periods: ExpensePeriodService) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.periods.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_MANAGE_CATALOG)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateExpensePeriodDto,
  ) {
    return this.periods.create(tenantId, membershipId, organizationId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_MANAGE_CATALOG)
  @Post(':id/close')
  close(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.periods.close(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_PERIOD_REOPEN)
  @Post(':id/reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body('reason') reason: string,
  ) {
    return this.periods.reopen(tenantId, membershipId, organizationId, user.userId, id, reason);
  }
}
