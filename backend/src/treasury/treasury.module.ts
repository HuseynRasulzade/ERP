import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { RbacModule } from '../rbac/rbac.module';
import { SettlementModule } from '../settlement/settlement.module';
import { BankCashMovementModule } from './bank-cash-movement.module';

import { PaymentRequestService } from './payment-request.service';
import { TreasuryApprovalService } from './treasury-approval.service';
import { PaymentCalendarService } from './payment-calendar.service';
import { LiquidityForecastService } from './liquidity-forecast.service';
import { PaymentInstructionService } from './payment-instruction.service';
import { BankStatementImportService } from './bank-statement-import.service';
import { BankMatchingService } from './bank-matching.service';
import { BankReconciliationService } from './bank-reconciliation.service';
import { TreasuryHealthService } from './treasury-health.service';
import { TreasuryReportingService } from './treasury-reporting.service';

import { InternalBankTransferRepository } from './internal-bank-transfer.repository';
import { InternalBankTransferPostingHandler } from './internal-bank-transfer.posting-handler';
import { InternalTransferService } from './internal-transfer.service';

import { BankFeeRepository } from './bank-fee.repository';
import { BankFeePostingHandler } from './bank-fee.posting-handler';
import { BankFeeService } from './bank-fee.service';

import { FXConversionRepository } from './fx-conversion.repository';
import { FXConversionPostingHandler } from './fx-conversion.posting-handler';
import { FXConversionService } from './fx-conversion.service';

import { TreasuryController } from './treasury.controller';

/**
 * Treasury / Bank Engine (docx spec Phase 14). See docs/TREASURY.md. The
 * three-layer separation (spec sections 1, 26): Layer 1
 * (PaymentRequest/Approval/Calendar/Liquidity) lives entirely in this
 * module's own tables; Layer 2 (bank reality) reuses Phase 13's
 * `SettlementPayment` (extended) plus this module's own
 * `BankCashMovement`/`BankStatement`/`InternalBankTransfer`/`BankFee`/
 * `FXConversion`; Layer 3 (settlement allocation) is Phase 13's own
 * `PaymentAllocationService`/`AdvanceService` — imported, never
 * duplicated (spec section 67).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, RbacModule, SettlementModule, BankCashMovementModule],
  controllers: [TreasuryController],
  providers: [
    PaymentRequestService,
    PaymentCalendarService,
    TreasuryApprovalService,
    LiquidityForecastService,
    PaymentInstructionService,
    BankStatementImportService,
    BankMatchingService,
    BankReconciliationService,
    TreasuryHealthService,
    TreasuryReportingService,

    InternalBankTransferRepository,
    InternalBankTransferPostingHandler,
    InternalTransferService,

    BankFeeRepository,
    BankFeePostingHandler,
    BankFeeService,

    FXConversionRepository,
    FXConversionPostingHandler,
    FXConversionService,
  ],
  exports: [LiquidityForecastService, TreasuryHealthService],
})
export class TreasuryModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly transferRepository: InternalBankTransferRepository,
    private readonly transferHandler: InternalBankTransferPostingHandler,
    private readonly feeRepository: BankFeeRepository,
    private readonly feeHandler: BankFeePostingHandler,
    private readonly fxRepository: FXConversionRepository,
    private readonly fxHandler: FXConversionPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.transferRepository);
    this.registry.registerHandler(this.transferHandler);
    this.registry.registerRepository(this.feeRepository);
    this.registry.registerHandler(this.feeHandler);
    this.registry.registerRepository(this.fxRepository);
    this.registry.registerHandler(this.fxHandler);
  }
}
