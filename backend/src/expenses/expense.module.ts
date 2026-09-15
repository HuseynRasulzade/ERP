import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { AccountablePersonModule } from '../cash/accountable-person.module';
import { FixedAssetModule } from '../fixed-assets/fixed-asset.module';

import { CostCenterService } from './cost-center.service';
import { ExpenseCategoryService } from './expense-category.service';

import { ExpenseClaimRepository } from './expense-claim.repository';
import { ExpenseClaimPostingHandler } from './expense-claim.posting-handler';
import { ExpenseClaimService } from './expense-claim.service';

import { ExpenseReceiptService } from './expense-receipt.service';
import { ExpenseAllocationService } from './expense-allocation.service';
import { AllocationDriverService } from './allocation-driver.service';
import { CostAllocationService } from './cost-allocation.service';
import { PrepaidExpenseService } from './prepaid-expense.service';
import { ExpenseSettlementService } from './expense-settlement.service';
import { ExpenseBudgetService } from './expense-budget.service';
import { ExpenseHealthService } from './expense-health.service';

import { ExpenseController } from './expense.controller';

/**
 * Expenses / Cost Centers Engine (docx spec Phase 20). See
 * docs/EXPENSES.md. Imports `AccountablePersonModule` (Phase 15) for
 * employee advance settlement and `FixedAssetModule` (Phase 16) for the
 * capitalization handoff — never duplicating either engine (spec
 * sections 21, 31).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, AccountablePersonModule, FixedAssetModule],
  controllers: [ExpenseController],
  providers: [
    CostCenterService,
    ExpenseCategoryService,

    ExpenseClaimRepository,
    ExpenseClaimPostingHandler,
    ExpenseClaimService,

    ExpenseReceiptService,
    ExpenseAllocationService,
    AllocationDriverService,
    CostAllocationService,
    PrepaidExpenseService,
    ExpenseSettlementService,
    ExpenseBudgetService,
    ExpenseHealthService,
  ],
  exports: [ExpenseSettlementService, PrepaidExpenseService],
})
export class ExpenseModule implements OnModuleInit {
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
