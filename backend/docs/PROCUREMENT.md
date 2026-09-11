# Procurement & Purchase Order Management (docx spec Phase 8)

Planning and commercial-commitment layer for buying goods and services.
Explicitly excludes Goods Receipt, Purchase Invoice, Supplier Payable
posting, Input VAT posting, physical inventory receipt, landed cost, and
actual payment — all reserved for Phases 9/10/11/14 (spec sections 59-67).
This build's boundary mirrors exactly how Phase 6 (Sales Pre-Order) kept
GL/Tax/AR/revenue out of the customer-order layer.

## A. Procurement architecture

```
Demand  ---->  PurchaseRequirement  ---->  PurchaseOrder  ---->  (Phase 9) Goods Receipt / Purchase Invoice
(manual or                 |  create-order      |  confirm
 SalesOrderLine)            |  (bespoke command,  |  (generic document-
                            |   not CreateBasedOn) |   framework post)
                            v                      v
                  DocumentLineLink            postingStatus=POSTED
                  REQUIREMENT_TO_             IS the CONFIRMED
                  PURCHASE_ORDER              commercial-commitment
                                               state
```

`PurchaseRequirement` captures demand. `PurchaseOrder` captures a
supplier commitment. Expected Supply is a read-only projection over
confirmed `PurchaseOrderLine`s. **None of these three, by themselves,
create physical stock, input VAT, supplier debt, or a General Ledger
posting** — this is the spec's own closing sentence, and it is enforced
structurally here (see section H).

`PurchaseOrder` reuses the `DocumentStatus`/`PostingStatus` pattern
`SalesOrder` established in Phase 6: `postingStatus = POSTED` IS the
`CONFIRMED` state (`PurchaseOrderPostingHandler`), reached through the
same generic `/documents/PURCHASE_ORDER/:id/post|unpost|cancel` commands
— not a parallel confirmation state machine. `PurchaseRequirement` does
**not** go through the document-framework at all: it never posts (spec
section 94), so it is plain CRUD + a derived `status`, closer in shape to
`CustomerRequest` than to `SalesOrder`.

## B. Demand sources

- **Manual** — a buyer enters a `PurchaseRequirementLine` directly.
- **SalesOrder-derived** — a line optionally carries
  `sourceDocumentType/sourceDocumentId/sourceLineId` pointing at a
  `SalesOrderLine` (this build's CustomerOrderLine — see
  docs/SALES_PREORDER.md). Nothing auto-generates these lines; a caller
  (a future planning job, or a person) creates the requirement line and
  fills the source fields, mirroring how `CommercialOfferToSalesOrderMapper`
  copies rather than auto-triggers.
- Every other future demand source (Production requirement, Phase 21) can
  use the same free-text `sourceDocumentType` without a schema change.

## C. Requirement model

