import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { NumberingModule } from '../numbering/numbering.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { InventoryFreezeModule } from './inventory-freeze.module';

import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventoryCountScopeService } from './inventory-count-scope.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountPlanController } from './inventory-count-plan.controller';

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
  imports: [AuditModule, OrgStructureModule, NumberingModule, InventoryCostingModule, InventoryFreezeModule],
  controllers: [InventoryCountPlanController],
  providers: [InventoryCountPlanService, InventoryCountScopeService, InventorySnapshotService],
  exports: [InventoryCountPlanService, InventoryCountScopeService, InventorySnapshotService],
})
export class InventoryCountModule {}
