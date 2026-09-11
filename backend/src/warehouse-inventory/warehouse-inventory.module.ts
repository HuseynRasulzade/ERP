import { Module } from '@nestjs/common';
import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';

/**
 * Warehouse / Stock Engine (docx spec Phase 10) — foundational module
 * housing the Stock Truth Engine every other module reads from
 * (`StockAvailabilityService`) and writes through
 * (`InventoryMovementService`). Imported BY `SalesExecutionModule` and
 * `PurchaseExecutionModule` (never the reverse) so `InventoryLedgerService`
 * — those modules' own call surface, kept byte-for-byte call-site
 * compatible — can delegate to the real Phase 10 register underneath.
 */
@Module({
  providers: [InventoryMovementService, StockAvailabilityService],
  exports: [InventoryMovementService, StockAvailabilityService],
})
export class WarehouseInventoryModule {}
