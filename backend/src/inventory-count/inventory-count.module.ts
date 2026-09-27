import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { NumberingModule } from '../numbering/numbering.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { CounterpartyPricingModule } from '../counterparty-pricing/counterparty-pricing.module';
import { WarehouseInventoryModule } from '../warehouse-inventory/warehouse-inventory.module';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { InventoryFreezeModule } from './inventory-freeze.module';

import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventoryCountScopeService } from './inventory-count-scope.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountSheetService } from './inventory-count-sheet.service';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryRecountService } from './inventory-recount.service';
import { InventoryVarianceResolutionService } from './inventory-variance-decision.service';
import { InventoryCountAdjustmentService } from './inventory-count-adjustment.service';
import { InventoryCountReconciliationService } from './inventory-count-reconciliation.service';
import { InventoryCountReportingService } from './inventory-count-reporting.service';

import { InventoryCountPlanController } from './inventory-count-plan.controller';
import { InventoryCountSessionController } from './inventory-count-session.controller';
import { InventoryCountSheetController } from './inventory-count-sheet.controller';
import { InventoryCountEntryController } from './inventory-count-entry.controller';
import { InventoryCountVarianceController } from './inventory-count-variance.controller';
import { InventoryCountReportingController } from './inventory-count-reporting.controller';

/**
 * Inventory Count / Reconciliation Engine (docx spec Phase 12) — see
 * docs/INVENTORY_COUNT.md. Reuses Phase 10's InventoryMovement register
 * (via InventorySnapshotService) and Phase 11's InventoryCostingService
 * for valuation; posts corrections through the EXISTING InventoryAdjustment/
 * WarehouseTransfer/InventoryStatusTransfer document types rather than a
 * new one (spec section 51) — this module never registers its own
 * DocumentFrameworkRegistry participant, it only ever calls the generic
 * DocumentPostingService (via InventoryCountAdjustmentService) the same
 * way an HTTP request would.
 */
@Module({
  imports: [AuditModule, OrgStructureModule, NumberingModule, InventoryCostingModule, CounterpartyPricingModule, WarehouseInventoryModule, DocumentFrameworkModule, InventoryFreezeModule],
  controllers: [
    InventoryCountPlanController,
    InventoryCountSessionController,
    InventoryCountSheetController,
    InventoryCountEntryController,
    InventoryCountVarianceController,
    InventoryCountReportingController,
  ],
  providers: [
    InventoryCountPlanService,
    InventoryCountScopeService,
    InventorySnapshotService,
    InventoryCountSessionService,
    InventoryCountSheetService,
    InventoryCountEntryService,
    InventoryVarianceService,
    InventoryRecountService,
    InventoryVarianceResolutionService,
    InventoryCountAdjustmentService,
    InventoryCountReconciliationService,
    InventoryCountReportingService,
  ],
  exports: [
    InventoryCountPlanService,
    InventoryCountScopeService,
    InventorySnapshotService,
    InventoryCountSessionService,
    InventoryCountSheetService,
    InventoryCountEntryService,
    InventoryVarianceService,
    InventoryRecountService,
    InventoryVarianceResolutionService,
    InventoryCountAdjustmentService,
    InventoryCountReconciliationService,
    InventoryCountReportingService,
  ],
})
export class InventoryCountModule {}
