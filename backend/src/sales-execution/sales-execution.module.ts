import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';
import { SalesPreorderModule } from '../sales-preorder/sales-preorder.module';
import { WarehouseInventoryModule } from '../warehouse-inventory/warehouse-inventory.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { SettlementModule } from '../settlement/settlement.module';

import { InventoryLedgerService } from './inventory-ledger.service';
import { CostingService } from './costing.service';

import { ShipmentRepository } from './shipment.repository';
import { ShipmentPostingHandler } from './shipment.posting-handler';
import { ShipmentService } from './shipment.service';
import { ShipmentController } from './shipment.controller';
import { SalesOrderToShipmentMapper } from './sales-order-to-shipment.mapper';
import { ShipmentToSalesInvoiceMapper } from './shipment-to-invoice.mapper';

import { SalesReturnRepository } from './sales-return.repository';
import { SalesReturnPostingHandler } from './sales-return.posting-handler';
import { SalesReturnService } from './sales-return.service';
import { SalesReturnController } from './sales-return.controller';

/**
 * Sales Execution (docx spec Phase 7). See docs/SALES_EXECUTION.md for the
 * architecture and disclosed simplifications (Costing always returns
 * "unavailable", so COGS is never posted, never fabricated; AR is a clean
 * SettlementObligation contract, not a full Phase 13 register).
 * `InventoryLedgerService` here is this module's own call surface, now
 * backed by the real Phase 10 `InventoryMovement` register (see
 * docs/WAREHOUSE_INVENTORY.md) via `WarehouseInventoryModule` instead of
 * the quantity-only RegisterMovement stand-in it originally used.
 *
 * `CostingService` is exported for `SalesInvoicePostingHandler`
 * (sales-documents module) to consume — this is the one dependency that
 * flows the other way (sales-documents -> sales-execution), so importing
 * this module there is safe: nothing here imports sales-documents back.
 */
@Module({
  imports: [
    DocumentFrameworkModule,
    NumberingModule,
    AuditModule,
    OrgStructureModule,
    AccountingCoreModule,
    TaxEngineModule,
    SalesPreorderModule,
    WarehouseInventoryModule,
    InventoryCostingModule,
    SettlementModule,
  ],
  controllers: [ShipmentController, SalesReturnController],
  providers: [
    InventoryLedgerService,
    CostingService,
    ShipmentRepository,
    ShipmentPostingHandler,
    ShipmentService,
    SalesOrderToShipmentMapper,
    ShipmentToSalesInvoiceMapper,
    SalesReturnRepository,
    SalesReturnPostingHandler,
    SalesReturnService,
  ],
  exports: [CostingService, InventoryLedgerService],
})
export class SalesExecutionModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly shipmentRepository: ShipmentRepository,
    private readonly shipmentHandler: ShipmentPostingHandler,
    private readonly orderToShipmentMapper: SalesOrderToShipmentMapper,
    private readonly shipmentToInvoiceMapper: ShipmentToSalesInvoiceMapper,
    private readonly returnRepository: SalesReturnRepository,
    private readonly returnHandler: SalesReturnPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.shipmentRepository);
    this.registry.registerHandler(this.shipmentHandler);
    this.registry.registerMapper(this.orderToShipmentMapper);
    this.registry.registerMapper(this.shipmentToInvoiceMapper);
    this.registry.registerRepository(this.returnRepository);
    this.registry.registerHandler(this.returnHandler);
  }
}
