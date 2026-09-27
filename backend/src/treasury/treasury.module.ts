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
import { PaymentRequestApprovalPlanProvider } from './payment-request-approval-plan.provider';

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
import { BankReconciliationPeriodService } from './bank-reconciliation-period.service';
import { BankReconciliationPeriodController } from './bank-reconciliation-period.controller';

import { BankService } from './bank.service';
import { BankController } from './bank.controller';

import { CashFlowReportService } from './cash-flow-report.service';
import { CashFlowReportController } from './cash-flow-report.controller';

import { IncomingBankPaymentRepository } from './incoming-bank-payment.repository';
import { IncomingBankPaymentPostingHandler } from './incoming-bank-payment.posting-handler';
import { IncomingBankPaymentService } from './incoming-bank-payment.service';
import { IncomingBankPaymentController } from './incoming-bank-payment.controller';

import { InternalBankTransferRepository } from './internal-bank-transfer.repository';
import { InternalBankTransferPostingHandler } from './internal-bank-transfer.posting-handler';
import { InternalBankTransferService } from './internal-bank-transfer.service';
import { InternalBankTransferController } from './internal-bank-transfer.controller';

import { BankFeeRepository } from './bank-fee.repository';
import { BankFeePostingHandler } from './bank-fee.posting-handler';
import { BankFeeService } from './bank-fee.service';
import { BankFeeController } from './bank-fee.controller';

import { FXConversionRepository } from './fx-conversion.repository';
import { FXConversionPostingHandler } from './fx-conversion.posting-handler';
import { FXConversionService } from './fx-conversion.service';
import { FXConversionController } from './fx-conversion.controller';

import { PaymentCalendarService } from './payment-calendar.service';
import { LiquidityForecastService } from './liquidity-forecast.service';
import { TreasuryLiquidityPolicyService } from './treasury-liquidity-policy.service';
import { TreasuryApprovalRuleService } from './treasury-approval-rule.service';
import { TreasuryHealthService } from './treasury-health.service';
import { TreasuryPlanningController } from './treasury-planning.controller';

/**
 * Treasury / Bank Operations (docx spec Phase 14, on top of docs/APPROVALS.md's
 * existing Purchase Invoice -> Payment Request -> Payment Order chain).
 * Three loosely-coupled layers (spec section 1): Treasury Plan
 * (PaymentRequest + its amount-tier approval, PaymentCalendarService,
 * LiquidityForecastService), Bank Reality (PaymentOrder,
 * IncomingBankPayment, InternalBankTransfer, BankFee, FXConversion, bank
 * statement matching/reconciliation), and Settlement Allocation (Phase
 * 13's own SettlementModule, never duplicated here).
 */
@Module({
  imports: [
    DocumentFrameworkModule,
    NumberingModule,
    AuditModule,
    OrgStructureModule,
    AccountingCoreModule,
    ApprovalsModule,
    SettlementModule,
    CurrencyModule,
  ],
  controllers: [
    PaymentRequestController,
    PaymentOrderController,
    CashTransactionController,
    BankReconciliationController,
    BankReconciliationPeriodController,
    BankController,
    CashFlowReportController,
    IncomingBankPaymentController,
    InternalBankTransferController,
    BankFeeController,
    FXConversionController,
    TreasuryPlanningController,
  ],
  providers: [
    PaymentRequestService,
    PaymentRequestApprovalPlanProvider,
    PaymentOrderRepository,
    PaymentOrderPostingHandler,
    PaymentOrderService,
    PaymentOrderApprovalPlanProvider,
    PaymentAllocationService,
    CashTransactionRepository,
    CashTransactionPostingHandler,
    CashTransactionService,
    BankReconciliationService,
    BankReconciliationPeriodService,
    BankService,
    CashFlowReportService,
    IncomingBankPaymentRepository,
    IncomingBankPaymentPostingHandler,
    IncomingBankPaymentService,
    InternalBankTransferRepository,
    InternalBankTransferPostingHandler,
    InternalBankTransferService,
    BankFeeRepository,
    BankFeePostingHandler,
    BankFeeService,
    FXConversionRepository,
    FXConversionPostingHandler,
    FXConversionService,
    PaymentCalendarService,
    LiquidityForecastService,
    TreasuryLiquidityPolicyService,
    TreasuryApprovalRuleService,
    TreasuryHealthService,
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
    private readonly paymentRequestApprovalPlan: PaymentRequestApprovalPlanProvider,
    private readonly cashTransactionRepository: CashTransactionRepository,
    private readonly cashTransactionHandler: CashTransactionPostingHandler,
    private readonly incomingBankPaymentRepository: IncomingBankPaymentRepository,
    private readonly incomingBankPaymentHandler: IncomingBankPaymentPostingHandler,
    private readonly internalBankTransferRepository: InternalBankTransferRepository,
    private readonly internalBankTransferHandler: InternalBankTransferPostingHandler,
    private readonly bankFeeRepository: BankFeeRepository,
    private readonly bankFeeHandler: BankFeePostingHandler,
    private readonly fxConversionRepository: FXConversionRepository,
    private readonly fxConversionHandler: FXConversionPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.paymentOrderRepository);
    this.registry.registerHandler(this.paymentOrderHandler);
    this.approvalPlanRegistry.register(this.paymentOrderApprovalPlan);
    this.approvalPlanRegistry.register(this.paymentRequestApprovalPlan);
    this.registry.registerRepository(this.cashTransactionRepository);
    this.registry.registerHandler(this.cashTransactionHandler);
    this.registry.registerRepository(this.incomingBankPaymentRepository);
    this.registry.registerHandler(this.incomingBankPaymentHandler);
    this.registry.registerRepository(this.internalBankTransferRepository);
    this.registry.registerHandler(this.internalBankTransferHandler);
    this.registry.registerRepository(this.bankFeeRepository);
    this.registry.registerHandler(this.bankFeeHandler);
    this.registry.registerRepository(this.fxConversionRepository);
    this.registry.registerHandler(this.fxConversionHandler);
  }
}
