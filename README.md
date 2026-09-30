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

### Inventory Costing Engine

FIFO and Weighted-Average (moving or periodic) valuation over the
Warehouse/Stock Engine's own `InventoryMovement` register, adopted per
organization via an effective-dated `InventoryCostingPolicy` (the same
"opt in once" convention as Accounting Core's chart-adopt and the Tax
Engine's localization-seed — every method is a complete no-op, writing
nothing, when no policy is configured, which keeps every earlier phase's
own e2e suite unaffected by this module's existence). FIFO opens an
immutable `InventoryCostLayer` per receipt and drains strictly oldest-first
by `(receiptDate, postingSequence)`; Weighted Average holds no mutable
"current cost" field anywhere — the signed `InventoryCostMovement` register
aggregate IS the average, rebuildable by construction. `GoodsReceipt`,
`Shipment` (cost computed at the physical stock-out, GL deferred to Sales
Invoice time where `Dr COGS / Cr Inventory` reads back the exact per-line
cost — never re-derived, never a blended guess across same-day shipments
at different costs), Sales Return, Internal Consumption, Inventory
Adjustment (write-off/surplus), and Warehouse Transfer are all wired in.
A manual `InventoryCostAdjustment` (e.g. a late supplier invoice changing
landed cost) splits proportionally between still-on-hand quantity (raises
the layer's value) and already-consumed quantity (a retroactive COGS
correction) — never dumped entirely onto current stock. A backdated
movement queues a full recalculation of its costing key, replayed in
correct chronological order, raising a DRAFT adjustment for every
consumption whose cost changes rather than silently rewriting history.
Costing Periods gate further cost-affecting postings once finalized.
Purchase Return-to-supplier is now wired in too, targeting the exact
source FIFO layer when traceable (directly or through the invoice's own
receipt-line link) rather than blind FIFO order — the GL entry's own
inventory-credit amount still uses the return's recorded price rather than
the live cost, a smaller disclosed gap. A movement dated before an
organization's first-ever costing policy adopts a backdated `effectiveFrom`
can now be backfilled (replaying `receiveCost`/`consumeCost` in
chronological order, subledger-only — it never posts a GL entry into an
already-closed historical period), scoped to single-document receipts/
consumptions; Warehouse Transfer and Adjustment SURPLUS are not
backfillable — see docs/INVENTORY_COSTING.md.

Full write-up: [`backend/docs/INVENTORY_COSTING.md`](backend/docs/INVENTORY_COSTING.md).

### Inventory Count / Reconciliation Engine

Full physical-inventory reconciliation on top of the Warehouse/Stock
Engine (`InventoryMovement` register) and the Inventory Costing Engine
(FIFO/weighted-average valuation): `InventoryCountPlan` (scope, freeze
policy, recount/tolerance rules) → `InventoryCountSession` (an
authoritative, immutable snapshot of the books at a cutoff) →
`InventoryCountSheet`/`InventoryCountEntry` (blind or non-blind physical
capture, barcode/unit-conversion aware, batch- and serial-level) →
`InventoryVariance` (never a per-product net — a batch or location split
that cancels out at the product level still surfaces as its own rows) →
`InventoryRecount` (never overwrites the original count) →
`InventoryVarianceDecision` (decide, then approve) → a real
`InventoryAdjustment`/`WarehouseTransfer`/`InventoryStatusTransfer`
posting (reusing the existing document types, never a duplicate
mechanism) → `InventoryCountReconciliation` (quantity/value/GL
traceability) → close. `HARD_FREEZE` physically blocks postings into a
warehouse under count; `NO_FREEZE_WITH_MOVEMENT_TRACKING` (the default)
instead arithmetically accounts for whatever moved between the snapshot
and the count.

Full write-up: [`backend/docs/INVENTORY_COUNT.md`](backend/docs/INVENTORY_COUNT.md).

### Counterparty Settlement Engine

A real subledger for what Sales/Purchase Invoice, Sales/Purchase Return,
Cash Transaction, and Payment Order all touch today only through mutable
`SettlementObligation`/`SupplierPayable` fields. `SettlementMovement` is
the append-only source of truth (never updated, only inserted);
`SettlementOpenItem` is a rebuildable balance projection over it, one row
per source document (or per payment-schedule installment when the order
behind the invoice has one), concurrency-safe via an advisory lock
acquired *before* its remaining balance is read. `PaymentAllocationService`
settles a payment against one or many open items (manual, FIFO-auto, or
consuming an existing advance), computing realized FX from the open
item's own historical unit base rate — never the payment's current rate —
so a payment in a different rate environment than its invoice still nets
to the right base-currency gain/loss. Also: AR/AP offset (nets a
counterparty's own receivable against its own payable), debt
write-off/increase/reclassification (creator can never approve their own
adjustment), due-date ageing (never document-date, always the remaining
balance, advances excluded), a callable credit-exposure interface, and a
live settlement health check. Built additively — every existing consumer
of the legacy fields keeps working unchanged.

Full write-up: [`backend/docs/SETTLEMENT.md`](backend/docs/SETTLEMENT.md).

### Treasury / Bank Operations

A full Treasury Planning + Bank Operations engine on three loosely-coupled
layers (spec: never merge planning, bank reality, and settlement
allocation into one document) — Treasury Plan (`PaymentRequest`, now with
its own configurable amount-tier approval ladder, partial approval, and
partial multi-order execution up to the approved cap; `PaymentCalendarService`;
`LiquidityForecastService` with cash-gap detection against a configurable
minimum buffer), Bank Reality (the existing `PaymentOrder` outflow
document, plus new `IncomingBankPayment`/`InternalBankTransfer`/`BankFee`/
`FXConversion` documents, and multi-document-type bank statement
matching), and Settlement Allocation (Phase 13's own engine, only called
into, never duplicated). `FXConversion` books its own gain/loss against an
optional official rate, deliberately kept separate from Phase 13's
realized settlement FX. A formal `BankReconciliation` period-close sits on
top of the existing line-level statement matching, gated on every line
being matched and the book-vs-bank difference falling within tolerance.
Along the way, found and fixed two genuine latent bugs: an advisory lock
that was being released before it could do its job (a statement line
could be double-matched), and a Settlement-engine FIFO allocation query
with no deterministic sort order at all.

Full write-up: [`backend/docs/TREASURY.md`](backend/docs/TREASURY.md).

### Cash Desk Engine

Extends Phase 14's existing `Cashbox`/`CashTransaction` foundation rather
than duplicating it with new document types — the same `CashTransaction`
now carries the full spec category catalog (18 categories), an optional
`cashierId` (checked against `CashierAssignment` at posting, opt-in) and
`employeeId` (for `EMPLOYEE_ADVANCE`/`EMPLOYEE_ADVANCE_RETURN`). Book
balance is always computed live from the immutable
`CASH_MOVEMENT_REGISTER` register (never a mutable field, the same Stock
Truth Engine principle reused for bank balances in Phase 14), with a
concurrency-safe negative-balance block (`NEVER`/`ALLOWED` per cash desk,
advisory-locked before the balance is read). `CashDeskTransfer` mirrors
WarehouseTransfer's own INSTANT/TWO_STEP pattern for cash-to-cash moves,
including partial multi-step receives each posting under their own
suffixed `sourceDocumentId` to avoid the posting engine's per-document
duplicate-entry guard. `CashPhysicalCount` → `CashCountAdjustment` is the
only path a denomination-count difference ever reaches the book/GL
(surplus/shortage/charged-to-cashier), feeding into a
`CashDeskDailyClose`/`CashierHandover` gate that mirrors Phase 14's own
bank-reconciliation-period close. A live health check (book-vs-GL per
cash desk, stale unresolved differences, stuck transfers) and a
Cash Book/Balance/Turnover/Difference/Transfer reporting set round it
out. Along the way, found and fixed a real gap in
`ChartOfAccountsService`: adding a new account/dimension/mapping to an
already-adopted chart used to be silently invisible to every existing
tenant — now backfilled idempotently instead of short-circuiting.

Full write-up: [`backend/docs/CASH_DESK.md`](backend/docs/CASH_DESK.md).

### Fixed Asset Subledger

Acquisition Candidate → CIP (Capital Investment in Progress) → Fixed
Asset Card → Acceptance/Commissioning → Depreciation →
Transfer/Modernization/Impairment → Disposal, all traceable back to
source documents. Never auto-creates an asset from a Purchase Invoice
line (spec's own hard rule) — an acquisition candidate is only ever
turned into a CIP cost or a capitalized asset through an explicit human
classification. Gross cost/accumulated depreciation/accumulated
impairment are computed live from an immutable
`FIXED_ASSET_MOVEMENT_REGISTER` register (the fourth reuse of the Truth
Engine principle after Stock/Cash/Bank) — `FixedAsset` carries no
mutable balance columns at all. CIP capitalization is concurrency-safe
(advisory lock before the remaining balance is read — caught and fixed
by this phase's own tests before shipping, the same lock-lifecycle
lesson this codebase already learned twice before). Straight-line
depreciation recomputes its rate fresh every period from the asset's
live NBV, which is what makes useful-life-change and post-impairment
recalculation fall out of the same formula rather than needing
special-case code, with idempotent per-period posting. Modernization/
Impairment/Disposal are full document-framework participants (post/
unpost, period locking, audit); physical inventory mirrors Phase 15's
own count-session pattern, auto-correcting a wrong-location result via a
transfer (never a write-off) while leaving missing/unregistered assets
unresolved for a human to investigate. Along the way, found and fixed a
real bug in the disposal posting handler: re-reading live balances
*after* its own cost-removal movement had already been written to the
register in the same transaction meant it saw the post-decrease value
and skipped the GL credit almost entirely — fixed by excluding a
document's own not-yet-finalized movements from that read.

Full write-up: [`backend/docs/FIXED_ASSETS.md`](backend/docs/FIXED_ASSETS.md).

### HR Core / Employment Lifecycle Engine

Physical Person → Employee → Hire Document → Employment, with two
effective-dated history tables (`EmployeeAssignment` for department/
position/manager/FTE/location, `EmploymentStatusHistory` for status) as
the authoritative source of "what was true as of date X" — `Employment`'s
own current-state fields are only a best-effort projection, refreshed on
write actions and by an on-demand `syncStatus()` for a future-dated hire/
transfer whose effective date has since arrived (no scheduled job flips
it automatically — disclosed simplification). Rehire reuses the same
Employee row via `rehireOfEmployeeId` rather than creating a duplicate.
An employee can hold more than one concurrent employment (primary +
secondary); terminating a secondary employment only rolls the Employee's
own status to TERMINATED once every one of their employments is closed.
`EmployeeTransfer` walks the new manager's own reporting chain before
accepting a `newManagerEmploymentId`, rejecting anything that would
create a circular hierarchy. Staffing-position headcount/FTE capacity is
enforced on both hire and transfer, overridable only with an explicit
flag plus the `HR_OVERRIDE_STAFFING_LIMIT` permission. No GL posting —
HR Core sits entirely outside the document-framework/accounting engine
(Phase 19's Payroll module is where HR data meets the ledger).
`HireDocument`/`EmployeeTransfer`/`TerminationDocument` each plug into
the shared Approval Framework via their own `ApprovalPlanProvider` — a
single `DEPARTMENT_HEAD` step, planned only when a head is actually
resolvable for the document's department (an org with no appointed
department heads sees every hire/transfer/termination stay
`NOT_REQUIRED`, exactly as before this workflow existed). A monthly
`LeaveAccrualRunService` job (idempotent per organization+period) credits
`annualEntitlementDays / 12` onto an append-only `LeaveBalanceMovement`
ledger (same Truth-Engine convention as InventoryCostMovement/
RegisterMovement elsewhere) once an org configures a `LeavePolicy`;
`LeaveRecordService` then gates a new ANNUAL request against the running
balance at create time and consumes it at approve time — an org with no
policy configured sees ANNUAL leave stay unlimited, exactly as before
this engine existed.

Full write-up: [`backend/docs/HR_CORE.md`](backend/docs/HR_CORE.md).

### Work Time / Timesheet Engine

Three strictly separate layers: Planned Work Time (Production Calendar +
Work Schedule Template/Pattern → an effective-dated `EmployeeDailyWorkPlan`
derived fresh from Phase 17's own as-of-date employment state — hire/
termination/mid-period-transfer dates fall out of that lookup with no
special-case code), Actual Work Time (raw, immutable `AttendanceEvent` →
interpreted `AttendanceInterval` → normalized `TimeEntry`), and Payroll
Work-Time Input (`Timesheet`/`TimesheetLine` → `WorkTimeRegister`, the
fifth reuse of the RegisterMovement Truth Engine after Stock/Cash/Bank/
Fixed Assets, written once on timesheet lock → `PayrollTimeInput`, the
only thing Phase 19 is allowed to read). The critical rule: REGULAR_WORK/
OVERTIME are the only two buckets that sum into "total worked hours" —
NIGHT/HOLIDAY/WEEKEND are independent premium overlays computed from the
same source hours and never double-counted into that total, verified by
an e2e case with an 8-hour night shift crossing midnight (6 night-premium
hours, total worked stays 8, not 14). A plan-vs-actual difference is never
silently absorbed as overtime or dropped — an unapproved excess is
excluded from every hours bucket and flags the line as an `EXCEPTION`,
which blocks timesheet approval until resolved. Corrections never
overwrite: applying one against an already-`LOCKED` timesheet still
creates a new `TimeEntry` version but flags `requiresRecalculation`
instead of silently changing locked data. No biometric/device
integration (manual/API attendance entry only), no AI anomaly detection,
no per-tenant-configurable TimeCode catalog, and only the
`PREAPPROVAL_REQUIRED` overtime policy — see docs/WORK_TIME.md for the
full list of disclosed simplifications.

Full write-up: [`backend/docs/WORK_TIME.md`](backend/docs/WORK_TIME.md).

### Payroll / Gross-to-Net Engine

Effective-dated `EmployeeCompensationAssignment` (a mid-month raise splits the
period into segments, never overwrites the prior row) → the only door into
Phase 18's hours (`PayrollTimeInputService`, APPROVED/LOCKED rows only) →
base-salary proration + overtime/night/holiday premiums (holiday/weekend
hours excluded from the proration ratio and paid entirely through their own
premium line, so they're never double-paid) → Gross-to-Net (separate
taxable/social/unemployment/medical bases, progressive tax and contribution
brackets resolved by `asOfDate` from seeded, effective-dated legal-rule data
— never a hardcoded rate — execution orders/alimony with legal caps and
carry-forward, employer contributions kept fully separate from employee
deductions) → a versioned `PayrollCalculationResult`/`PayrollResultLine`
trace. A regular calculation run is idempotent (retry never duplicates); a
retroactive correction always creates a new version and marks the old one
`SUPERSEDED` (`supersededById` points forward) — history is never
overwritten. `PayrollPosting` is a full document-framework participant: one
balanced GL entry per period (Dr Salary Expense + Employer Contribution
Expense / Cr Salary Payable + statutory payables, dimensioned by department)
plus `PAYROLL_LIABILITY_REGISTER` movements — the sixth Truth Engine reuse
after Stock/Cash/Bank/FixedAsset/WorkTime — and unposting after a payment has
already been recorded is refused outright. `PayrollPaymentBatch`/
`PayrollPaymentAllocation` are the stable contract Phase 14 (bank)/Phase 15
(cash) are expected to consume once built. AZ 2026 bracket figures are
explicitly illustrative, not verified official rates; overtime/night/holiday
use only the statutory-minimum multiplier; a payment batch confirms
immediately rather than a separate draft/confirm step — see
docs/PAYROLL.md.

Full write-up: [`backend/docs/PAYROLL.md`](backend/docs/PAYROLL.md).

### Expenses / Cost Centers / Employee Expenses

`CostCenter` (deliberately distinct from Phase 17's `Department` — Shared
Services can be its own cost center with no department behind it) feeds an
`ExpenseClaim`/`ExpenseClaimLine`/`ExpenseReceipt` lifecycle gated by
effective-dated `ExpensePolicy` limits, duplicate-receipt detection, and a
business-purpose-required check enforced BEFORE submission is even
allowed. Approval reuses the Tax Engine for a gross-input VAT split (`Dr
Expense = net amount`, VAT posted on its own recoverable/nonrecoverable
line — the same convention Purchase Invoices already use, never folded
into the expense account) and Phase 15's `AccountablePerson` advance ledger
for settlement, bridged through a caller-supplied `responsiblePersonId`
field since Phase 15's ledger keys off Phase 0's `ResponsiblePerson`, not
Phase 17's `Employment` — a genuine pre-existing identity gap this phase
resolves pragmatically rather than by unifying the two schema-wide. An
Expense Classification Engine sorts each line into CURRENT_EXPENSE/
PREPAID_EXPENSE/FIXED_ASSET/INVENTORY_COST/SUPPLIER_SETTLEMENT — the last
excluded from GL and the register outright, so a cost a Supplier Invoice
already recognized is never double-counted. `ExpenseClaimPostingHandler`
is a full document-framework participant writing a balanced GL entry plus
`EXPENSE_MOVEMENT_REGISTER` movements (the seventh Truth Engine reuse) and,
when approved expenses exceed any advance, an
`EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER` movement (a new register, the
"company owes employee" direction). A Prepaid Expense subledger recognizes
straight-line on an idempotent monthly run (retrying a period recognizes
nothing further); Cost Allocation (drivers backed by real Phase 17
headcount/FTE and Phase 18 worked-hours data, DIRECT or DRIVER_BASED rules
with self-loop + direct-reciprocal cycle detection) reclassifies shared
cost between cost centers with the last target absorbing any rounding
residual so the total always reconciles exactly, and never changes total
company expense — the same invariant an `ExpenseAdjustment`
cost-center reclassification (the only sanctioned way to move a posted
line's cost center after the fact) also preserves. Budget-vs-actual always
reads `actual` from the posted register, never from claim totals.
`ExpensePeriod.close()` gates on no unresolved/unposted claim, no
un-recognized prepaid schedule row, and — only when the period actually
has unallocated cost-allocation source amount, never a blanket "any active
rule exists anywhere" check — a posted `CostAllocationRun`. Disclosed
simplifications: cost-allocation cycle detection is self-loop + direct
two-rule reciprocal only, not full topological cycle detection; the
reclassification GL entry assumes a single account for the whole allocated
pool; budget commitment is a manually-entered field, not a live
commitment engine; INVENTORY_COST/FIXED_ASSET classifications are flagged
but not auto-wired into a Phase 9/11 receipt or a Phase 16 acquisition
candidate — see docs/EXPENSES.md.

Full write-up: [`backend/docs/EXPENSES.md`](backend/docs/EXPENSES.md).

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
| `backend/test/tax-engine.e2e-spec.ts` | 21 | Idempotent VAT localization seed, exclusive/inclusive calculation, zero-rated/exempt/out-of-scope distinction, missing/ambiguous rule detection, legal rule versioning + repealed-rule exclusion, recoverability split, a custom TaxRule's full DRAFT⇒REVIEWED⇒APPROVED⇒ACTIVE⇒REPEALED admin workflow (invisible to the resolver until activated, uneditable once ACTIVE, excluded from resolution once repealed) + tenant isolation on that workflow, atomic Tax+GL posting, duplicate prevention, reversal, shared Period Guard, tax registrations, tenant isolation |
| `backend/test/sales-preorder.e2e-spec.ts` | 17 | Customer Request create/cancel, Commercial Offer price resolution/discount/Tax Preview, offer lifecycle + derived expiry, Request⇒Offer and Offer⇒SalesOrder conversion with price preservation, order confirmation with credit check + hold gating and an explicit no-GL/no-tax-register assertion, reservation create/oversubscription/release, fulfillment computation, shipment plan limits, payment schedule rounding, tenant isolation |
| `backend/test/sales-execution.e2e-spec.ts` | 8 | Order⇒Shipment defaulting to remaining quantity, draft-vs-posted fulfillment counting, partial shipment + over-shipment rejection, insufficient-stock rejection, reservation consumption on post + restoration on unpost, Shipment⇒Invoice with balanced GL + SettlementObligation + invoiceable-quantity cap, physical Sales Return with prorated historical tax + contra GL + inventory receipt + excessive-return rejection + invoice-unpost-blocked-by-return, tenant isolation |
| `backend/test/procurement.e2e-spec.ts` | 10 | Manual Purchase Requirement create/cancel, demand aggregation across requirement lines, supplier-candidate comparison with tax preview, customer-only-counterparty rejection, PO confirmation with zero GL/TaxMovement + Expected Supply computed from confirmed lines + line cancellation, purchase order hold blocking/allowing confirmation, requirement⇒PO multi-supplier partial allocation (OPEN→PARTIALLY_ORDERED→FULLY_ORDERED) with over-allocation rejection, payment schedule rounding, demand-supply pegging with over-peg rejection, tenant isolation |
| `backend/test/purchase-execution.e2e-spec.ts` | 14 | Partial Goods Receipt (twice) with live remaining recomputation + over-receipt rejection + balanced GRNI clearing GL + physical inventory movement, Receipt⇒Invoice clearing GRNI without double-debiting inventory + real input VAT + SupplierPayable, duplicate supplier invoice rejection, invoice-without-receipt direct inventory debit, Purchase Return with prorated tax + contra GL + excessive-return rejection, Purchase Return costing-engine integration (targets the exact source FIFO layer directly or via the invoice's own receipt-line link, never blind FIFO order, fully reversed on unpost), Additional Purchase Cost BY_VALUE allocation with balanced GL, three-way matching (MATCHED/QUANTITY_MISMATCH) with persisted history, Goods Receipt approval-gating on PO approval + over-delivery approval, price/tax visibility gating, invoice price-variance approval, tenant isolation |
| `backend/test/warehouse-inventory.e2e-spec.ts` | 7 | Instant warehouse transfer (source decrease + destination increase in one post), negative-stock-blocked transfer, two-step transfer (ship ⇒ IN_TRANSIT, partial receive, over-receive rejection, unpost blocked after any receive), internal consumption physical decrease, inventory adjustment write-off/surplus, inventory status transfer (quantity unchanged, only status moves), tenant isolation |
| `backend/test/inventory-costing.e2e-spec.ts` | 12 | The no-policy no-op and its health-check signal, a FIFO policy opening layers on receipt and consuming strictly oldest-first across two differently-priced layers with exact math (re-verified at real COGS-GL-posting time via a Sales Invoice reading back the exact per-line cost), FIFO layer reopening on unpost, a MOVING_AVERAGE policy receiving/consuming at the exact running average with no per-receipt layers, Internal Consumption and Inventory Adjustment (WRITE_OFF/SURPLUS) balanced GL posting at the real cost, a manual cost adjustment's on-hand/COGS split by remaining-vs-consumed layer quantity with a balanced GL entry, backdated-movement recalculation queueing and correct-order layer rebuilding, costing-period finalize blocking a cost-affecting posting and reopen un-blocking it, the negative-stock policy never blocking the physical posting, backfilling a pre-policy receipt+shipment once the policy's effectiveFrom is backdated (health check drops to zero, re-running with nothing left is refused, no GL entry is posted), and the COGS/health report endpoints |
| `backend/test/inventory-count.e2e-spec.ts` | 13 | Zero-variance count with no adjustment, shortage/surplus full lifecycle (variance ⇒ decide ⇒ approve ⇒ post ⇒ reconcile), blind count, post-snapshot movement reconciliation under NO_FREEZE, location and batch mismatch surfaced even at a net-zero product total, serial mismatch at matching quantity, recount (original preserved, final approved count wins), HARD_FREEZE blocking an unrelated posting, uncounted vs. explicit zero, idempotent adjustment posting, stale-reconciliation block under a concurrent movement, tenant isolation |
| `backend/test/settlement.e2e-spec.ts` | 17 | Basic receivable + full payment, partial payment, multiple payments accumulating to zero, one payment auto-allocated FIFO across multiple invoices, customer/supplier advances incl. partial application, overpayment becoming a customer advance, sales return after full payment producing a credit position, AR/AP offset, write-off with segregation of duties (self-approval rejected), due-date ageing on the remaining balance only, realized FX on full and partial foreign-currency payments, concurrent over-allocation safety, invoice-unpost blocked by an active allocation, counterparty reconciliation statement, tenant isolation |
| `backend/test/treasury.e2e-spec.ts` | 5 | Purchase Invoice ⇒ Payment Request ⇒ Payment Order requiring FINANCE approval, segregation of duties (approver ≠ executor), counterparty-bank-account-change re-check at posting, reconciliation against a bank statement amount, accounting-entries viewer |
| `backend/test/treasury-bank-operations.e2e-spec.ts` | 16 | Incoming bank payment posting (named invoice + unnamed advance), internal transfer with a separately-booked fee + same-account rejection, bank fee posting, FX conversion (gain vs. an official rate, currency-mismatch rejection, never a settlement), multi-document-type statement matching (inflow/outflow/unmatched-line classification/concurrent-match safety), bank reconciliation period close + mandatory-reason reopen, payment-request amount-tier approval with partial approval and partial multi-order execution + its own concurrency test, payment calendar + liquidity forecast + cash-gap detection, treasury health, payment-order reversal |
| `backend/test/cash-desk.e2e-spec.ts` | 15 | Cash receipt/expense posting, negative-balance block + its own concurrency safety, an ALLOWED-policy desk going negative, cashier-assignment enforcement, employee advance + return (and its own validation), cash-to-cash transfer INSTANT and TWO_STEP with partial receives (unpost blocked once received, over-receive rejected, same-desk rejection), physical count ⇒ adjustment resolution chain (shortage, CASHIER_RECEIVABLE, difference report), daily close (gated on an unresolved count, closed, reopened), cashier handover (blocked then completed), cash health (no false-positive book-vs-GL mismatch) |
| `backend/test/fixed-assets.e2e-spec.ts` | 17 | Acquisition-candidate classification (CAPITALIZE creates an asset, EXPENSE never does), CIP cost formation across multiple sources with an expensed exclusion + capitalization into one asset, over-capitalization rejection, CIP capitalization concurrency safety, acceptance-without-commissioning staying depreciation-free, straight-line depreciation (zero residual, non-zero residual, idempotency), modernization increasing gross cost, impairment reducing NBV to the recoverable amount, transfer leaving cost/NBV unchanged, disposal (SALE with gain/loss + receivable, WRITE_OFF with a full loss and no further depreciation), physical inventory (wrong-location auto-correction, missing-asset staying unresolved), GL reconciliation reporting every account healthy after a full mixed flow |
| `backend/test/hr-core.e2e-spec.ts` | 17 | Physical-person duplicate-personalId detection (blocked, then confirmed), hire lifecycle via the new-person path (draft ⇒ post), as-of-date employment state resolution before and after the hire date, employment contract create + amend with versioned history, manager hierarchy transfer + circular-hierarchy rejection, EmployeeAssignment history split at a transfer's effective date (state correct on both sides of the date), staffing-position capacity enforcement + override with permission, termination with correct Employee-status rollup, rehire reusing the same Employee row, multiple concurrent employments (secondary termination leaving primary + Employee active), org-chart/headcount/staffing-capacity/health reports, approval workflow (hire PENDING blocks posting until DEPARTMENT_HEAD approves, hire reject permanently blocks posting, transfer and termination each gated the same way once their department has an appointed head), leave accrual engine (unlimited ANNUAL leave with no policy configured, idempotent monthly accrual + re-run rejection, balance-gated create, approve-time consumption, the movement ledger) |
| `backend/test/work-time.e2e-spec.ts` | 14 | Attendance idempotency on re-import, missing-clock-out and duplicate-punch detection, a production calendar with a holiday and a shortened day, a standard 5-day schedule template, the full spec section-172 end-to-end month (hire, schedule assignment, mid-month department transfer, annual leave, approved overtime, daily plan generation reflecting calendar + transfer, regular attendance with break deduction, partial absence, a night shift crossing midnight with correct 6h night premium and no worked-hours inflation, holiday work, timesheet generate ⇒ submit ⇒ approve ⇒ lock, Work Time Register + Payroll Time Input Register generation with no money fields), a locked-timesheet direct-edit block requiring a Time Correction (which correctly flags `requiresRecalculation`), an unapproved-overtime exception that blocks timesheet approval until resolved, and the plan-vs-actual/overtime/night/holiday-weekend reports |
| `backend/test/payroll.e2e-spec.ts` | 3 | Full base-salary proration with progressive AZ income tax/social/unemployment/medical contributions against a real Work Time Register month, a backdated salary raise recalculated into a new version with the original preserved as SUPERSEDED, and the full GL-posting pipeline (approve ⇒ draft PayrollPosting ⇒ post through the generic document-framework command ⇒ balanced journal entry assertion ⇒ payment batch payout ⇒ second-batch-against-fully-paid-period and unpost-after-payment both refused ⇒ register/payslip/employer-cost/liability reports ⇒ close) |
| `backend/test/expenses.e2e-spec.ts` | 16 | Claim create/submit with mandatory-receipt block + duplicate-receipt rejection, business-purpose-required rejection, employee advance settlement (fully settled, overspend producing a reimbursement payable, no-advance producing a full reimbursement payable), partial approval, gross-to-net VAT split via the Tax Engine, balanced GL posting (net expense + recoverable VAT = employee reimbursement payable), SUPPLIER_SETTLEMENT exclusion from GL and the register, 12-month straight-line prepaid recognition with same-period-retry idempotency, headcount-driver cost allocation reconciling to the exact total with zero residual + balanced GL, reciprocal/self-loop cycle detection, budget-vs-actual from the posted register, a cost-center reclassification adjustment with balanced GL + cost-center P&L verification, expense-period close gated on an unresolved claim then an unposted claim then an unrecognized prepaid schedule row + successful close/reopen, and the health check surfacing a real approved-but-unposted claim |

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
  only, per the spec's own scoping. A tenant can now create/edit/submit-
  for-review/approve/activate/repeal its own custom `TaxRule` through
  `/tax/rules` (previously flagged as missing — no admin surface existed
  for the versioning/resolution logic the engine already had); this also
  fixed a genuine cross-tenant read leak in the `GET /tax/rules` it
  replaced, which had no `tenantId` filter at all. `TaxRate`/`TaxCategory`/
  `TaxExemption`/`TaxLegalSource` remain shared, system-wide reference
  data with no tenant-facing create endpoint (none of those four models
  has a `tenantId` column in this schema — see docs/TAX_ENGINE.md). No
  frontend UI yet.
- **Sales ⇄ Accounting/Tax reconciliation** — ✅ done for Sales Invoice
  (real GL + Tax Register posting, atomically). Sales Order intentionally
  untouched (no revenue event at order stage). COGS/Inventory posting now
  happens for real at Sales Invoice time via the Inventory Costing Engine
  (Phase 11) — see below; this bullet's earlier "needs a costing engine
  that doesn't exist yet" is stale and corrected.
- **Sales Pre-Order & Order Management** — ✅ done, tested, documented.
  No Partner/Contract/Agreement entities (reuses Counterparty directly —
  see docs); no frontend UI yet.
- **Sales Execution** — ✅ done, tested, documented. Shipment posts real
  inventory quantity movements and calls the Inventory Costing Engine at
  the physical stock-out event (no GL of its own — that boundary is
  intentional); the Sales Invoice reads that cost back and posts real
  `Dr COGS / Cr Inventory` once a costing policy is configured (this
  bullet previously said "Costing doesn't exist yet" — corrected, see the
  Inventory Costing Engine section); AR is a clean SettlementObligation
  contract, not a full register. No frontend UI yet.
- **Procurement & Purchase Order Management** — ✅ done, tested,
  documented. No Agreement/Partner entities (reuses Counterparty directly,
  same simplification as Sales); no persisted supplier comparison (live
  query instead); no MOQ/order-multiple enforcement (captured, surfaced,
  not yet validated); no frontend UI yet.
- **Purchase Execution** — ✅ done, tested, documented. Goods Receipt
  Model A only (GRNI clearing — Model B not implemented); no batch/serial
  tracking. Payment/Advance now exists (Phase 13's Settlement Subledger +
  Phase 14's Treasury/Bank Operations) — `SupplierPayable` itself still
  never shows PARTIALLY_PAID (a legacy field kept for backward
  compatibility; the real partial-payment state lives on
  `SettlementOpenItem`). No frontend UI yet.
- **Warehouse / Stock Engine** — ✅ done, tested, documented. The Stock
  Truth Engine: physical stock always computed live from the immutable
  `InventoryMovement` register (never a mutable field), with Phase 7/9's
  `InventoryLedgerService` retrofitted onto it with zero call-site
  changes and zero test regressions. WarehouseTransfer (instant/two-step/
  internal-location), InternalConsumption, InventoryAdjustment (write-off/
  surplus/opening-balance), InventoryStatusTransfer, plus Stock Balance/
  Stock Card/Batch/Serial/Negative-Stock/Min-Max reporting.
  InternalConsumption/InventoryAdjustment now post a real accounting entry
  via the Inventory Costing Engine (Phase 11, see below) once a costing
  policy is configured — this bullet previously said "no costing engine
  yet"; that has been built and is now tested/documented. Boolean
  negative-stock policy, not the spec's 3-state enum — see
  docs/WAREHOUSE_INVENTORY.md for the full list. No frontend UI yet.
- **Inventory Costing Engine** — ✅ done, tested, documented (the module
  itself predates this entry; tests/docs/a latent GL-dimension bug fix
  were what was missing). FIFO/Weighted-Average, wired into Goods
  Receipt/Shipment/Sales Invoice (real COGS)/Sales Return/Purchase Return
  (targets the exact source FIFO layer when traceable)/Internal
  Consumption/Inventory Adjustment/Warehouse Transfer; manual cost
  adjustments split on-hand-vs-COGS by remaining layer quantity; backdated
  recalculation with correct-order layer rebuilding; costing periods.
  Purchase Return's own GL inventory-credit amount still uses its recorded
  price rather than the live cost (a smaller disclosed gap); a pre-policy
  movement can now be backfilled once the policy's `effectiveFrom` is
  backdated to cover it (subledger-only, never a GL entry into an
  already-closed period), scoped to single-document receipts/
  consumptions — Warehouse Transfer/Adjustment SURPLUS are not
  backfillable — see docs/INVENTORY_COSTING.md.
- **Inventory Count / Reconciliation Engine** — ✅ done, tested,
  documented. Variance never collapses to a per-product net; reuses
  Phase 10's existing `InventoryAdjustment`/`WarehouseTransfer`/
  `InventoryStatusTransfer` documents rather than a fourth posting
  mechanism; see docs/INVENTORY_COUNT.md for the full list of disclosed
  simplifications (no counter-vs-approver enforcement beyond the
  permission gate, latest-recount-wins, no printable sheets/offline sync).
- **Counterparty Settlement Engine** — ✅ done, tested, documented. A real
  append-only `SettlementMovement` ledger + rebuildable `SettlementOpenItem`
  projection, built additively alongside the legacy
  `SettlementObligation`/`SupplierPayable` fields every other module still
  reads. Realized FX is computed and stored but not yet posted to GL;
  cross-currency settlement is blocked rather than converted; credit
  exposure is a callable interface Sales Pre-Order/Execution don't call
  yet; AR/AP-vs-GL health check is a placeholder — see
  docs/SETTLEMENT.md.
- **Treasury / Bank Operations** — ✅ done, tested, documented. Three
  loosely-coupled layers (Treasury Plan / Bank Reality / Settlement
  Allocation — Phase 13's engine, never duplicated): PaymentRequest's own
  configurable amount-tier approval + partial approval + partial
  multi-order execution, IncomingBankPayment/InternalBankTransfer/BankFee/
  FXConversion as full document-framework participants, multi-document-
  type bank statement matching, and a formal BankReconciliation period
  close layered on the existing line-level matching. Payment Instruction
  stays folded into PaymentOrder's own posting event (a pre-existing
  simplification, not revisited); InternalBankTransfer posts as a single
  atomic event rather than the spec's optional multi-day in-transit
  timing; BankFee tax is a flat manual amount, not full Tax Engine
  resolution; no MT940/CAMT.053 parser, only CSV; forecast versioning and
  credit-line/loan management are out of scope — see docs/TREASURY.md.
- **Cash Desk Engine** — ✅ done, tested, documented. Extends Phase 14's
  `Cashbox`/`CashTransaction` rather than new document types; negative-
  balance control is concurrency-safe (advisory lock before the balance
  read); `CashDeskTransfer` mirrors WarehouseTransfer's INSTANT/TWO_STEP
  shape; physical-count differences resolve only through
  `CashCountAdjustment`. No payroll-deduction/expense-report workflow, no
  automatic `CashierAssignment` handoff on handover completion, `BLIND`
  count method doesn't withhold the book balance from the API,
  `maxCashLimit`/override permission codes are declared but not yet
  enforced — see docs/CASH_DESK.md.
- **Fixed Asset Subledger** — ✅ done, tested, documented. Acquisition
  Candidate → CIP → Fixed Asset Card → Acceptance/Commissioning →
  Depreciation → Transfer/Modernization/Impairment → Disposal, with
  live-computed cost/depreciation/impairment (never a mutable field) and
  concurrency-safe CIP capitalization. Straight-line depreciation only
  (other methods schema-ready, not implemented); single valuation book;
  no componentization or revaluation model; no partial disposal; no
  Purchase Invoice → Acquisition Candidate auto-wiring (Phase 9's posting
  handler is left untouched) — see docs/FIXED_ASSETS.md.
- **HR Core / Employment Lifecycle Engine** — ✅ done, tested, documented.
  Physical Person → Employee → Hire Document → Employment, with
  effective-dated EmployeeAssignment/EmploymentStatusHistory as the
  authoritative "what was true as of date X" source; rehire reuses the
  same Employee row; multiple concurrent employments per employee;
  manager-hierarchy cycle detection on transfer; staffing-position
  headcount/FTE capacity enforcement with a permissioned override. No GL
  posting (not a document-framework participant); no scheduled job for
  future-dated hire/transfer projection refresh (call `syncStatus()`);
  LeaveRecord/AbsenceRecord are foundation-only, no entitlement/accrual
  engine; no approval sub-workflow — see docs/HR_CORE.md.
- **Work Time / Timesheet Engine** — ✅ done, tested, documented. Three
  strictly separate layers (planned/actual/payroll-input); Daily Work Plan
  derived fresh from Production Calendar + Schedule Pattern + Phase 17
  as-of-date employment state; raw attendance → interpreted intervals →
  normalized time entries → timesheet → WorkTimeRegister (fifth Truth
  Engine reuse, written once on lock) → PayrollTimeInput. REGULAR_WORK/
  OVERTIME are the only worked-hours buckets; NIGHT/HOLIDAY/WEEKEND are
  independent premium overlays never double-counted into the total. An
  unapproved plan-vs-actual excess is flagged as an EXCEPTION and blocks
  approval rather than being silently absorbed. Corrections are append-
  only, even against a LOCKED timesheet (flags `requiresRecalculation`
  instead of silently changing locked data). No biometric/device
  integration, no AI anomaly detection, hardcoded TimeCode catalog, only
  the PREAPPROVAL_REQUIRED overtime policy, no actual-clock-based break
  deduction (uniform from the schedule pattern instead) — see
  docs/WORK_TIME.md.
- **Payroll / Gross-to-Net Engine** — ✅ done, tested, documented.
  Effective-dated compensation with mid-period segment splitting; reads
  Phase 18's hours through `PayrollTimeInputService` only; base-salary
  proration + overtime/night/holiday premiums with no double-paying of
  holiday/weekend hours; Gross-to-Net with separate taxable/social/
  unemployment/medical bases and progressive tax/contribution brackets
  resolved by `asOfDate` from seeded data (never hardcoded); execution
  orders with legal caps and carry-forward; a versioned, non-destructive
  retro/recalculation engine (`SUPERSEDED`, never overwritten);
  `PayrollPosting` as a full document-framework participant producing a
  balanced GL entry and the `PAYROLL_LIABILITY_REGISTER` (sixth Truth
  Engine reuse); `PayrollPaymentBatch`/`PayrollPaymentAllocation` as the
  stable contract Phase 14/15 are expected to consume; close/reopen +
  register/payslip/employer-cost/liability reports + health checks. AZ
  2026 bracket figures are illustrative, not verified official rates; only
  the statutory-minimum overtime/night/holiday multiplier; a payment batch
  confirms immediately rather than a separate draft/confirm step; reopen
  does not cascade-undo GL posting or payments — see docs/PAYROLL.md.
- **Expenses / Cost Centers / Employee Expenses** — ✅ done, tested,
  documented. `CostCenter` distinct from Department; effective-dated
  Expense Category/Policy; claim/line/receipt lifecycle with policy/
  duplicate/business-purpose validation before submission; Tax Engine
  reuse for the gross-to-net VAT split (never folded into the expense
  account); Phase 15 `AccountablePerson` advance settlement bridged via a
  caller-supplied `responsiblePersonId`; a Classification Engine
  excluding SUPPLIER_SETTLEMENT lines from GL/register outright;
  `ExpenseClaimPostingHandler` as a full document-framework participant
  (seventh Truth Engine reuse) plus a new
  `EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER`; an idempotent straight-line
  Prepaid Expense recognition run; Cost Allocation (DIRECT/DRIVER_BASED,
  drivers backed by real Phase 17/18 data, self-loop + direct-reciprocal
  cycle detection, exact-total reconciliation); cost-center
  reclassification adjustments; budget-vs-actual from the posted
  register; period close gated on the period's own unallocated cost, not
  a blanket rule-exists check. Cost-allocation cycle detection is
  partial (no full topological detection); the reclassification GL entry
  assumes a single account for the pool; budget commitment is manually
  entered; INVENTORY_COST/FIXED_ASSET classifications are flagged but not
  auto-wired into a receipt or acquisition candidate — see
  docs/EXPENSES.md.
- **Banking, ...** — not started. Later phases building on this
  foundation.
