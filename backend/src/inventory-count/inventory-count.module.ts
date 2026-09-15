import { Module } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';

import { InventoryCountPlanService } from './inventory-count-plan.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { InventoryRecountService } from './inventory-recount.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryVarianceResolutionService } from './inventory-variance-resolution.service';
import { InventoryCountAdjustmentService } from './inventory-count-adjustment.service';
import { InventoryCountReconciliationService } from './inventory-count-reconciliation.service';
import { InventoryCountReportingService } from './inventory-count-reporting.service';

import { InventoryCountPlanController } from './inventory-count-plan.controller';
import { InventoryCountSessionController } from './inventory-count-session.controller';

/**
 * Inventory Count / Stocktaking Engine (docx spec Phase 12). See
 * docs/INVENTORY_COUNT.md. Depends FORWARD on `InventoryCostingModule`
 * (Phase 11, for policy/dimension resolution and cost layer aggregates)
 * and reads Phase 10's `InventoryMovement`/`InventoryAdjustment` tables
 * directly via `PrismaService` rather than importing
 * `WarehouseInventoryModule` — this module needs none of that module's
 * OWN providers, only its tables (already migrated) and its
 * `InventoryAdjustmentRepository`/`Handler` registration in the shared
 * `DocumentFrameworkRegistry` (populated at bootstrap regardless of which
 * module is loaded first). This keeps the dependency graph one-directional
 * (Phase 12 -> Phase 10/11, never the reverse) with zero risk of a NestJS
 * module cycle — the one place Phase 10 itself needs to know about a
 * Phase 12 concept (the hard-freeze check) is `inventory-freeze.guard.ts`,
 * a plain function `InventoryMovementService` imports directly, not a
 * provider requiring this module to be wired into `WarehouseInventoryModule`.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, InventoryCostingModule],
  controllers: [InventoryCountPlanController, InventoryCountSessionController],
  providers: [
    InventoryCountPlanService,
    InventorySnapshotService,
    InventoryCountSessionService,
    InventoryCountEntryService,
    InventoryRecountService,
    InventoryVarianceService,
    InventoryCountAdjustmentService,
    InventoryVarianceResolutionService,
    InventoryCountReconciliationService,
    InventoryCountReportingService,
  ],
  exports: [InventoryCountReconciliationService],
})
export class InventoryCountModule {}
