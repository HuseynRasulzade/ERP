import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { NumberingModule } from '../numbering/numbering.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { CounterpartyPricingModule } from '../counterparty-pricing/counterparty-pricing.module';
import { InventoryFreezeModule } from './inventory-freeze.module';

import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventoryCountScopeService } from './inventory-count-scope.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountSheetService } from './inventory-count-sheet.service';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { InventoryCountPlanController } from './inventory-count-plan.controller';
import { InventoryCountSessionController } from './inventory-count-session.controller';
import { InventoryCountSheetController } from './inventory-count-sheet.controller';
import { InventoryCountEntryController } from './inventory-count-entry.controller';

/**
 * Inventory Count / Reconciliation Engine (docx spec Phase 12) — see
 * docs/INVENTORY_COUNT.md. Reuses Phase 10's InventoryMovement register
 * (via InventorySnapshotService) and Phase 11's InventoryCostingService
 * for valuation; posts corrections through the EXISTING InventoryAdjustment/
 * WarehouseTransfer/InventoryStatusTransfer document types rather than a
 * new one (spec section 51) — this module never registers its own
 * DocumentFrameworkRegistry participant.
 */
@Module({
  imports: [AuditModule, OrgStructureModule, NumberingModule, InventoryCostingModule, CounterpartyPricingModule, InventoryFreezeModule],
  controllers: [InventoryCountPlanController, InventoryCountSessionController, InventoryCountSheetController, InventoryCountEntryController],
  providers: [InventoryCountPlanService, InventoryCountScopeService, InventorySnapshotService, InventoryCountSessionService, InventoryCountSheetService, InventoryCountEntryService],
  exports: [InventoryCountPlanService, InventoryCountScopeService, InventorySnapshotService, InventoryCountSessionService, InventoryCountSheetService, InventoryCountEntryService],
})
export class InventoryCountModule {}
