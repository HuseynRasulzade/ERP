import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { BankCashMovementModule } from '../treasury/bank-cash-movement.module';
import { CashMovementModule } from '../cash/cash-movement.module';
import { AccountablePersonModule } from '../cash/accountable-person.module';

import { SettlementPolicyService } from './settlement-policy.service';
import { SettlementMovementService } from './settlement-movement.service';
import { OpenItemService } from './open-item.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { AdvanceService } from './advance.service';
import { AgeingService } from './ageing.service';
import { CreditExposureService } from './credit-exposure.service';
import { SettlementHealthService } from './settlement-health.service';
import { SettlementReconciliationService } from './settlement-reconciliation.service';
import { SettlementReportingService } from './settlement-reporting.service';

import { SettlementPaymentRepository } from './settlement-payment.repository';
import { SettlementPaymentPostingHandler } from './settlement-payment.posting-handler';
import { SettlementPaymentService } from './settlement-payment.service';

import { DebtAdjustmentRepository } from './debt-adjustment.repository';
import { DebtAdjustmentPostingHandler } from './debt-adjustment.posting-handler';
import { DebtAdjustmentService } from './debt-adjustment.service';

import { SettlementOffsetRepository } from './settlement-offset.repository';
import { SettlementOffsetPostingHandler } from './settlement-offset.posting-handler';
import { SettlementOffsetService } from './settlement-offset.service';

import { SettlementController } from './settlement.controller';

/**
 * AR/AP Counterparty Settlement Engine (docx spec Phase 13). See
 * docs/SETTLEMENT.md. Exports `OpenItemService`/`SettlementMovementService`
 * so Sales/Purchase Execution's own posting handlers can create/reduce
 * receivables and payables through here instead of writing
 * `SettlementObligation`/`SupplierPayable` rows directly (the pre-Phase-13
 * pattern those handlers used).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, BankCashMovementModule, CashMovementModule, AccountablePersonModule],
  controllers: [SettlementController],
  providers: [
    SettlementPolicyService,
    SettlementMovementService,
    OpenItemService,
    PaymentAllocationService,
    AdvanceService,
    AgeingService,
    CreditExposureService,
    SettlementHealthService,
    SettlementReconciliationService,
    SettlementReportingService,

    SettlementPaymentRepository,
    SettlementPaymentPostingHandler,
    SettlementPaymentService,

    DebtAdjustmentRepository,
    DebtAdjustmentPostingHandler,
    DebtAdjustmentService,

    SettlementOffsetRepository,
    SettlementOffsetPostingHandler,
    SettlementOffsetService,
  ],
  exports: [OpenItemService, SettlementMovementService, PaymentAllocationService, AdvanceService, CreditExposureService, SettlementPolicyService, SettlementPaymentService, SettlementHealthService, AgeingService],
})
export class SettlementModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly paymentRepository: SettlementPaymentRepository,
    private readonly paymentHandler: SettlementPaymentPostingHandler,
    private readonly debtAdjustmentRepository: DebtAdjustmentRepository,
    private readonly debtAdjustmentHandler: DebtAdjustmentPostingHandler,
    private readonly offsetRepository: SettlementOffsetRepository,
    private readonly offsetHandler: SettlementOffsetPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.paymentRepository);
    this.registry.registerHandler(this.paymentHandler);
    this.registry.registerRepository(this.debtAdjustmentRepository);
    this.registry.registerHandler(this.debtAdjustmentHandler);
    this.registry.registerRepository(this.offsetRepository);
    this.registry.registerHandler(this.offsetHandler);
  }
}
