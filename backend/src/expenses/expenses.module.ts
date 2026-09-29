import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { NumberingModule } from '../numbering/numbering.module';
import { CashDeskModule } from '../cash-desk/cash-desk.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';

import { CostCenterService } from './cost-center.service';
import { CostCenterController } from './cost-center.controller';

import { ExpenseCategoryService } from './expense-category.service';
import { ExpensePolicyService } from './expense-policy.service';
import { ExpenseSetupController } from './expense-setup.controller';

import { ExpenseValidationService } from './expense-validation.service';
import { ExpenseClaimService } from './expense-claim.service';
import { ExpenseClaimController } from './expense-claim.controller';

import { ExpenseReceiptService } from './expense-receipt.service';
import { ExpenseReceiptController } from './expense-receipt.controller';

import { ExpenseTaxService } from './expense-tax.service';
import { EmployeeExpenseSettlementService } from './employee-expense-settlement.service';
import { ExpenseClassificationService } from './expense-classification.service';
import { ExpenseApprovalService } from './expense-approval.service';
import { ExpenseApprovalController } from './expense-approval.controller';

import { ExpenseClaimRepository } from './expense-claim.repository';
import { ExpenseClaimPostingHandler } from './expense-claim.posting-handler';

import { PrepaidExpenseService } from './prepaid-expense.service';
import { PrepaidRecognitionRunService } from './prepaid-recognition-run.service';
import { PrepaidExpenseController } from './prepaid-expense.controller';

import { AllocationDriverService } from './allocation-driver.service';
import { AllocationRuleService } from './allocation-rule.service';
import { CostAllocationRunService } from './cost-allocation-run.service';
import { CostAllocationController } from './cost-allocation.controller';

import { ExpenseBudgetService } from './expense-budget.service';
import { ExpenseAdjustmentService } from './expense-adjustment.service';
import { ExpenseBudgetController, ExpenseAdjustmentController } from './expense-budget.controller';

import { ExpensePeriodService } from './expense-period.service';
import { ExpensePeriodController } from './expense-period.controller';

import { ExpenseReportingService } from './expense-reporting.service';
import { ExpenseHealthService } from './expense-health.service';
import { ExpenseReportingController } from './expense-reporting.controller';

/**
 * Expenses / Cost Centers / Employee Expenses (docx spec Phase 20) —
 * Cost Center -> Expense Category/Policy -> Expense Claim/Lines/Receipts
 * -> Tax Assessment (Phase 5) -> Employee Settlement (Phase 15) ->
 * Classification -> GL Posting -> Prepaid Expense -> Cost Allocation ->
 * Budget/Adjustments/Close. See docs/EXPENSES.md for the full
 * architecture and disclosed simplifications.
 */
@Module({
  imports: [
    AuditModule,
    OrgStructureModule,
    NumberingModule,
    CashDeskModule,
    TaxEngineModule,
    AccountingCoreModule,
    DocumentFrameworkModule,
  ],
  controllers: [
    CostCenterController,
    ExpenseSetupController,
    ExpenseClaimController,
    ExpenseReceiptController,
    ExpenseApprovalController,
    PrepaidExpenseController,
    CostAllocationController,
    ExpenseBudgetController,
    ExpenseAdjustmentController,
    ExpensePeriodController,
    ExpenseReportingController,
  ],
  providers: [
    CostCenterService,
    ExpenseCategoryService,
    ExpensePolicyService,
    ExpenseValidationService,
    ExpenseClaimService,
    ExpenseReceiptService,
    ExpenseTaxService,
    EmployeeExpenseSettlementService,
    ExpenseClassificationService,
    ExpenseApprovalService,
    ExpenseClaimRepository,
    ExpenseClaimPostingHandler,
    PrepaidExpenseService,
    PrepaidRecognitionRunService,
    AllocationDriverService,
    AllocationRuleService,
    CostAllocationRunService,
    ExpenseBudgetService,
    ExpenseAdjustmentService,
    ExpensePeriodService,
    ExpenseReportingService,
    ExpenseHealthService,
  ],
  exports: [
    CostCenterService,
    ExpenseCategoryService,
    ExpensePolicyService,
    ExpenseClaimService,
    ExpenseTaxService,
    EmployeeExpenseSettlementService,
  ],
})
export class ExpensesModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly claimRepository: ExpenseClaimRepository,
    private readonly claimHandler: ExpenseClaimPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.claimRepository);
    this.registry.registerHandler(this.claimHandler);
  }
}
