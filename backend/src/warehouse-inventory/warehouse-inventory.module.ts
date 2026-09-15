import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';

import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';
import { BatchSerialService } from './batch-serial.service';
import { WarehouseInventoryReportingService } from './warehouse-inventory-reporting.service';
import { WarehouseInventoryQueriesController } from './warehouse-inventory-queries.controller';

import { WarehouseTransferRepository } from './warehouse-transfer.repository';
import { WarehouseTransferPostingHandler } from './warehouse-transfer.posting-handler';
import { WarehouseTransferService } from './warehouse-transfer.service';
import { WarehouseTransferController } from './warehouse-transfer.controller';

import { InternalConsumptionRepository } from './internal-consumption.repository';
import { InternalConsumptionPostingHandler } from './internal-consumption.posting-handler';
import { InternalConsumptionService } from './internal-consumption.service';
import { InternalConsumptionController } from './internal-consumption.controller';

import { InventoryAdjustmentRepository } from './inventory-adjustment.repository';
import { InventoryAdjustmentPostingHandler } from './inventory-adjustment.posting-handler';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { InventoryAdjustmentController } from './inventory-adjustment.controller';

import { InventoryStatusTransferRepository } from './inventory-status-transfer.repository';
import { InventoryStatusTransferPostingHandler } from './inventory-status-transfer.posting-handler';
import { InventoryStatusTransferService } from './inventory-status-transfer.service';
import { InventoryStatusTransferController } from './inventory-status-transfer.controller';

/**
 * Warehouse / Stock Engine (docx spec Phase 10). See
 * docs/WAREHOUSE_INVENTORY.md for the architecture. Houses the Stock
 * Truth Engine every other module reads from (`StockAvailabilityService`)
 * and writes through (`InventoryMovementService`) — exported so
 * `SalesExecutionModule`/`PurchaseExecutionModule` can retrofit their own
 * `InventoryLedgerService` onto it (never the reverse import direction).
 *
 * Also registers this phase's own four document types — WarehouseTransfer,
 * InternalConsumption, InventoryAdjustment, InventoryStatusTransfer — as
 * full DocumentFrameworkRegistry participants, following the same
 * repository+handler registration pattern as every other document module.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, InventoryCostingModule],
  controllers: [WarehouseInventoryQueriesController, WarehouseTransferController, InternalConsumptionController, InventoryAdjustmentController, InventoryStatusTransferController],
  providers: [
    InventoryMovementService,
    StockAvailabilityService,
    BatchSerialService,
    WarehouseInventoryReportingService,

    WarehouseTransferRepository,
    WarehouseTransferPostingHandler,
    WarehouseTransferService,

    InternalConsumptionRepository,
    InternalConsumptionPostingHandler,
    InternalConsumptionService,

    InventoryAdjustmentRepository,
    InventoryAdjustmentPostingHandler,
    InventoryAdjustmentService,

    InventoryStatusTransferRepository,
    InventoryStatusTransferPostingHandler,
    InventoryStatusTransferService,
  ],
  exports: [InventoryMovementService, StockAvailabilityService, BatchSerialService],
})
export class WarehouseInventoryModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly warehouseTransferRepository: WarehouseTransferRepository,
    private readonly warehouseTransferHandler: WarehouseTransferPostingHandler,
    private readonly internalConsumptionRepository: InternalConsumptionRepository,
    private readonly internalConsumptionHandler: InternalConsumptionPostingHandler,
    private readonly inventoryAdjustmentRepository: InventoryAdjustmentRepository,
    private readonly inventoryAdjustmentHandler: InventoryAdjustmentPostingHandler,
    private readonly inventoryStatusTransferRepository: InventoryStatusTransferRepository,
    private readonly inventoryStatusTransferHandler: InventoryStatusTransferPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.warehouseTransferRepository);
    this.registry.registerHandler(this.warehouseTransferHandler);
    this.registry.registerRepository(this.internalConsumptionRepository);
    this.registry.registerHandler(this.internalConsumptionHandler);
    this.registry.registerRepository(this.inventoryAdjustmentRepository);
    this.registry.registerHandler(this.inventoryAdjustmentHandler);
    this.registry.registerRepository(this.inventoryStatusTransferRepository);
    this.registry.registerHandler(this.inventoryStatusTransferHandler);
  }
}
