import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';

import { InventoryFreezeService } from './inventory-freeze.service';

/**
 * Inventory Count / Reconciliation Engine (docx spec Phase 12) — see
 * docs/INVENTORY_COUNT.md. `InventoryFreezeService` is exported early so
 * every stock-affecting module (Purchase/Sales Execution, Warehouse
 * Inventory) can depend on it without a circular import back into this
 * module's own document-heavy services.
 */
@Module({
  imports: [AuditModule],
  providers: [InventoryFreezeService],
  exports: [InventoryFreezeService],
})
export class InventoryFreezeModule {}
