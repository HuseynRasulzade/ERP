import { Body, Controller, Param, Post } from '@nestjs/common';
import { ExpenseApprovalService } from './expense-approval.service';
import { ApproveExpenseClaimDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/claims')
export class ExpenseApprovalController {
  constructor(private readonly approvals: ExpenseApprovalService) {}

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApproveExpenseClaimDto,
  ) {
    return this.approvals.approve(tenantId, membershipId, organizationId, user.userId, id, dto);
  }
}
