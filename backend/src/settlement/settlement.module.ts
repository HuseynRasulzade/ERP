import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { NumberingModule } from '../numbering/numbering.module';
import { CurrencyModule } from '../currency/currency.module';

import { SettlementMovementService } from './settlement-movement.service';
import { OpenItemService } from './open-item.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { SettlementOffsetService } from './settlement-offset.service';
import { DebtAdjustmentService } from './debt-adjustment.service';
import { AgeingService } from './ageing.service';
import { SettlementReportingService } from './settlement-reporting.service';
import { SettlementReconciliationService } from './settlement-reconciliation.service';
import { CreditExposureService } from './credit-exposure.service';
import { SettlementHealthService } from './settlement-health.service';

import { SettlementOpenItemController } from './settlement-open-item.controller';
import { SettlementAllocationController } from './settlement-allocation.controller';
import { SettlementOffsetController } from './settlement-offset.controller';
import { SettlementDebtAdjustmentController } from './settlement-debt-adjustment.controller';
import { SettlementReconciliationController } from './settlement-reconciliation.controller';

/**
 * Counterparty Settlement Engine (docx spec Phase 13) — see
 * docs/SETTLEMENT.md. Exports the write path (`SettlementMovementService`,
 * `PaymentAllocationService`) so SalesDocumentsModule/PurchaseExecutionModule/
 * TreasuryModule can hook their own posting handlers into it additively,
 * alongside (never replacing) the pre-existing SettlementObligation/
 * SupplierPayable mutable rows those handlers already write.
 */
@Module({
  imports: [AuditModule, OrgStructureModule, NumberingModule, CurrencyModule],
  controllers: [SettlementOpenItemController, SettlementAllocationController, SettlementOffsetController, SettlementDebtAdjustmentController, SettlementReconciliationController],
  providers: [
    SettlementMovementService,
    OpenItemService,
    PaymentAllocationService,
    SettlementOffsetService,
    DebtAdjustmentService,
    AgeingService,
    SettlementReportingService,
    SettlementReconciliationService,
    CreditExposureService,
    SettlementHealthService,
  ],
  exports: [SettlementMovementService, OpenItemService, PaymentAllocationService, CreditExposureService],
})
export class SettlementModule {}
