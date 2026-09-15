import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { WarehouseInventoryModule } from '../warehouse-inventory/warehouse-inventory.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';

import { BOMService } from './bom.service';
import { RoutingService } from './routing.service';
import { WorkCenterService } from './work-center.service';

import { ProductionOrderRepository } from './production-order.repository';
import { ProductionOrderPostingHandler } from './production-order.posting-handler';
import { ProductionOrderService } from './production-order.service';

import { MaterialIssueRepository } from './material-issue.repository';
import { MaterialIssuePostingHandler } from './material-issue.posting-handler';
import { MaterialIssueService } from './material-issue.service';

import { OperationExecutionService } from './operation-execution.service';

import { ProductionOutputRepository } from './production-output.repository';
import { ProductionOutputPostingHandler } from './production-output.posting-handler';
import { ProductionOutputService } from './production-output.service';

import { OverheadService } from './overhead.service';
import { ProductionCloseService } from './production-close.service';
import { ProductionReportingService } from './production-reporting.service';
import { ProductionHealthService } from './production-health.service';

import { ManufacturingController } from './manufacturing.controller';

/**
 * Manufacturing / Production Engine (docx spec Phase 21). See
 * docs/MANUFACTURING.md. Imports `WarehouseInventoryModule` (Phase 10)
 * and `InventoryCostingModule` (Phase 11) directly — material issue/
 * return and output receipt reuse those engines' own
 * `InventoryMovementService`/`InventoryCostingService`, never a second
 * inventory/costing engine (spec section 2).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, AccountingCoreModule, WarehouseInventoryModule, InventoryCostingModule],
  controllers: [ManufacturingController],
  providers: [
    BOMService,
    RoutingService,
    WorkCenterService,

    ProductionOrderRepository,
    ProductionOrderPostingHandler,
    ProductionOrderService,

    MaterialIssueRepository,
    MaterialIssuePostingHandler,
    MaterialIssueService,

    OperationExecutionService,

    ProductionOutputRepository,
    ProductionOutputPostingHandler,
    ProductionOutputService,

    OverheadService,
    ProductionCloseService,
    ProductionReportingService,
    ProductionHealthService,
  ],
  exports: [BOMService, ProductionCloseService],
})
export class ManufacturingModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly orderRepository: ProductionOrderRepository,
    private readonly orderHandler: ProductionOrderPostingHandler,
    private readonly issueRepository: MaterialIssueRepository,
    private readonly issueHandler: MaterialIssuePostingHandler,
    private readonly outputRepository: ProductionOutputRepository,
    private readonly outputHandler: ProductionOutputPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.orderRepository);
    this.registry.registerHandler(this.orderHandler);
    this.registry.registerRepository(this.issueRepository);
    this.registry.registerHandler(this.issueHandler);
    this.registry.registerRepository(this.outputRepository);
    this.registry.registerHandler(this.outputHandler);
  }
}