`PurchaseRequirementLine.quantity` never changes after creation.
`cancelledQuantity` tracks what was explicitly cancelled (whole-remainder
cancel via `POST .../cancel`, same "never rewrite `quantity`, always add
to `cancelledQuantity`" convention as `SalesOrderLine`/`PurchaseOrderLine`).
"Ordered" is **not** a stored column — it is the live sum of
`DocumentLineLink` rows with `relationType = 'REQUIREMENT_TO_PURCHASE_
ORDER'` for that line, exactly the same "never persist a manually-editable
total as source of truth" rule `OrderFulfillmentService` established for
`SalesOrder.fulfillmentStatus` (spec section 83 there, section 90/106
here). `ProcurementPlanningService.remainingForRequirementLine` and
`.coverageForRequirement` compute `remaining = quantity - cancelled -
ordered` live, and `.recomputeRequirementStatus` derives `OPEN` /
`PARTIALLY_ORDERED` / `FULLY_ORDERED` from that same live computation
after every allocation.

`ProcurementPlanningService.aggregateDemand(productId, warehouseId?)` is
a **query**, not an auto-merge: it sums the remaining quantity across every
`OPEN`/`PARTIALLY_ORDERED` line for a product (optionally scoped to one
effective warehouse — a line's own `warehouseId` override, else its
requirement header's), never rewrites separate requirement rows into one.
"30 + 50 + 20 → 100" (spec section 106) is what the query answers, not
what happens on disk.

## D. Supplier selection

`SupplierSelectionService.candidatesForProduct` is a **live query**, not
a persisted "SupplierComparison" table (see Technical Debt, section O).
Candidates come from active `SupplierProductCode` mappings for the
product (so only suppliers explicitly known to sell it are considered —
no guessing from a global product-to-supplier fuzzy match), each resolved
against a `PURCHASE` price list via `PurchasePriceResolverService` and
given a live `TaxCalculationService` preview. A mapped supplier with no
resolvable price still appears (`price: null`) rather than being silently
dropped, so a buyer can see *why* a supplier isn't proposed (spec section
100). Results sort cheapest-first, `null`-price candidates last.

`SupplierProductCode` (spec sections 45-50, 55-57, 108) carries the
external code plus `moq` / `orderMultiple` / `leadTimeDays`. Uniqueness is
`(organization, supplier, product)` — one active mapping per pair — while
`supplierCode` uniqueness is scoped to `(organization, supplier)` only,
because "different suppliers may use the same external code" (spec
section 108) is an explicit requirement, not an edge case to guard
against.

## E. Purchase Order

- `PurchaseOrderService.create/update` snapshot price via
  `PurchasePriceResolverService` (a thin wrapper forcing `priceListType =
  'PURCHASE'` onto the same `PriceListService.resolvePrice` engine Sales
  uses for `'SALE'` lists — spec section 51: "never reuse the sales
  price") and a tax **preview** via `TaxCalculationService`
  (`operationType: 'PURCHASE'`, `taxpayerSide: 'BUYER'`) when a line omits
  an explicit `taxRate` (tax-inclusive supplier prices, spec section 70).
  Both are frozen into the line at save time and never silently
  re-resolved later — historical integrity (spec sections 124, 130): a PO
  raised under today's VAT rule keeps that rate even if the law changes
  before Phase 9's Purchase Invoice recognizes it for real.
- `postingStatus = POSTED` IS `CONFIRMED` (spec section 26). Supplier
  eligibility (must be `SUPPLIER`/`BOTH`, active) is checked twice, on
  purpose: at `create()`/`update()` (mirrors `SalesOrderService.
  assertCustomer` — a draft never even gets an ineligible counterparty)
  and again in `PurchaseOrderPostingHandler.validateForPosting` (defends
  against the counterparty being deactivated between draft creation and
  confirmation).
- `PurchaseOrderLine.cancelledQuantity` tracks partial/remainder
  cancellation the same way `SalesOrderLine` does (spec section 121:
  "received 40, cancelled 60" never rewrites the original ordered 100).
- `PurchaseOrderHold` (spec section 83) mirrors `OrderHold`: structured
  `holdType`/`reason`, multiple holds may coexist, confirmation is blocked
  until every `ACTIVE` hold is `RELEASED`.
- Multi-supplier sourcing (spec sections 53, 122) needs no special
  machinery: it is simply calling `create-order` twice against the same
  requirement with two different suppliers and disjoint quantities — see
  section C's live `remaining` computation, which naturally caps each
  call.

## F. Expected Supply

`ExpectedStockService` computes Expected Supply live from **confirmed**
(`postingStatus = POSTED`, not cancelled) `PurchaseOrderLine`s — there is
no persisted `ExpectedReceipt` table (see Technical Debt). A line with a
`PurchaseDeliveryScheduleLine` split contributes each planned date/
quantity/warehouse separately (spec section 61: "100 units, 50 Monday, 50
next month" is never flattened to one row at one date); a line without
one contributes its whole remaining quantity at
`line.expectedDeliveryDate ?? order.expectedDeliveryDate ?? order.
documentDate`. This is **expected**, never physical stock (spec sections
95, 103) — nothing here writes to `InventoryLedgerService`'s
`INVENTORY_REGISTER`; that only happens on a real Goods Receipt (Phase 9)
or a Shipment (Phase 7, the sales-side register).

`openPurchaseOrders` (spec section 88: confirmed, not cancelled, at least
one line's `quantity - cancelledQuantity > 0`) and `latePurchaseOrders`
(spec section 89: an open PO whose `expectedDeliveryDate` is before the
given as-of date) build directly on the same live computation.

## G. Payment Schedule

`PurchaseOrderPaymentSchedule` (spec sections 70, 85-86, 119) is a
**planned obligation only** — visible to a future Treasury Payment
Calendar (Phase 14), never a Bank Payment, never posted to the GL. Mirrors
`OrderPaymentSchedule` exactly, plus a `basis` label
(`ADVANCE`/`AFTER_RECEIPT`/`AFTER_INVOICE`) per installment. Rounding: a
percentage installment is `round(total × pct / 100)` except the last,
which absorbs the remainder so the schedule sums to exactly the PO total
— never an independently-rounded, possibly-mismatched final line.

## H. Tax Preview — why no tax posting exists

`PurchaseOrderService` calls `TaxCalculationService.calculateLine` (the
same pure, side-effect-free calculator that backs `/tax/calculate` and
every other preview in this codebase) and nothing else. It never calls
`TaxRegisterService.registerTaxable` and never creates a `TaxMovement`.
This is a **structural** guarantee, not a policy the code merely chooses
to follow at runtime: `PurchaseOrderPostingHandler` does not implement
`buildAccountingBatch` at all — `DocumentPostingService.post` only invokes
that hook when a handler defines it (`if (handler.buildAccountingBatch)`)
— so confirming a PurchaseOrder cannot produce a `JournalEntry`, an
`AccountingMovement`, or a `TaxMovement`, the same way omitting the method
entirely (rather than defining it to `return null`) closed that door for
`ShipmentPostingHandler` in Phase 7. Input VAT recognition happens for
real only when Phase 9's Purchase Invoice calls `TaxRegisterService`.

## I. Demand-Supply Pegging

`SupplyPeg` (spec sections 73-77) is a **planning linkage**, never a
physical reservation — it does not touch `StockReservation` at all.
`SupplyPegService.create` validates the demand side when `demandType =
'SALES_ORDER'` (checks the referenced `SalesOrderLine` exists and the
requested quantity does not exceed `quantity - cancelledQuantity - already
-pegged`) and the supply side when `supplyType = 'PURCHASE_ORDER'` (the
referenced `PurchaseOrderLine` must exist). Other demand/supply type
strings are accepted by the schema (generic columns, not FKs — spec's own
suggested field list) but have no wired-up validation in this build; see
Technical Debt.

## J. Permissions

`purchase.requirement.{view,create,edit,cancel}`,
`purchase.order.{view,create,edit,confirm,reopen,cancel}`,
`purchase.price.override` (reserved — not yet enforced anywhere, see
Technical Debt), `purchase.supplier_selection.{view,manage}`,
`purchase.expected_receipt.view`, `purchase.payment_schedule.
{view,manage}`, `purchase.supply_planning.view`,
`purchase.supply_pegging.manage`, `purchase.order_hold.manage`,
`purchase.supplier_product_code.{view,manage}`. Confirm/reopen/cancel on
`PurchaseOrder` reuse the generic `documents.post/unpost/cancel`
permissions on `/documents/PURCHASE_ORDER/:id/...` (see
`DocumentCommandsController`) exactly like `SalesOrder` does; the
domain-specific `purchase.order.confirm`/`.reopen` codes gate the
same-named friendly routes on `PurchaseOrderExtrasController`.

## K. Audit

`PURCHASE_REQUIREMENT_CREATED/UPDATED/CANCELLED`,
`PURCHASE_REQUIREMENT_ALLOCATED`, `PURCHASE_ORDER_CREATED/UPDATED`,
`PURCHASE_ORDER_LINE_CANCELLED`, `PURCHASE_ORDER_HOLD_PLACED/RELEASED`,
`PURCHASE_PAYMENT_SCHEDULE_GENERATED`, `SUPPLIER_PRODUCT_CODE_CREATED/
UPDATED/DEACTIVATED`, `SUPPLY_PEG_CREATED/REMOVED`. Confirm/reopen/cancel
on `PurchaseOrder` are audited generically by `DocumentPostingService`
(`DOCUMENT_POSTED`/`DOCUMENT_UNPOSTED`/`DOCUMENT_CANCELLED`), same as
every other document type.

## L. Database

New tables: `purchase_requirements`, `purchase_requirement_lines`,
`purchase_orders`, `purchase_order_lines`,
`purchase_delivery_schedule_lines`, `purchase_order_holds`,
`purchase_order_payment_schedules`, `supplier_product_codes`,
`supply_pegs`. Key constraints/indexes:
- `purchase_requirements`: unique `(tenantId, number)`; indexed on
  `(organizationId, status)`, `(organizationId, warehouseId)`,
  `(organizationId, requiredByDate)`.
- `purchase_orders`: unique `(tenantId, number)`; indexed on
  `(organizationId, counterpartyId, status)`,
  `(organizationId, expectedDeliveryDate)`.
- `purchase_order_lines`: indexed on `(purchaseOrderId, position)`,
  `(tenantId, productId)`, `(tenantId, requirementLineId)`.
- `supplier_product_codes`: unique `(organizationId, counterpartyId,
  productId)`; indexed on `(organizationId, counterpartyId,
  supplierCode)`.
- `supply_pegs`: indexed on the demand triple and the supply triple.
- Cross-document links reuse the existing `document_line_links` table
  (`REQUIREMENT_TO_PURCHASE_ORDER`) rather than a new join table.

## M. Tests

`test/procurement.e2e-spec.ts` (10 tests, all passing):
1. Manual requirement create (`OPEN`), whole-remainder cancel, tenant
   isolation (404 across tenants).
2. Demand aggregation across three separate `OPEN` requirement lines for
   one product/warehouse sums to the combined remaining quantity.
3. Supplier candidate query returns a mapped supplier with resolved
   `PURCHASE` price and a live tax preview.
4. A customer-only counterparty is rejected as a PO supplier at create
   time (`SUPPLIER_NOT_ELIGIBLE`, 422).
5. Confirming a PO leaves `JournalEntry` and `TaxMovement` counts at zero
   for that document; Expected Supply reflects the confirmed quantity and
   drops correctly after a line cancellation, while the line's original
   `quantity` column stays untouched.
6. An `ACTIVE` `PurchaseOrderHold` blocks confirmation (409); releasing it
   allows confirmation to proceed.
7. Requirement → PurchaseOrder allocation across two different suppliers:
   status goes `OPEN → PARTIALLY_ORDERED → FULLY_ORDERED`; an
   over-allocation beyond the remaining quantity is rejected (422).
8. Payment schedule installments (percentage-based) sum to exactly the PO
   grand total.
9. A `SupplyPeg` links a `SalesOrderLine` demand to a `PurchaseOrderLine`
   supply; a second peg exceeding the now-fully-pegged demand is rejected
   (422); removing the peg clears the listing.
10. Cross-tenant isolation on purchase orders (404 on read; 400 on create
    referencing another tenant's supplier).

Run: `cd backend && npx jest --config test/jest-e2e.json procurement.e2e-spec.ts`
(same manual-migration workflow as every prior phase — see the top-level
README's Quick Start).

## N. Phase 9 readiness

A Goods Receipt / Purchase Invoice / Purchase Return built against a
confirmed `PurchaseOrder` can already ask, without redesigning anything
here:
- **Remaining receivable quantity** per line —
  `PurchaseOrderLine.quantity - cancelledQuantity` (nothing "received" yet
  reduces it in this build; Phase 9 is the first thing that will).
- **Remaining invoiceable quantity** — same shape as Sales' `remaining
  Invoiceable` helper in `SalesInvoicePostingHandler`; Phase 9 can
  aggregate `DocumentLineLink` rows the same way once it defines its own
  `PURCHASE_ORDER_TO_RECEIPT`/`RECEIPT_TO_INVOICE` relation types.
- **Supplier / counterparty / agreement context** —
  `PurchaseOrder.counterpartyId` (this build has no separate Agreement
  entity — see Technical Debt and docs/SALES_PREORDER.md's identical
  Counterparty-only simplification).
- **Price + tax context** — `PurchaseOrderLine.price/taxRate` is the
  frozen commercial snapshot (spec section 133: "PO price is reference/
  commercial input only... do not treat PO price as final inventory
  valuation" — Phase 11 Costing owns actual valuation).
- **Warehouse** — `PurchaseOrderLine.warehouseId ?? PurchaseOrder.
  warehouseId`, plus `PurchaseDeliveryScheduleLine` for split deliveries.
- **Supplier product code** — snapshotted onto
  `PurchaseOrderLine.supplierProductCode` at order time.
- **Payment terms** — `Counterparty.paymentTerms` (days) plus any
  `PurchaseOrderPaymentSchedule` rows already generated.

## O. Technical debt / deferred functionality

Disclosed deliberately, matching every prior phase's documentation:

- **No persisted SupplierComparison.** `SupplierSelectionService` is a
  live query, not a stored snapshot of "why this supplier was chosen at
  the time." If an audit trail of the comparison itself (not just the
  final `SUPPLIER_SELECTED` audit event's inputs) becomes a requirement,
  it needs its own table.
- **No `purchase.price.override` enforcement.** The permission code
  exists (spec section 92) but nothing in `PurchaseOrderService` currently
  gates an explicit line `price` behind it — any user with
  `purchase.order.create/edit` can set an explicit price, resolved or not.
- **No Agreement/Partner/Contract entities**, same simplification as
  every phase since Phase 3: `Counterparty` (with `counterpartyType`
  `SUPPLIER`/`BOTH`) is the only supplier primitive. Spec language like
  "Invalid Agreement: rejected" (section 109) has no Agreement to
  validate against in this build — only active-and-eligible-counterparty
  is checked.
- **No Order-Multiple/MOQ enforcement.** `SupplierProductCode.moq` and
  `.orderMultiple` are captured and surfaced in the supplier-candidate
  comparison (spec sections 55-56: "do not silently round up") but
  nothing currently validates or warns when a `PurchaseOrderLine.quantity`
  violates them — that policy decision (block vs. warn vs. silent) is
  left to a future UI/service layer.
- **`Department.managerPersonId` reused as-is; `PurchaseRequirement.
  requesterId`/`PurchaseOrder.buyerId`** point at `ResponsiblePerson`
  (spec section 79), not a dedicated Employee model — same simplification
  `Warehouse.responsiblePersonId` already established in Phase 1.
- **Only `SALES_ORDER`/`PURCHASE_ORDER` are wired into `SupplyPegService`
  validation.** The schema's generic `demandType`/`supplyType` strings
  accept anything, but a peg against an unimplemented type skips the
  quantity-cap check entirely (no error, no validation) rather than
  rejecting it — a future demand/supply type must add its own branch.
- **No true concurrency test.** Like every prior phase, optimistic
  locking (`version` + `ConcurrencyConflictError`) is implemented and unit
  -testable but not exercised under genuine parallel load in the e2e
  suite.
- **No reports/query foundation beyond what's listed in section M.**
  Spec section 87 lists a dozen report shapes (Requirements by Department,
  Purchase Orders by Supplier, Procurement by Buyer, ...); only Expected
  Supply / Open POs / Late POs / Demand Coverage / Open Requirements are
  implemented as queries here. The rest are straightforward Prisma
  queries over the same tables and are deferred to whichever phase
  actually needs a reporting UI.
- **Purchase channel / duplicate-PO detection / import-procurement
  fields** (spec sections 80-82, 66) are captured as plain optional
  columns (`purchaseChannel`, `supplierReference`) with no behavior
  attached — no duplicate-order warning, no customs/Incoterm structure
  beyond a free-text channel label.
- **No budget check hook.** Spec section 84's `PurchaseBudgetCheckService`
  extension point is not implemented — nothing here can currently block a
  PO on budget grounds.
