import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { CostCenterService } from './cost-center.service';
import { ExpenseCategoryService } from './expense-category.service';
import { ExpenseClaimService } from './expense-claim.service';
import { EXPENSE_CLAIM_TYPE } from './expense-claim.repository';
import { ExpenseReceiptService } from './expense-receipt.service';
import { ExpenseAllocationService } from './expense-allocation.service';
import { AllocationDriverService } from './allocation-driver.service';
import { CostAllocationService } from './cost-allocation.service';
import { PrepaidExpenseService } from './prepaid-expense.service';
import { ExpenseSettlementService } from './expense-settlement.service';
import { ExpenseBudgetService } from './expense-budget.service';
import { ExpenseHealthService } from './expense-health.service';
import {
  CreateCostCenterDto,
  CreateExpenseCategoryDto,
  CreateExpenseClaimDto,
  ApproveLineDto,
  ApproveLineExceptionDto,
  AttachReceiptDto,
  AllocateExpenseLineDto,
  CreateAllocationDriverDto,
  SetDriverValueDto,
  CreateAllocationRuleDto,
  CreatePrepaidFromLineDto,
  SetBudgetDto,
} from './dto/expense.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Expenses / Cost Centers API (docx spec Phase 20). See docs/EXPENSES.md. */
@Controller('organizations/:organizationId/expenses')
export class ExpenseController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly costCenters: CostCenterService,
    private readonly categories: ExpenseCategoryService,
    private readonly claims: ExpenseClaimService,
    private readonly receipts: ExpenseReceiptService,
    private readonly allocations: ExpenseAllocationService,
    private readonly drivers: AllocationDriverService,
    private readonly costAllocation: CostAllocationService,
    private readonly prepaid: PrepaidExpenseService,
    private readonly settlement: ExpenseSettlementService,
    private readonly budgets: ExpenseBudgetService,
    private readonly health: ExpenseHealthService,
    private readonly posting: DocumentPostingService,
  ) {}

  // --- Cost centers / categories ---
  @RequirePermissions(PermissionCodes.EXPENSE_CONFIG_EDIT)
  @Post('cost-centers')
  createCostCenter(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCostCenterDto) {
    return this.costCenters.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('cost-centers')
  listCostCenters(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.costCenters.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CONFIG_EDIT)
  @Post('categories')
  createCategory(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateExpenseCategoryDto) {
    return this.categories.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('categories')
  listCategories(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.categories.list(tenantId, membershipId, organizationId);
  }

  // --- Claims ---
  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_CREATE)
  @Post('claims')
  createClaim(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateExpenseClaimDto) {
    return this.claims.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('claims')
  listClaims(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('employeeId') employeeId?: string) {
    return this.claims.list(tenantId, membershipId, organizationId, employeeId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_APPROVE)
  @Post('claim-lines/:lineId/approve')
  approveLine(@CurrentTenantId() tenantId: string, @Param('lineId') lineId: string, @CurrentUser() user: { userId: string }, @Body() dto: ApproveLineDto) {
    return this.claims.approveLine(tenantId, user.userId, lineId, dto.approvedAmount, dto.rejectionReason);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_APPROVE)
  @Post('claim-lines/:lineId/approve-exception')
  approveLineException(@CurrentTenantId() tenantId: string, @Param('lineId') lineId: string, @CurrentUser() user: { userId: string }, @Body() dto: ApproveLineExceptionDto) {
    return this.claims.approveLineException(tenantId, user.userId, lineId, dto.comment);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_APPROVE)
  @Post('claims/:id/finalize-approval')
  finalizeApproval(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.claims.finalizeApproval(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_POST)
  @Post('claims/:id/post')
  postClaim(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, EXPENSE_CLAIM_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_POST)
  @Post('claims/:id/unpost')
  unpostClaim(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.unpost(tenantId, EXPENSE_CLAIM_TYPE, id, expectedVersion, user.userId);
  }

  // --- Receipts / allocation ---
  @RequirePermissions(PermissionCodes.EXPENSE_CLAIM_CREATE)
  @Post('receipts')
  attachReceipt(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: AttachReceiptDto) {
    return this.receipts.attach(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('claim-lines/:lineId/allocate')
  allocateLine(@CurrentTenantId() tenantId: string, @Param('lineId') lineId: string, @CurrentUser() user: { userId: string }, @Body() dto: AllocateExpenseLineDto) {
    return this.allocations.allocate(tenantId, user.userId, lineId, dto.splits);
  }

  // --- Allocation drivers / rules / runs ---
  @RequirePermissions(PermissionCodes.EXPENSE_CONFIG_EDIT)
  @Post('allocation-drivers')
  createDriver(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateAllocationDriverDto) {
    return this.drivers.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CONFIG_EDIT)
  @Post('allocation-driver-values')
  setDriverValue(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: SetDriverValueDto) {
    return this.drivers.setValue(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_CONFIG_EDIT)
  @Post('allocation-rules')
  createRule(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateAllocationRuleDto) {
    return this.costAllocation.createRule(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('allocation-rules')
  listRules(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.costAllocation.listRules(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_COST_ALLOCATION_RUN)
  @Post('allocation-rules/:ruleId/calculate')
  calculateAllocation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('ruleId') ruleId: string, @CurrentUser() user: { userId: string }, @Body('period') period: string, @Body('preview') preview?: boolean) {
    return this.costAllocation.calculate(tenantId, membershipId, organizationId, user.userId, ruleId, period, preview);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_COST_ALLOCATION_RUN)
  @Post('allocation-runs/:runId/post')
  postAllocation(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('runId') runId: string, @CurrentUser() user: { userId: string }) {
    return this.costAllocation.post(tenantId, membershipId, organizationId, user.userId, runId);
  }

  // --- Prepaid expenses ---
  @RequirePermissions(PermissionCodes.EXPENSE_PREPAID_MANAGE)
  @Post('claim-lines/:lineId/prepaid')
  createPrepaid(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('lineId') lineId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreatePrepaidFromLineDto) {
    return this.prepaid.createFromClaimLine(tenantId, membershipId, organizationId, user.userId, lineId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_PREPAID_MANAGE)
  @Post('prepaid-expenses/recognize')
  recognizePrepaid(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('period') period: string) {
    return this.prepaid.recognizePeriod(tenantId, organizationId, user.userId, period);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('prepaid-expenses')
  listPrepaid(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.prepaid.list(tenantId, organizationId);
  }

  // --- Settlement / budget / health ---
  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_SETTLEMENT)
  @Get('employees/:employeeId/settlement-register')
  settlementRegister(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('employeeId') employeeId: string) {
    return this.settlement.register(tenantId, membershipId, organizationId, employeeId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_BUDGET_MANAGE)
  @Post('budgets')
  setBudget(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: SetBudgetDto) {
    return this.budgets.setBudget(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('reports/budget-vs-actual')
  budgetVsActual(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('period') period: string) {
    return this.budgets.budgetVsActual(tenantId, membershipId, organizationId, period);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }

  // --- Single-claim-by-id lookup stays last (routing-order caveat, see FixedAssetController) ---
  @RequirePermissions(PermissionCodes.EXPENSE_VIEW)
  @Get('claims/:id')
  getClaim(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.claims.get(tenantId, membershipId, organizationId, id);
  }
}
