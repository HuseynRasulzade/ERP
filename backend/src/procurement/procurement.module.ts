import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { CounterpartyPricingModule } from '../counterparty-pricing/counterparty-pricing.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';

import { PurchaseRequirementService } from './purchase-requirement.service';
import { PurchaseRequirementController } from './purchase-requirement.controller';

import { PurchaseOrderRepository } from './purchase-order.repository';
import { PurchaseOrderPostingHandler } from './purchase-order.posting-handler';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderExtrasController, PurchaseOrderHoldReleaseController } from './purchase-order-extras.controller';
import { PurchaseOrderHoldService } from './purchase-order-hold.service';
import { PurchaseOrderPaymentScheduleService } from './purchase-order-payment-schedule.service';

import { PurchasePriceResolverService } from './purchase-price-resolver.service';
import { ProcurementPlanningService } from './procurement-planning.service';
import { SupplierSelectionService } from './supplier-selection.service';
import { ExpectedStockService } from './expected-stock.service';
import { ProcurementQueriesController } from './procurement-queries.controller';

import { SupplierProductCodeService } from './supplier-product-code.service';
import { SupplierProductCodeController } from './supplier-product-code.controller';

import { SupplyPegService } from './supply-peg.service';
import { SupplyPegController } from './supply-peg.controller';

/**
 * Procurement & Purchase Order Management (docx spec Phase 8). See
 * docs/PROCUREMENT.md for the architecture and deliberate simplifications
 * (no persisted SupplierComparison; no dedicated ExpectedReceipt table —
 * both are computed live). Registers PurchaseOrder as a full document-
 * framework participant (repository + posting handler, no
 * buildAccountingBatch — spec section 94's "no GL posting" is a
 * structural guarantee, not a runtime check). PurchaseRequirement does
 * NOT go through the document-framework — it never posts (spec section
 * 94) — so it is plain CRUD, matching CustomerRequest's non-posting shape
 * more than SalesOrder's.
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, CounterpartyPricingModule, TaxEngineModule],
  controllers: [
    PurchaseRequirementController,
    PurchaseOrderController,
    PurchaseOrderExtrasController,
    PurchaseOrderHoldReleaseController,
    ProcurementQueriesController,
    SupplierProductCodeController,
    SupplyPegController,
  ],
  providers: [
    PurchaseRequirementService,
    PurchaseOrderRepository,
    PurchaseOrderPostingHandler,
    PurchaseOrderService,
    PurchaseOrderHoldService,
    PurchaseOrderPaymentScheduleService,
    PurchasePriceResolverService,
    ProcurementPlanningService,
    SupplierSelectionService,
    ExpectedStockService,
    SupplierProductCodeService,
    SupplyPegService,
  ],
  exports: [PurchasePriceResolverService, ProcurementPlanningService, ExpectedStockService],
})
export class ProcurementModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly purchaseOrderPostingHandler: PurchaseOrderPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.purchaseOrderRepository);
    this.registry.registerHandler(this.purchaseOrderPostingHandler);
  }
}
