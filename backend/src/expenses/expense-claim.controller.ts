import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExpenseClaimService } from './expense-claim.service';
import { CreateExpenseClaimDto, SubmitExpenseClaimDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/claims')
export class ExpenseClaimController {
  constructor(private readonly claims: ExpenseClaimService) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.claims.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.claims.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateExpenseClaimDto,
  ) {
    return this.claims.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_SUBMIT)
  @Post(':id/submit')
  submit(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SubmitExpenseClaimDto,
  ) {
    return this.claims.submit(tenantId, membershipId, organizationId, user.userId, id, dto);
  }
}
