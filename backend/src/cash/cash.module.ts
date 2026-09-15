import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { SettlementModule } from '../settlement/settlement.module';
import { CashMovementModule } from './cash-movement.module';
import { AccountablePersonModule } from './accountable-person.module';

import { CashDeskService } from './cash-desk.service';
import { CashierAssignmentService } from './cashier-assignment.service';

import { CashDeskTransferRepository } from './cash-desk-transfer.repository';
import { CashDeskTransferPostingHandler } from './cash-desk-transfer.posting-handler';
import { CashDeskTransferService } from './cash-desk-transfer.service';

import { CashPhysicalCountService } from './cash-physical-count.service';

import { CashCountAdjustmentRepository } from './cash-count-adjustment.repository';
import { CashCountAdjustmentPostingHandler } from './cash-count-adjustment.posting-handler';
import { CashCountAdjustmentService } from './cash-count-adjustment.service';

import { CashDailyCloseService } from './cash-daily-close.service';
import { CashierHandoverService } from './cashier-handover.service';
import { CashHealthService } from './cash-health.service';

import { CashController } from './cash.controller';

/**
 * Cash / Kassa Engine (docx spec Phase 15). See docs/CASH.md. Imports
 * `SettlementModule` for `SettlementPaymentService` — Cash's own receipt/
 * expense orders ARE `SettlementPayment` rows with `cashDeskId` set (see
 * schema.prisma's own doc comment), not a duplicate document type — so
 * this module reuses that service and the shared `DocumentPostingService`
 * lifecycle instead of building CashReceiptOrder/CashExpenseOrder afresh.
 * No cycle: `SettlementModule` depends only on the leaf `CashMovementModule`/
 * `AccountablePersonModule`, never on `CashModule` itself.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, SettlementModule, CashMovementModule, AccountablePersonModule],
  controllers: [CashController],
  providers: [
    CashDeskService,
    CashierAssignmentService,

    CashDeskTransferRepository,
    CashDeskTransferPostingHandler,
    CashDeskTransferService,

    CashPhysicalCountService,

    CashCountAdjustmentRepository,
    CashCountAdjustmentPostingHandler,
    CashCountAdjustmentService,

    CashDailyCloseService,
    CashierHandoverService,
    CashHealthService,
  ],
  exports: [CashDeskService, CashierAssignmentService, CashPhysicalCountService, CashHealthService],
})
export class CashModule implements OnModuleInit {
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
