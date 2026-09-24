import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ApprovalPlanRegistryService } from '../approvals/approval-plan-registry.service';
import { WarehouseInventoryModule } from '../warehouse-inventory/warehouse-inventory.module';
import { InventoryMovementService } from '../warehouse-inventory/inventory-movement.service';
import { SalesExecutionModule } from '../sales-execution/sales-execution.module';

import { InventoryCountEventsService } from './inventory-count-events.service';
import { InventoryCountCostingService } from './inventory-count-costing.service';
import { InventoryCountScopeService } from './inventory-count-scope.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryFreezeService } from './inventory-freeze.service';
import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountSheetService } from './inventory-count-sheet.service';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryVarianceResolutionService } from './inventory-variance-resolution.service';
import { InventoryRecountService } from './inventory-recount.service';
import { InventoryCountApprovalPlanProvider, InventoryCountApprovalService } from './inventory-count-approval.service';
import { InventoryCountAdjustmentRepository } from './inventory-count-adjustment.repository';
import { InventoryCountAdjustmentPostingHandler } from './inventory-count-adjustment.posting-handler';
import { InventoryCountAdjustmentService } from './inventory-count-adjustment.service';
import { InventoryCountReconciliationService } from './inventory-count-reconciliation.service';
import { InventoryCountReportingService } from './inventory-count-reporting.service';
import { InventoryCountAttachmentService } from './inventory-count-attachment.service';
import { InventoryCountController, InventoryCountReasonCodesController, InventoryCountReportsController } from './inventory-count.controller';

/**
 * Phase 12 — Inventory Count / İnventarizasiya / Stocktaking. See
 * docs/PHASE12_INVENTORY_COUNT.md. Extends (never modifies the behaviour
 * of) the Phase 10 warehouse module: it registers a freeze guard on the
 * single movement writer, a new document type (INVENTORY_COUNT_ADJUSTMENT)
 * with the document framework, and an approval plan with the approvals
 * foundation.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, ApprovalsModule, WarehouseInventoryModule, SalesExecutionModule],
  controllers: [InventoryCountController, InventoryCountReportsController, InventoryCountReasonCodesController],
  providers: [
    InventoryCountEventsService,
    InventoryCountCostingService,
    InventoryCountScopeService,
    InventorySnapshotService,
    InventoryFreezeService,
    InventoryCountPlanService,
    InventoryCountSessionService,
    InventoryCountSheetService,
    InventoryCountEntryService,
    InventoryVarianceService,
    InventoryVarianceResolutionService,
    InventoryRecountService,
    InventoryCountApprovalPlanProvider,
    InventoryCountApprovalService,
    InventoryCountAdjustmentRepository,
    InventoryCountAdjustmentPostingHandler,
    InventoryCountAdjustmentService,
    InventoryCountReconciliationService,
    InventoryCountReportingService,
    InventoryCountAttachmentService,
  ],
  exports: [InventoryCountReportingService, InventorySnapshotService],
})
export class InventoryCountModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly approvalPlans: ApprovalPlanRegistryService,
    private readonly movements: InventoryMovementService,
    private readonly freeze: InventoryFreezeService,
    private readonly adjustmentRepository: InventoryCountAdjustmentRepository,
    private readonly adjustmentHandler: InventoryCountAdjustmentPostingHandler,
    private readonly approvalProvider: InventoryCountApprovalPlanProvider,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.adjustmentRepository);
    this.registry.registerHandler(this.adjustmentHandler);
    this.approvalPlans.register(this.approvalProvider);
    this.movements.registerGuard(this.freeze);
  }
}
