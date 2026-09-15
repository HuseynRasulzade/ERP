import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { InventoryCostingPolicyService } from './inventory-costing-policy.service';
import { CostingDimensionService } from './costing-dimension.service';
import { FIFOEngine } from './fifo-engine.service';
import { WeightedAverageEngine } from './weighted-average-engine.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';
import { CostingPeriodService } from './costing-period.service';
import { CostingReconciliationService } from './costing-reconciliation.service';
import { InventoryCostingService } from './inventory-costing.service';
import { AdditionalCostCapitalizationService } from './additional-cost-capitalization.service';
import { InventoryValuationService } from './inventory-valuation.service';
import { CostingReportingService } from './costing-reporting.service';
import { InventoryCostingController } from './inventory-costing.controller';

import { InventoryCostAdjustmentRepository } from './inventory-cost-adjustment.repository';
import { InventoryCostAdjustmentPostingHandler } from './inventory-cost-adjustment.posting-handler';
import { InventoryCostAdjustmentService } from './inventory-cost-adjustment.service';
import { InventoryCostAdjustmentController } from './inventory-cost-adjustment.controller';

/**
 * Inventory Costing Engine (docx spec Phase 11). See
 * docs/INVENTORY_COSTING.md for the architecture. Exports
 * `InventoryCostingService` (the RECEIPT/ISSUE pricing facade posting
 * handlers call) and `InventoryCostRecalculationService` (so
 * GoodsReceipt/Shipment/Return handlers can request a recalculation
 * without importing the whole module), following the same
 * export-the-facade-not-the-internals convention as
 * `WarehouseInventoryModule`.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule],
  controllers: [InventoryCostingController, InventoryCostAdjustmentController],
  providers: [
    InventoryCostingPolicyService,
    CostingDimensionService,
    FIFOEngine,
    WeightedAverageEngine,
    InventoryCostRecalculationService,
    CostingReconciliationService,
    InventoryCostAdjustmentService, // depended on by CostingPeriodService — declared before it for readability only, DI order does not matter
    CostingPeriodService,
    InventoryCostingService,
    AdditionalCostCapitalizationService,
    InventoryValuationService,
    CostingReportingService,

    InventoryCostAdjustmentRepository,
    InventoryCostAdjustmentPostingHandler,
  ],
  exports: [InventoryCostingService, InventoryCostRecalculationService, AdditionalCostCapitalizationService, CostingPeriodService, InventoryCostingPolicyService, CostingDimensionService, FIFOEngine, WeightedAverageEngine, CostingReconciliationService, InventoryValuationService],
})
export class InventoryCostingModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly adjustmentRepository: InventoryCostAdjustmentRepository,
    private readonly adjustmentHandler: InventoryCostAdjustmentPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.adjustmentRepository);
    this.registry.registerHandler(this.adjustmentHandler);
  }
}
