import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ApprovalPlanRegistryService } from '../approvals/approval-plan-registry.service';

import { PaymentRequestService } from './payment-request.service';
import { PaymentRequestController } from './payment-request.controller';

import { PaymentOrderRepository } from './payment-order.repository';
import { PaymentOrderPostingHandler } from './payment-order.posting-handler';
import { PaymentOrderService } from './payment-order.service';
import { PaymentOrderController } from './payment-order.controller';
import { PaymentOrderApprovalPlanProvider } from './payment-order-approval-plan.provider';

/**
 * Treasury / payment chain (docs/APPROVALS.md, Purchase Invoice ->
 * Payment Request -> Payment Order -> [posting = Bank Ödənişi] ->
 * [reconcile = Bank Uzlaşdırması]). Registers PaymentOrder as a full
 * document-framework participant; PaymentRequest is plain CRUD (never
 * posts), matching PurchaseRequirement's shape.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, ApprovalsModule],
  controllers: [PaymentRequestController, PaymentOrderController],
  providers: [
    PaymentRequestService,
    PaymentOrderRepository,
    PaymentOrderPostingHandler,
    PaymentOrderService,
    PaymentOrderApprovalPlanProvider,
  ],
})
export class TreasuryModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly paymentOrderHandler: PaymentOrderPostingHandler,
    private readonly approvalPlanRegistry: ApprovalPlanRegistryService,
    private readonly paymentOrderApprovalPlan: PaymentOrderApprovalPlanProvider,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.paymentOrderRepository);
    this.registry.registerHandler(this.paymentOrderHandler);
    this.approvalPlanRegistry.register(this.paymentOrderApprovalPlan);
  }
}
