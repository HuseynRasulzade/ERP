import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ApprovalPlanRegistryService } from '../approvals/approval-plan-registry.service';
import { SettlementModule } from '../settlement/settlement.module';
import { CurrencyModule } from '../currency/currency.module';

import { PaymentRequestService } from './payment-request.service';
import { PaymentRequestController } from './payment-request.controller';

import { PaymentOrderRepository } from './payment-order.repository';
import { PaymentOrderPostingHandler } from './payment-order.posting-handler';
import { PaymentOrderService } from './payment-order.service';
import { PaymentOrderController } from './payment-order.controller';
import { PaymentOrderApprovalPlanProvider } from './payment-order-approval-plan.provider';
import { PaymentAllocationService } from './payment-allocation.service';

import { CashTransactionRepository } from './cash-transaction.repository';
import { CashTransactionPostingHandler } from './cash-transaction.posting-handler';
import { CashTransactionService } from './cash-transaction.service';
import { CashTransactionController } from './cash-transaction.controller';

import { BankReconciliationService } from './bank-reconciliation.service';
import { BankReconciliationController } from './bank-reconciliation.controller';

import { BankService } from './bank.service';
import { BankController } from './bank.controller';

import { CashFlowReportService } from './cash-flow-report.service';
import { CashFlowReportController } from './cash-flow-report.controller';

/**
 * Treasury / payment chain (docs/APPROVALS.md, Purchase Invoice ->
 * Payment Request -> Payment Order -> [posting = Bank Ödənişi] ->
 * [reconcile = Bank Uzlaşdırması]). Registers PaymentOrder as a full
 * document-framework participant; PaymentRequest is plain CRUD (never
 * posts), matching PurchaseRequirement's shape.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, ApprovalsModule, SettlementModule, CurrencyModule],
  controllers: [PaymentRequestController, PaymentOrderController, CashTransactionController, BankReconciliationController, BankController, CashFlowReportController],
  providers: [
    PaymentRequestService,
    PaymentOrderRepository,
    PaymentOrderPostingHandler,
    PaymentOrderService,
    PaymentOrderApprovalPlanProvider,
    PaymentAllocationService,
    CashTransactionRepository,
    CashTransactionPostingHandler,
    CashTransactionService,
    BankReconciliationService,
    BankService,
    CashFlowReportService,
  ],
  exports: [PaymentOrderService],
})
export class TreasuryModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly paymentOrderHandler: PaymentOrderPostingHandler,
    private readonly approvalPlanRegistry: ApprovalPlanRegistryService,
    private readonly paymentOrderApprovalPlan: PaymentOrderApprovalPlanProvider,
    private readonly cashTransactionRepository: CashTransactionRepository,
    private readonly cashTransactionHandler: CashTransactionPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.paymentOrderRepository);
    this.registry.registerHandler(this.paymentOrderHandler);
    this.approvalPlanRegistry.register(this.paymentOrderApprovalPlan);
    this.registry.registerRepository(this.cashTransactionRepository);
    this.registry.registerHandler(this.cashTransactionHandler);
  }
}
