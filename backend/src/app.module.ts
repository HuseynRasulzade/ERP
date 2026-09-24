import './common/utils/bigint-json';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';

import { PrismaModule } from './prisma/prisma.module';
import { RequestContextModule } from './common/context/request-context.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantContextGuard } from './common/guards/tenant-context.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

import { IdentityModule } from './identity/identity.module';
import { TenantModule } from './tenant/tenant.module';
import { RbacModule } from './rbac/rbac.module';
import { CurrencyModule } from './currency/currency.module';
import { NumberingModule } from './numbering/numbering.module';
import { PeriodModule } from './period/period.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { DocumentFrameworkModule } from './document-framework/document-framework.module';
import { DocumentLinkModule } from './document-link/document-link.module';
import { FoundationTestDocumentModule } from './foundation-test-document/foundation-test-document.module';
import { OrgStructureModule } from './org-structure/org-structure.module';
import { ProductCatalogModule } from './product-catalog/product-catalog.module';
import { CounterpartyPricingModule } from './counterparty-pricing/counterparty-pricing.module';
import { SalesDocumentsModule } from './sales-documents/sales-documents.module';
import { AccountingCoreModule } from './accounting-core/accounting-core.module';
import { TaxEngineModule } from './tax-engine/tax-engine.module';
import { SalesPreorderModule } from './sales-preorder/sales-preorder.module';
import { SalesExecutionModule } from './sales-execution/sales-execution.module';
import { ProcurementModule } from './procurement/procurement.module';
import { PurchaseExecutionModule } from './purchase-execution/purchase-execution.module';
import { TreasuryModule } from './treasury/treasury.module';
import { WarehouseInventoryModule } from './warehouse-inventory/warehouse-inventory.module';
import { InventoryCountModule } from './inventory-count/inventory-count.module';
import { InventoryCostingModule } from './inventory-costing/inventory-costing.module';
import { CounterpartyContractsModule } from './counterparty-contracts/counterparty-contracts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RequestContextModule,
    PrismaModule,

    // Platform foundation modules (Phase 0)
    IdentityModule,
    TenantModule,
    RbacModule,
    CurrencyModule,
    NumberingModule,
    PeriodModule,
    AuditModule,
    SettingsModule,
    IdempotencyModule,
    DocumentFrameworkModule,
    DocumentLinkModule,

    // Phase 1 — Organization & Business Structure
    OrgStructureModule,

    // Phase 2 — Product/Nomenclature master data
    ProductCatalogModule,

    // Phase 3 — Counterparty Master Data + Pricing
    CounterpartyPricingModule,

    // Phase 4 — Sales documents (orders + invoices)
    SalesDocumentsModule,

    // Accounting Core (docx spec Phase 4 — Chart of Accounts + double-entry
    // posting engine). Named by content, not phase number, since this
    // repo's own "Phase 4" already means Sales documents above.
    AccountingCoreModule,

    // Tax Engine (docx spec Phase 5 — VAT rules engine, Azerbaijan
    // localization, Tax Register). Depends on AccountingCoreModule.
    TaxEngineModule,

    // Sales Pre-Order & Order Management (docx spec Phase 6 — Customer
    // Request, Commercial Offer, order confirmation/reservation/shipment
    // planning/payment schedule/credit check; no accounting consequence).
    SalesPreorderModule,

    // Sales Execution (docx spec Phase 7 — Shipment, extended Sales
    // Invoice with real AR/COGS interfaces, Sales Return).
    SalesExecutionModule,

    // Procurement & Purchase Order Management (docx spec Phase 8 —
    // Purchase Requirement, supplier selection, Purchase Order commercial
    // commitment, expected supply, payment schedule, demand-supply
    // pegging; no GL/AP/inventory/Tax Register consequence).
    ProcurementModule,

    // Purchase Execution (docx spec Phase 9 — Goods Receipt, Purchase
    // Invoice with real input VAT + Accounts Payable, Purchase Return,
    // Additional Purchase Cost allocation, three-way matching, reporting).
    PurchaseExecutionModule,
    TreasuryModule,

    // Warehouse / Stock Engine (docx spec Phase 10 — the Stock Truth
    // Engine every other module reads from, plus WarehouseTransfer,
    // InternalConsumption, InventoryAdjustment, InventoryStatusTransfer).
    WarehouseInventoryModule,

    // Phase 12 — Inventory Count / İnventarizasiya (stocktaking +
    // reconciliation engine on top of the Phase 10 movement register).
    InventoryCountModule,
    // Inventory Costing Engine (docx spec Phase 11 — cost register, FIFO
    // layers / weighted average, COGS, backdated recalculation, period
    // finalization). Also imported by the modules whose posting handlers
    // call it.
    InventoryCostingModule,

    // "Kontragentlər" — counterparty contracts, amendments, and document
    // attachments (extends Phase 3's CounterpartyPricingModule).
    CounterpartyContractsModule,

    // Demo/reference document proving the framework end to end
    FoundationTestDocumentModule,
  ],
  controllers: [AppController],
  providers: [
    // Guard order matters: authenticate -> resolve tenant context -> check
    // permissions. Nest runs APP_GUARD providers in registration order.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
