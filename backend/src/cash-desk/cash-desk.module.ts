import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { CashBalanceService } from './cash-balance.service';
import { CashierAssignmentService } from './cashier-assignment.service';
import { CashierAssignmentController } from './cashier-assignment.controller';
import { AccountablePersonService } from './accountable-person.service';
import { AccountablePersonController } from './accountable-person.controller';

import { CashDeskTransferRepository } from './cash-desk-transfer.repository';
import { CashDeskTransferPostingHandler } from './cash-desk-transfer.posting-handler';
import { CashDeskTransferService } from './cash-desk-transfer.service';
import { CashDeskTransferController } from './cash-desk-transfer.controller';

import { CurrencyDenominationService } from './currency-denomination.service';
import { CurrencyDenominationController } from './currency-denomination.controller';

import { CashPhysicalCountService } from './cash-physical-count.service';
import { CashPhysicalCountController } from './cash-physical-count.controller';

import { CashCountAdjustmentRepository } from './cash-count-adjustment.repository';
import { CashCountAdjustmentPostingHandler } from './cash-count-adjustment.posting-handler';
import { CashCountAdjustmentService } from './cash-count-adjustment.service';
import { CashCountAdjustmentController } from './cash-count-adjustment.controller';

import { CashDeskDailyCloseService } from './cash-desk-daily-close.service';
import { CashDeskDailyCloseController } from './cash-desk-daily-close.controller';

import { CashierHandoverService } from './cashier-handover.service';
import { CashierHandoverController } from './cashier-handover.controller';

import { CashHealthService } from './cash-health.service';
import { CashHealthController } from './cash-health.controller';

import { CashReportingService } from './cash-reporting.service';
import { CashReportingController } from './cash-reporting.controller';

/**
 * Cash Desk Engine (docx spec Phase 15) — extends the existing Cashbox/
 * CashTransaction foundation (Phase 14's own Treasury build) rather than
 * duplicating it: CashBalanceService/CashierAssignmentService/
 * AccountablePersonService are exported for TreasuryModule's
 * CashTransactionPostingHandler to consume — a one-directional
 * dependency (this module never imports TreasuryModule).
 */
@Module({
  imports: [
    DocumentFrameworkModule,
    NumberingModule,
    AuditModule,
    OrgStructureModule,
    AccountingCoreModule,
  ],
  controllers: [
    CashierAssignmentController,
    AccountablePersonController,
    CashDeskTransferController,
    CurrencyDenominationController,
    CashPhysicalCountController,
    CashCountAdjustmentController,
    CashDeskDailyCloseController,
    CashierHandoverController,
    CashHealthController,
    CashReportingController,
  ],
  providers: [
    CashBalanceService,
    CashierAssignmentService,
    AccountablePersonService,
    CashDeskTransferRepository,
    CashDeskTransferPostingHandler,
    CashDeskTransferService,
    CurrencyDenominationService,
    CashPhysicalCountService,
    CashCountAdjustmentRepository,
    CashCountAdjustmentPostingHandler,
    CashCountAdjustmentService,
    CashDeskDailyCloseService,
    CashierHandoverService,
    CashHealthService,
    CashReportingService,
  ],
  exports: [
    CashBalanceService,
    CashierAssignmentService,
    AccountablePersonService,
  ],
})
export class CashDeskModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly transferRepository: CashDeskTransferRepository,
    private readonly transferHandler: CashDeskTransferPostingHandler,
    private readonly adjustmentRepository: CashCountAdjustmentRepository,
    private readonly adjustmentHandler: CashCountAdjustmentPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.transferRepository);
    this.registry.registerHandler(this.transferHandler);
    this.registry.registerRepository(this.adjustmentRepository);
    this.registry.registerHandler(this.adjustmentHandler);
  }
}
