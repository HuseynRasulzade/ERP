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
import { WarehouseInventoryModule } from './warehouse-inventory/warehouse-inventory.module';
import { InventoryCostingModule } from './inventory-costing/inventory-costing.module';
import { InventoryCountModule } from './inventory-count/inventory-count.module';
import { SettlementModule } from './settlement/settlement.module';
import { TreasuryModule } from './treasury/treasury.module';
import { CashModule } from './cash/cash.module';
import { FixedAssetModule } from './fixed-assets/fixed-asset.module';
import { HRModule } from './hr/hr.module';
import { WorkTimeModule } from './work-time/work-time.module';
import { PayrollModule } from './payroll/payroll.module';
import { ExpenseModule } from './expenses/expense.module';
import { ManufacturingModule } from './manufacturing/manufacturing.module';
import { PeriodCloseModule } from './period-close/period-close.module';
import { FinancialReportingModule } from './financial-reporting/financial-reporting.module';
import { ManagementReportingModule } from './management-reporting/management-reporting.module';
import { AuditTrailModule } from './audit-trail/audit-trail.module';
import { WorkflowModule } from './workflow/workflow.module';
import { DocumentChainModule } from './document-chain/document-chain.module';
import { IntegrationModule } from './integration/integration.module';
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

    // Warehouse / Stock Engine (docx spec Phase 10 — the Stock Truth
    // Engine every other module reads from, plus WarehouseTransfer,
    // InternalConsumption, InventoryAdjustment, InventoryStatusTransfer).
    WarehouseInventoryModule,

    // Inventory Costing Engine (docx spec Phase 11 — FIFO/Weighted Average
    // subledger: cost layers, COGS, additional-cost capitalization,
    // backdated recalculation, period finalization, valuation/COGS/health
    // reporting). Depends on WarehouseInventoryModule indirectly through
    // the posting handlers it wires into, not through its own imports.
    InventoryCostingModule,

    // Inventory Count / Stocktaking Engine (docx spec Phase 12 — full
    // reconciliation engine: plan/scope, authoritative snapshot, freeze,
    // count sheets/entries, blind count, recount, variance calculation,
    // approval, and posting through Phase 10's InventoryAdjustment with
    // real Phase 11 costing).
    InventoryCountModule,

    // AR/AP Counterparty Settlement Engine (docx spec Phase 13 — open
    // items, payment allocation, advances, offsets, debt adjustments,
    // realized FX, ageing, reconciliation, credit exposure).
    SettlementModule,

    // Treasury / Bank Engine (docx spec Phase 14 — Payment Request/
    // Approval/Calendar/Liquidity planning layer, bank payments/statement
    // import/matching/reconciliation layer, reusing Phase 13's own
    // settlement allocation for the third layer).
    TreasuryModule,
    CashModule,
    FixedAssetModule,
    HRModule,
    WorkTimeModule,
    PayrollModule,
    ExpenseModule,
    ManufacturingModule,

    // Financial Period Close Orchestrator (docx spec Phase 22 — Month
    // Close: readiness, dependency-graph orchestration across every
    // subledger's own close operation, reconciliation, FX/accrual/tax
    // close layers, financial result, closing entries, period lock,
    // and dependency-aware reopen/reclose).
    PeriodCloseModule,

    // Financial Reporting Semantic Layer / Report Mapping Engine /
    // Financial Statement Engine (docx spec Phase 23 — Trial Balance,
    // Balance Sheet, P&L, Cash Flow, Changes in Equity, all deterministic
    // GL-mapping transformations, close-version-aware and versioned).
    FinancialReportingModule,

    // Management Reporting / KPI Engine / Profitability Engine /
    // Budget-Forecast-Scenario / Dashboard Platform (docx spec Phase 24 —
    // governed semantic layer over canonical operational facts; never a
    // duplicated management-only truth table).
    ManagementReportingModule,

    // Audit / Change History / Traceability / Evidence Platform (docx
    // spec Phase 25 — immutable, hash-chained audit trail, before/after
    // diffs, document lifecycle/posting lineage, investigations, legal
    // hold, integrity verification, and evidence export).
    AuditTrailModule,

    // Workflow / Approval / Execution-Gate Engine (docx spec Phase 26 —
    // effective-dated workflow versions, dynamic approver resolution,
    // delegation, four-eyes/SoD, material-change reapproval, and the
    // execution gate business modules call before a critical action).
    WorkflowModule,
    DocumentChainModule,
    IntegrationModule,

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
