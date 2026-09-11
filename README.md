# ERP

A multi-tenant ERP/accounting platform, built phase by phase from a
1C-inspired architectural spec. This repo currently contains **Phase 0**
(system architecture & foundation core), **Phase 1** (organization &
business structure), **Phase 2** (product/nomenclature master data),
**Phase 3** (counterparty master data + pricing), and **Phase 4** (sales
orders + invoices — the first real business documents) in this repo's own
numbering, plus — named by content rather than phase number, since they
sit outside that numbering — an **Accounting Core** (Azerbaijan Chart of
Accounts + double-entry posting engine, see
[backend/docs/ACCOUNTING_CORE.md](backend/docs/ACCOUNTING_CORE.md)) and a
**Tax Engine** (version-aware, effective-dated VAT rules, see
[backend/docs/TAX_ENGINE.md](backend/docs/TAX_ENGINE.md)). Posting a Sales
Invoice now creates a real, balanced Journal Entry and Tax Register
movement through both — see
[backend/docs/SALES_RECONCILIATION.md](backend/docs/SALES_RECONCILIATION.md).
Each piece has a working backend, frontend (where applicable), and
automated test suite — not scaffolding, a running system.

```
ERP/
├── backend/    NestJS + TypeScript + PostgreSQL (Prisma) API
└── frontend/   React + Vite + TypeScript SPA
```

## Quick start

