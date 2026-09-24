import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { CostingPolicyService } from './costing-policy.service';
import { CostingPeriodService } from './costing-period.service';
import { CostingDimensionService } from './costing-dimension.service';
import { FifoCostingStrategy } from './fifo-costing.strategy';
import { WeightedAverageCostingStrategy } from './weighted-average-costing.strategy';
import { InventoryCostingService } from './inventory-costing.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';
import { InventoryCostingReportingService } from './inventory-costing-reporting.service';
import { InventoryCostingPolicyController } from './inventory-costing-policy.controller';
import { InventoryCostingOperationsController } from './inventory-costing-operations.controller';

import { InventoryCostAdjustmentRepository } from './inventory-cost-adjustment.repository';
import { InventoryCostAdjustmentPostingHandler } from './inventory-cost-adjustment.posting-handler';
import { InventoryCostAdjustmentService } from './inventory-cost-adjustment.service';
import { InventoryCostAdjustmentController } from './inventory-cost-adjustment.controller';

/**
 * Inventory Costing Engine (docx spec Phase 11) — see
 * docs/INVENTORY_COSTING.md. `InventoryCostingService` is the only export
 * every other module's posting handler should depend on; the strategies
 * and dimension/policy resolvers are internal to this module.
 * `InventoryCostAdjustment` registers as a normal DocumentFrameworkRegistry
 * participant (draft -> post) so its GL consequence flows through the same
 * AccountingPostingEngine path as every other document.
 */
@Module({
  imports: [AuditModule, OrgStructureModule, DocumentFrameworkModule, NumberingModule, AccountingCoreModule],
  controllers: [InventoryCostingPolicyController, InventoryCostingOperationsController, InventoryCostAdjustmentController],
  providers: [
    CostingPolicyService,
    CostingPeriodService,
    CostingDimensionService,
    FifoCostingStrategy,
    WeightedAverageCostingStrategy,
    InventoryCostingService,
    InventoryCostRecalculationService,
    InventoryCostingReportingService,
    InventoryCostAdjustmentRepository,
    InventoryCostAdjustmentPostingHandler,
    InventoryCostAdjustmentService,
  ],
  exports: [InventoryCostingService, CostingPolicyService, CostingPeriodService, InventoryCostRecalculationService, InventoryCostingReportingService],
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
