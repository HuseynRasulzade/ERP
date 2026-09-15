import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { CounterpartyPricingModule } from '../counterparty-pricing/counterparty-pricing.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { TaxEngineModule } from '../tax-engine/tax-engine.module';
import { SalesPreorderModule } from '../sales-preorder/sales-preorder.module';
import { SalesExecutionModule } from '../sales-execution/sales-execution.module';
import { SettlementModule } from '../settlement/settlement.module';
import { SalesOrderService } from './sales-order.service';
import { SalesInvoiceService } from './sales-invoice.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesInvoiceController } from './sales-invoice.controller';
import { SalesOrderRepository } from './sales-order.repository';
import { SalesInvoiceRepository } from './sales-invoice.repository';
import { SalesOrderPostingHandler } from './sales-order.posting-handler';
import { SalesInvoicePostingHandler } from './sales-invoice.posting-handler';
import { SalesOrderToSalesInvoiceMapper } from './sales-order-to-invoice.mapper';

/**
 * Phase 4 — Sales documents (orders + invoices). First real business
 * documents on the DocumentFramework: implements Repository + PostingHandler
 * per type (+ the SALES_ORDER => SALES_INVOICE CreateBasedOn mapper) and
 * registers them on module init, following the FoundationTestDocument
 * template. Services reuse NumberingService, PriceListService.resolvePrice,
 * OrganizationAccessService, and AuditService — nothing duplicated.
 */
@Module({
  imports: [
    DocumentFrameworkModule,
    NumberingModule,
    AuditModule,
    OrgStructureModule,
    CounterpartyPricingModule,
    AccountingCoreModule,
    TaxEngineModule,
    SalesPreorderModule,
    SalesExecutionModule,
    SettlementModule,
  ],
  controllers: [SalesOrderController, SalesInvoiceController],
  providers: [
    SalesOrderService,
    SalesInvoiceService,
    SalesOrderRepository,
    SalesInvoiceRepository,
    SalesOrderPostingHandler,
    SalesInvoicePostingHandler,
    SalesOrderToSalesInvoiceMapper,
  ],
  exports: [SalesOrderService, SalesInvoiceService],
})
export class SalesDocumentsModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly orderRepository: SalesOrderRepository,
    private readonly invoiceRepository: SalesInvoiceRepository,
    private readonly orderHandler: SalesOrderPostingHandler,
    private readonly invoiceHandler: SalesInvoicePostingHandler,
    private readonly orderToInvoiceMapper: SalesOrderToSalesInvoiceMapper,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.orderRepository);
    this.registry.registerRepository(this.invoiceRepository);
    this.registry.registerHandler(this.orderHandler);
    this.registry.registerHandler(this.invoiceHandler);
    this.registry.registerMapper(this.orderToInvoiceMapper);
  }
}
