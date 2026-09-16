import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { SalesExecutionModule } from '../sales-execution/sales-execution.module';
import { WarehouseInventoryModule } from '../warehouse-inventory/warehouse-inventory.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { SettlementModule } from '../settlement/settlement.module';
import { CounterpartyContractsModule } from '../counterparty-contracts/counterparty-contracts.module';

import { PurchaseFulfillmentService } from './purchase-fulfillment.service';

import { GoodsReceiptRepository } from './goods-receipt.repository';
import { GoodsReceiptPostingHandler } from './goods-receipt.posting-handler';
import { GoodsReceiptService } from './goods-receipt.service';
import { GoodsReceiptController } from './goods-receipt.controller';

import { PurchaseInvoiceRepository } from './purchase-invoice.repository';
import { PurchaseInvoicePostingHandler } from './purchase-invoice.posting-handler';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';

import { SupplierSettlementService } from './supplier-settlement.service';

import { PurchaseReturnRepository } from './purchase-return.repository';
import { PurchaseReturnPostingHandler } from './purchase-return.posting-handler';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnController } from './purchase-return.controller';

import { AdditionalPurchaseCostRepository } from './additional-purchase-cost.repository';
import { AdditionalPurchaseCostPostingHandler } from './additional-purchase-cost.posting-handler';
import { AdditionalPurchaseCostService } from './additional-purchase-cost.service';
import { AdditionalPurchaseCostController } from './additional-purchase-cost.controller';

import { PurchaseMatchingService } from './purchase-matching.service';
import { PurchaseReportingService } from './purchase-reporting.service';
import { PurchaseExecutionQueriesController } from './purchase-execution-queries.controller';

import {
  SupplierOrderToGoodsReceiptMapper,
  SupplierOrderToPurchaseInvoiceMapper,
  GoodsReceiptToPurchaseInvoiceMapper,
  GoodsReceiptToPurchaseReturnMapper,
  PurchaseInvoiceToPurchaseReturnMapper,
} from './purchase-execution.mappers';

import { ApprovalsModule } from '../approvals/approvals.module';
import { ApprovalPlanRegistryService } from '../approvals/approval-plan-registry.service';
import { GoodsReceiptApprovalPlanProvider } from './goods-receipt-approval-plan.provider';
import { PurchaseInvoiceApprovalPlanProvider } from './purchase-invoice-approval-plan.provider';

/**
 * Purchase Execution (docx spec Phase 9). See docs/PURCHASE_EXECUTION.md
 * for the architecture (Model A GRNI clearing, disclosed simplifications:
 * no batch/serial tracking, no approval workflow, no payment/advance
 * engine — Phase 13/14 boundary). Registers GoodsReceipt, PurchaseInvoice,
 * PurchaseReturn, and AdditionalPurchaseCost as full document-framework
 * participants (repository + posting handler), and five Create Based On
 * mappers covering the spec's core document chains (section 25).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule, TaxEngineModule, AccountingCoreModule, SalesExecutionModule, WarehouseInventoryModule, InventoryCostingModule, SettlementModule, CounterpartyContractsModule, ApprovalsModule],
  controllers: [GoodsReceiptController, PurchaseInvoiceController, PurchaseReturnController, AdditionalPurchaseCostController, PurchaseExecutionQueriesController],
  providers: [
    PurchaseFulfillmentService,
    GoodsReceiptRepository,
    GoodsReceiptPostingHandler,
    GoodsReceiptService,
    PurchaseInvoiceRepository,
    PurchaseInvoicePostingHandler,
    PurchaseInvoiceService,
    SupplierSettlementService,
    PurchaseReturnRepository,
    PurchaseReturnPostingHandler,
    PurchaseReturnService,
    AdditionalPurchaseCostRepository,
    AdditionalPurchaseCostPostingHandler,
    AdditionalPurchaseCostService,
    PurchaseMatchingService,
    PurchaseReportingService,
    SupplierOrderToGoodsReceiptMapper,
    SupplierOrderToPurchaseInvoiceMapper,
    GoodsReceiptToPurchaseInvoiceMapper,
    GoodsReceiptToPurchaseReturnMapper,
    PurchaseInvoiceToPurchaseReturnMapper,
    GoodsReceiptApprovalPlanProvider,
    PurchaseInvoiceApprovalPlanProvider,
  ],
  exports: [PurchaseFulfillmentService],
})
export class PurchaseExecutionModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly goodsReceiptRepository: GoodsReceiptRepository,
    private readonly goodsReceiptHandler: GoodsReceiptPostingHandler,
    private readonly purchaseInvoiceRepository: PurchaseInvoiceRepository,
    private readonly purchaseInvoiceHandler: PurchaseInvoicePostingHandler,
    private readonly purchaseReturnRepository: PurchaseReturnRepository,
    private readonly purchaseReturnHandler: PurchaseReturnPostingHandler,
    private readonly additionalCostRepository: AdditionalPurchaseCostRepository,
    private readonly additionalCostHandler: AdditionalPurchaseCostPostingHandler,
    private readonly supplierOrderToGoodsReceipt: SupplierOrderToGoodsReceiptMapper,
    private readonly supplierOrderToPurchaseInvoice: SupplierOrderToPurchaseInvoiceMapper,
    private readonly goodsReceiptToPurchaseInvoice: GoodsReceiptToPurchaseInvoiceMapper,
    private readonly goodsReceiptToPurchaseReturn: GoodsReceiptToPurchaseReturnMapper,
    private readonly purchaseInvoiceToPurchaseReturn: PurchaseInvoiceToPurchaseReturnMapper,
    private readonly approvalPlanRegistry: ApprovalPlanRegistryService,
    private readonly goodsReceiptApprovalPlan: GoodsReceiptApprovalPlanProvider,
    private readonly purchaseInvoiceApprovalPlan: PurchaseInvoiceApprovalPlanProvider,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.goodsReceiptRepository);
    this.registry.registerHandler(this.goodsReceiptHandler);
    this.registry.registerRepository(this.purchaseInvoiceRepository);
    this.registry.registerHandler(this.purchaseInvoiceHandler);
    this.registry.registerRepository(this.purchaseReturnRepository);
    this.registry.registerHandler(this.purchaseReturnHandler);
    this.registry.registerRepository(this.additionalCostRepository);
    this.registry.registerHandler(this.additionalCostHandler);

    this.registry.registerMapper(this.supplierOrderToGoodsReceipt);
    this.registry.registerMapper(this.supplierOrderToPurchaseInvoice);
    this.registry.registerMapper(this.goodsReceiptToPurchaseInvoice);
    this.registry.registerMapper(this.goodsReceiptToPurchaseReturn);
    this.registry.registerMapper(this.purchaseInvoiceToPurchaseReturn);

    this.approvalPlanRegistry.register(this.goodsReceiptApprovalPlan);
    this.approvalPlanRegistry.register(this.purchaseInvoiceApprovalPlan);
  }
}