```bash
# Backend
cd backend
docker compose up -d          # Postgres on localhost:5433
npm install
npx prisma migrate deploy
npm run prisma:seed           # currencies, permission codes, TENANT_ADMIN role
npm run start:dev             # http://localhost:3000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Register a user, create a tenant (you become its Tenant Administrator),
and you're in. Before posting anything with an accounting/tax
consequence (a Sales Invoice, a Manual Operation), adopt the chart and
seed VAT localization once per tenant:
`POST /accounting/chart/adopt` then `POST /tax/localization/seed`.

Tests: `cd backend && npm test && npm run test:e2e` — 180 tests, all
passing (3 unit + 177 e2e against a real Postgres instance).

---

## What we've built

### Phase 0 — System architecture & foundation core

The reusable platform every later business module (invoicing, inventory,
payroll, ...) will sit on top of. No business logic lives here — only the
guarantees an ERP needs underneath one.

- **Multi-tenancy** — every record is scoped to a tenant; cross-tenant
  access (even guessing a valid ID from another tenant) returns an
  identical "not found," never a permission error that would confirm the
  record exists.
- **Auth & RBAC** — JWT access/refresh tokens (argon2id password hashing,
  refresh-token rotation), roles built from granular permission codes
  (`documents.post`, `periods.close`, ...) — never a hardcoded `role ===
  'admin'` check anywhere in the codebase.
- **Document framework** — a generic save → post → unpost → cancel
  lifecycle. Saving a document never implies posting it. A registry
  (`DocumentFrameworkRegistry`) lets a new document type plug in a posting
  handler without editing the posting engine itself.
- **Posting transactions** — atomic and all-or-nothing: validate → lock →
  generate movements → flip status → audit, all in one DB transaction. If
  any step fails, nothing is left half-posted — verified by deliberately
  injecting a mid-transaction failure in the test suite and checking zero
  movements survive.
- **Numbering engine** — generates sequential document numbers
  (`FTD-2026-000001`) using row-level locking, not `SELECT MAX()+1` — 60
  concurrent document creations in the test suite produce 60 unique
  numbers, zero collisions.
- **Accounting periods** — open/close periods; a closed period blocks new
  postings even for a user who otherwise has permission to post.
- **Currency, audit, document relationships, Create Based On, settings,
  idempotency** — supporting infrastructure reused by every phase after
  this one.

Full write-up: [`backend/docs/ARCHITECTURE.md`](backend/docs/ARCHITECTURE.md),
[`DATABASE.md`](backend/docs/DATABASE.md),
[`PERMISSIONS.md`](backend/docs/PERMISSIONS.md),
[`EXTENDING.md`](backend/docs/EXTENDING.md).

### Phase 1 — Organization & business structure

The internal business structure every tenant needs before any real
transaction can reference it.

- **Organization** (legal entity) → **Branch** → **Department**
  (hierarchical, cycle-checked) → **Warehouse** / **Cashbox** / **Bank
  Account** (master data only — no balances or movements yet, those come
  in later phases) → **Accounting Policy** / **Tax Profile**
  (effective-dated configuration, no ledger or VAT calculation yet).
- **Organization-scoped access control** — on top of tenant-level RBAC, a
  tenant membership does *not* automatically see every organization in its
  tenant; access is an explicit grant, checked the same way tenant
  isolation is (missing grant = "not found," not "forbidden").
- **Effective dating** — an Accounting Policy or Tax Profile resolves by
  business date (`resolve(orgId, date)` → the version valid on that date);
  overlapping date ranges are rejected at write time, and a business date
  with no matching version is an explicit error, never a silent guess.
- **Default-reference integrity** — deactivating a warehouse/cashbox/bank
  account automatically clears it as that organization's default rather
  than leaving a dangling pointer; "one default bank account per
  organization" is enforced by a database constraint, not just app code.

Full write-up: [`backend/docs/PHASE1.md`](backend/docs/PHASE1.md).

### Phase 2 — Product/Nomenclature master data

The product catalog foundation every transactional module (Sales, Purchase,
Inventory, Manufacturing) will reference.

- **Unit of Measure** (tenant-level) → measurement units (kg, piece, liter,
  meter) that products reference. Type classification (QUANTITY, WEIGHT,
  VOLUME, LENGTH, AREA, TIME) with validation. No conversion factors yet
  (Phase 3+).
- **Product Category** (organization-scoped) → hierarchical product
  classification with cycle detection (same pattern as Department hierarchy).
  Validated server-side: a category cannot be its own parent, and
  re-parenting into a descendant is rejected.
- **Product** (organization-scoped) → product master data: code, name, type
  (GOODS/SERVICE/WORK/SET), base unit, category, physical properties
  (weight/volume), SKU, barcode. Master data only — no pricing, no inventory
  balances, no supplier/customer links yet (Phase 3+).
- **Validation & uniqueness** — product codes unique per organization,
  SKU/barcode unique per tenant (indexed), units unique per tenant.
  Deactivation guards prevent removing a unit/category still referenced by
  active products.
- **Organization-scoped access** — products and categories follow Phase 1's
  organization access model: `OrganizationAccessService.assertAccess` gates
  every operation.

Full write-up: [`backend/docs/PHASE2.md`](backend/docs/PHASE2.md).

### Phase 3 — Counterparty master data + pricing

Customer/supplier master data with addresses and contacts, plus
effective-dated price lists with quantity breaks and a
`resolvePrice(org, type, product, date, qty, counterparty?)` engine —
the price source every sales/purchase document snapshots at save time.

Full write-up: [`backend/docs/PHASE3.md`](backend/docs/PHASE3.md).

### Phase 4 — Sales orders + invoices

The first real business documents on the document framework. Orders and
invoices snapshot SALE prices + totals at SAVE (posting never
re-resolves), post one register movement per line
(`SALES_ORDER_REGISTER` / `SALES_SETTLEMENT_REGISTER ·
RECEIVABLE_ACCRUAL`), and support SALES_ORDER ⇒ SALES_INVOICE "create
based on" (header-only draft + link, lines added before posting).

Full write-up: [`backend/docs/PHASE4.md`](backend/docs/PHASE4.md).

### Accounting Core — Chart of Accounts + double-entry posting engine

The Azerbaijan standard Chart of Accounts (9 statement sections, ~150
accounts, real subaccount hierarchy) seeded once as a shared template and
adopted per-tenant idempotently. `AccountingPostingEngine` is the single
gateway for balanced double-entry posting: Manual Operations
(draft → post → unpost → reverse), semantic account mappings (never a
literal account number in code), required-dimension enforcement, the
shared Period Guard, and Trial Balance/General Ledger/Account Card
queries reading only from the immutable posted movement register.

Full write-up: [`backend/docs/ACCOUNTING_CORE.md`](backend/docs/ACCOUNTING_CORE.md).

### Tax Engine — version-aware, effective-dated VAT rules

A deterministic `TaxRuleResolver` picks the applicable rule by tax-point
date (never "now", never `created_at`) with explicit ambiguous/missing-
rule errors. Standard-rated, zero-rated, exempt, and out-of-scope
treatments are distinct first-class outcomes, not all collapsed to
`rate = 0`. `TaxRegisterService` writes the Tax Register and hands back
account-resolved GL lines for a caller to post atomically alongside its
own — proven by the Sales Invoice integration below.

Full write-up: [`backend/docs/TAX_ENGINE.md`](backend/docs/TAX_ENGINE.md).

### Sales ⇄ Accounting Core/Tax Engine reconciliation

Posting a Sales Invoice now creates a real, balanced Journal Entry (Dr
Customer Receivable / Cr Sales Revenue / Cr VAT Output Payable, using the
Tax Engine's resolved rate — not the invoice's earlier placeholder
per-line math) and a linked Tax Register movement, atomically with the
existing register movement and posting-status flip. Unposting reverses
the cleanup symmetrically; reposting never leaves an orphaned draft
behind. Sales Orders remain accounting-inert by design (an order is a
commitment, not a revenue event).

Full write-up: [`backend/docs/SALES_RECONCILIATION.md`](backend/docs/SALES_RECONCILIATION.md).

### Sales Pre-Order & Order Management

Customer Request → Commercial Offer → (Sales) Order, with real price
resolution + discount + a Tax *Preview* (the same Tax Engine, but never
writing a Tax Register entry), order confirmation gated by a credit check
and structured holds, stock reservations that are commitments and never
a physical stock movement, shipment planning, and payment schedule
generation with exact-total rounding — none of it touching the GL or Tax
Register, by design. `SalesOrder` plays this spec's "Customer Order"
role rather than a duplicate table.

Full write-up: [`backend/docs/SALES_PREORDER.md`](backend/docs/SALES_PREORDER.md).

### Sales Execution

`Shipment` (physical delivery, kept structurally distinct from
`SalesInvoice`) with a real quantity-only inventory register, reservation
consumption on posting and restoration on unposting, and Order⇒Shipment
defaulting to the remaining fulfillable quantity only. `SalesInvoice`
extended with final tax-point-date calculation, invoiced-quantity caps
against the source order/shipment, a clean `SettlementObligation` AR
contract for a future Phase 13, and an honest COGS integration point that
never fabricates a cost when Costing isn't available. `SalesReturn` with
tax prorated from the original posted `TaxMovement` (never re-resolved
against today's rule) and a contra GL entry.

Full write-up: [`backend/docs/SALES_EXECUTION.md`](backend/docs/SALES_EXECUTION.md).

### Procurement & Purchase Order Management

`PurchaseRequirement` (demand capture, manual or SalesOrder-derived) →
`PurchaseOrder` (supplier commercial commitment — `postingStatus=POSTED`
IS `CONFIRMED`, same pattern as `SalesOrder`). Price snapshot via a
purchase-scoped `PurchasePriceResolver` (never the sales price list) and
a tax *preview* via the same Tax Engine — no `TaxMovement`, no GL, no AP,
no physical stock, ever, on confirmation, structurally guaranteed by
omitting the posting handler's optional `buildAccountingBatch` hook
entirely rather than merely returning null. Supplier selection is a live,
computed candidate comparison (price + tax preview + lead time + MOQ) off
`SupplierProductCode` mappings, not a persisted comparison table.
Multi-supplier partial ordering, requirement-to-order allocation tracked
via `DocumentLineLink`, Expected Supply computed live from confirmed
order lines (respecting split delivery schedules), a planned-only payment
schedule, and demand-supply pegging linking a SalesOrderLine to a
PurchaseOrderLine for traceability (never a physical reservation).

Full write-up: [`backend/docs/PROCUREMENT.md`](backend/docs/PROCUREMENT.md).

### Purchase Execution

`GoodsReceipt` (physical event, real quantity-only inventory RECEIPT
movement + a GRNI clearing GL entry — Model A only) → `PurchaseInvoice`
(commercial/legal/tax event — real input VAT via the Tax Engine, clears
the receipt's GRNI liability rather than double-debiting inventory, and
creates a `SupplierPayable`) → `PurchaseReturn` (prorated historical tax,
contra GL, physical ISSUE, blocked beyond what was actually
received/invoiced) → `AdditionalPurchaseCost` (BY_VALUE/BY_QUANTITY/
BY_WEIGHT/BY_VOLUME/EQUALLY/MANUAL allocation across goods receipt
lines, capitalized to inventory). Every alternative flow the spec calls
out — receipt-first, invoice-first, no Supplier Order at all, multiple
partial receipts — is supported since every cross-document reference is
optional. Three-way matching (Supplier Order vs Receipt vs Invoice)
computed live, snapshotted on demand.

Full write-up: [`backend/docs/PURCHASE_EXECUTION.md`](backend/docs/PURCHASE_EXECUTION.md).

### Frontend

A dark-themed React SPA covering all phases: login/register, tenant
creation and switching, a documents workspace (create/post/unpost/cancel,
audit trail, document links, "create based on"), a sales workspace
(orders + invoices with lines, price snapshots, order ⇒ invoice
drafting), roles & permissions management, accounting periods, and a
full organization management area (tabbed: General, Branches,
Departments-as-tree, Warehouses, Cashboxes, Bank Accounts, Accounting
Policy, Tax Profile, Access).

## Test coverage

| Suite | Count | Covers |
|---|---|---|
| `backend/src/**/*.spec.ts` | 3 | Money/decimal precision (no float drift) |
| `backend/test/phase0.e2e-spec.ts` | 12 | Tenant isolation, RBAC, numbering concurrency, optimistic concurrency, posting atomicity, period locking, Create Based On |
| `backend/test/phase1.e2e-spec.ts` | 19 | Organization/branch/department/warehouse/cashbox/bank-account/policy invariants, organization access isolation, default-reference validation |
| `backend/test/phase2.e2e-spec.ts` | 19 | Unit of measure CRUD, product category hierarchy/cycle detection, product CRUD with SKU/barcode uniqueness, organization access isolation, deactivation guards |
| `backend/test/phase3.e2e-spec.ts` | 15 | Unit conversions, counterparty CRUD/addresses/contacts, price lists/prices, price resolution, isolation |
| `backend/test/phase4.e2e-spec.ts` | 17 | Price snapshotting, explicit-price override, customer-only guard, isolation/concurrency, post/unpost/cancel with movements, closed-period block, invoice flow with real GL/Tax Register posting + unpost/repost, order ⇒ invoice CreateBasedOn |
| `backend/test/accounting-core.e2e-spec.ts` | 18 | Idempotent chart adoption, account hierarchy, non-postable reporting nodes, mapping resolution + override, balance/dimension validation, manual operation lifecycle incl. reversal, closed-period block, Trial Balance/GL/Account Card, tenant isolation |
| `backend/test/tax-engine.e2e-spec.ts` | 18 | Idempotent VAT localization seed, exclusive/inclusive calculation, zero-rated/exempt/out-of-scope distinction, missing/ambiguous rule detection, legal rule versioning + repealed-rule exclusion, recoverability split, atomic Tax+GL posting, duplicate prevention, reversal, shared Period Guard, tax registrations, tenant isolation |
| `backend/test/sales-preorder.e2e-spec.ts` | 17 | Customer Request create/cancel, Commercial Offer price resolution/discount/Tax Preview, offer lifecycle + derived expiry, Request⇒Offer and Offer⇒SalesOrder conversion with price preservation, order confirmation with credit check + hold gating and an explicit no-GL/no-tax-register assertion, reservation create/oversubscription/release, fulfillment computation, shipment plan limits, payment schedule rounding, tenant isolation |
| `backend/test/sales-execution.e2e-spec.ts` | 8 | Order⇒Shipment defaulting to remaining quantity, draft-vs-posted fulfillment counting, partial shipment + over-shipment rejection, insufficient-stock rejection, reservation consumption on post + restoration on unpost, Shipment⇒Invoice with balanced GL + SettlementObligation + invoiceable-quantity cap, physical Sales Return with prorated historical tax + contra GL + inventory receipt + excessive-return rejection + invoice-unpost-blocked-by-return, tenant isolation |
| `backend/test/procurement.e2e-spec.ts` | 10 | Manual Purchase Requirement create/cancel, demand aggregation across requirement lines, supplier-candidate comparison with tax preview, customer-only-counterparty rejection, PO confirmation with zero GL/TaxMovement + Expected Supply computed from confirmed lines + line cancellation, purchase order hold blocking/allowing confirmation, requirement⇒PO multi-supplier partial allocation (OPEN→PARTIALLY_ORDERED→FULLY_ORDERED) with over-allocation rejection, payment schedule rounding, demand-supply pegging with over-peg rejection, tenant isolation |
| `backend/test/purchase-execution.e2e-spec.ts` | 8 | Partial Goods Receipt (twice) with live remaining recomputation + over-receipt rejection + balanced GRNI clearing GL + physical inventory movement, Receipt⇒Invoice clearing GRNI without double-debiting inventory + real input VAT + SupplierPayable, duplicate supplier invoice rejection, invoice-without-receipt direct inventory debit, Purchase Return with prorated tax + contra GL + excessive-return rejection, Additional Purchase Cost BY_VALUE allocation with balanced GL, three-way matching (MATCHED/QUANTITY_MISMATCH) with persisted history, tenant isolation |
| `backend/test/warehouse-inventory.e2e-spec.ts` | 7 | Instant warehouse transfer (source decrease + destination increase in one post), negative-stock-blocked transfer, two-step transfer (ship ⇒ IN_TRANSIT, partial receive, over-receive rejection, unpost blocked after any receive), internal consumption physical decrease, inventory adjustment write-off/surplus, inventory status transfer (quantity unchanged, only status moves), tenant isolation |

All run against a real PostgreSQL instance — no mocked database.

## Status

- **Phase 0** — ✅ done, tested, documented.
- **Phase 1** — ✅ done, tested, documented.
- **Phase 2** — ✅ done, tested, documented.
- **Phase 3** — ✅ done, tested, documented.
- **Phase 4** — ✅ done (backend + tests + docs; run `npx prisma migrate
  deploy` + `npm run prisma:seed` to pick up the sales tables and the 6
  new permission codes), frontend sales workspace included.
- **Accounting Core** — ✅ done, tested, documented. No frontend UI yet
  (API only) — see docs for disclosed deferrals (reposting-as-generation,
  opening-balance endpoint, currency/quantity requiredness).
- **Tax Engine** — ✅ done, tested, documented. VAT implemented deeply;
  other tax types (corporate income, withholding, ...) exist as concepts
  only, per the spec's own scoping. No frontend UI yet.
- **Sales ⇄ Accounting/Tax reconciliation** — ✅ done for Sales Invoice
  (real GL + Tax Register posting, atomically). Sales Order intentionally
  untouched (no revenue event at order stage). COGS/Inventory posting
  deferred — needs an inventory costing engine that doesn't exist yet.
- **Sales Pre-Order & Order Management** — ✅ done, tested, documented.
  No Partner/Contract/Agreement entities (reuses Counterparty directly —
  see docs); no frontend UI yet.
- **Sales Execution** — ✅ done, tested, documented. Shipment posts real
  inventory quantity movements (no valuation); COGS is never fabricated
  (Costing doesn't exist yet — every COGS attempt is honestly skipped);
  AR is a clean SettlementObligation contract, not a full register. No
  frontend UI yet.
- **Procurement & Purchase Order Management** — ✅ done, tested,
  documented. No Agreement/Partner entities (reuses Counterparty directly,
  same simplification as Sales); no persisted supplier comparison (live
  query instead); no MOQ/order-multiple enforcement (captured, surfaced,
  not yet validated); no frontend UI yet.
- **Purchase Execution** — ✅ done, tested, documented. Goods Receipt
  Model A only (GRNI clearing — Model B not implemented); no batch/serial
  tracking; no approval workflow; no Payment/Advance engine (Phase 13/14
  boundary — SupplierPayable never shows PARTIALLY_PAID/PAID); no
  frontend UI yet.
- **Warehouse / Stock Engine** — ✅ done, tested, documented. The Stock
  Truth Engine: physical stock always computed live from the immutable
  `InventoryMovement` register (never a mutable field), with Phase 7/9's
  `InventoryLedgerService` retrofitted onto it with zero call-site
  changes and zero test regressions. WarehouseTransfer (instant/two-step/
  internal-location), InternalConsumption, InventoryAdjustment (write-off/
  surplus/opening-balance), InventoryStatusTransfer, plus Stock Balance/
  Stock Card/Batch/Serial/Negative-Stock/Min-Max reporting. No costing
  engine yet, so InternalConsumption/InventoryAdjustment never fabricate
  an accounting entry (Phase 11's job); no batch/serial auto-capture
  wiring into Goods Receipt/Shipment yet; boolean negative-stock policy,
  not the spec's 3-state enum — see docs/WAREHOUSE_INVENTORY.md for the
  full list. No frontend UI yet.
- **Inventory Costing, Payroll, Banking, Fixed Assets, ...** — not
  started. Later phases building on this foundation.
