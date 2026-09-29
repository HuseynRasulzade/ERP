import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ExpenseBudgetService } from './expense-budget.service';
import { ExpenseAdjustmentService } from './expense-adjustment.service';
import { CreateExpenseBudgetDto, ReclassifyExpenseLineDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/budgets')
export class ExpenseBudgetController {
  constructor(private readonly budgets: ExpenseBudgetService) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_ACCOUNTING)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('periodYear') periodYear?: string,
    @Query('periodMonth') periodMonth?: string,
  ) {
    return this.budgets.list(tenantId, membershipId, organizationId, periodYear ? Number(periodYear) : undefined, periodMonth ? Number(periodMonth) : undefined);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_MANAGE_BUDGET)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateExpenseBudgetDto,
  ) {
    return this.budgets.create(tenantId, membershipId, organizationId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_ACCOUNTING)
  @Get('vs-actual')
  vsActual(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('periodYear') periodYear: string,
    @Query('periodMonth') periodMonth: string,
  ) {
    return this.budgets.budgetVsActual(tenantId, membershipId, organizationId, Number(periodYear), Number(periodMonth));
  }
}

@Controller('organizations/:organizationId/expenses/adjustments')
export class ExpenseAdjustmentController {
  constructor(private readonly adjustments: ExpenseAdjustmentService) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_ACCOUNTING)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.adjustments.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_RECLASSIFY)
  @Post('reclassify-cost-center')
  reclassify(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReclassifyExpenseLineDto,
  ) {
    return this.adjustments.reclassifyCostCenter(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
