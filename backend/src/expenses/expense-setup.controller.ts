import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExpenseCategoryService } from './expense-category.service';
import { ExpensePolicyService } from './expense-policy.service';
import { CreateExpenseCategoryDto, CreateExpensePolicyDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * Consolidated admin controller for the Expense catalog (categories +
 * policies) — same consolidation convention as PayrollSetupController.
 */
@Controller('expenses/setup')
export class ExpenseSetupController {
  constructor(
    private readonly categories: ExpenseCategoryService,
    private readonly policies: ExpensePolicyService,
  ) {}

  @RequirePermissions(PermissionCodes.EXPENSE_MANAGE_CATALOG)
  @Post('seed-defaults')
  seedDefaults(@CurrentTenantId() tenantId: string) {
    return this.categories.seedDefaults(tenantId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('categories')
  listCategories(@CurrentTenantId() tenantId: string) {
    return this.categories.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_MANAGE_CATALOG)
  @Post('categories')
  createCategory(@CurrentTenantId() tenantId: string, @Body() dto: CreateExpenseCategoryDto) {
    return this.categories.create(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('policies')
  listPolicies(@CurrentTenantId() tenantId: string) {
    return this.policies.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_MANAGE_CATALOG)
  @Post('policies')
  createPolicy(@CurrentTenantId() tenantId: string, @Body() dto: CreateExpensePolicyDto) {
    return this.policies.create(tenantId, null, dto);
  }
}
