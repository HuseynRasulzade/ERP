import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { NumberingModule } from '../numbering/numbering.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { PeriodModule } from '../period/period.module';

import { InventoryCostingPolicyService } from './costing-policy.service';
import { InventoryCostingDimensionService } from './costing-dimension.service';
import { CostSourceService } from './cost-source.service';
import { InventoryCostEngine } from './inventory-cost-engine.service';
import { InventoryCostAdjustmentService } from './cost-adjustment.service';
import { InventoryCostingService } from './inventory-costing.service';
import { CostingReportingService } from './costing-reporting.service';
import { CostingPeriodService } from './costing-period.service';
import { ManualCostAdjustmentService } from './manual-cost-adjustment.service';
import { InventoryCostingController } from './inventory-costing.controller';

/**
 * Inventory Costing Engine (docx spec Phase 11) — see
 * docs/INVENTORY_COSTING.md. A separate cost subledger on top of the
 * Phase 10 quantity register. Depends only on platform/accounting modules
 * (never on the document modules that call it), so Warehouse Inventory,
 * Sales Execution and Purchase Execution can all import it without a
 * cycle and call `InventoryCostingService` from their posting handlers.
 */
@Module({
  imports: [AuditModule, AccountingCoreModule, NumberingModule, OrgStructureModule, PeriodModule],
  controllers: [InventoryCostingController],
  providers: [
    InventoryCostingPolicyService,
    InventoryCostingDimensionService,
    CostSourceService,
    InventoryCostEngine,
    InventoryCostAdjustmentService,
    InventoryCostingService,
    CostingReportingService,
    CostingPeriodService,
    ManualCostAdjustmentService,
  ],
  exports: [InventoryCostingService, InventoryCostingPolicyService, CostingReportingService, CostingPeriodService],
})
export class InventoryCostingModule {}
