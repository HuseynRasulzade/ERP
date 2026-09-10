# Sales Execution

Completion report for the docx spec's **"Phase 7 — Sales Execution"**.
Module: `src/sales-execution/`. Builds on Accounting Core, Tax Engine, and
Sales Pre-Order.

## A. Architecture — Shipment vs Sales Invoice

Kept structurally distinct per spec section 2. `Shipment` is physical
execution only — no accounting consequence. `SalesInvoice` is the
commercial/legal/accounting event. Both flow through the generic
document framework independently:

```
Customer Order --(remaining qty)--> Shipment --(uninvoiced qty)--> Sales Invoice
Customer Order ------------------------------(remaining qty)-----> Sales Invoice  (direct, also supported)
```

`DocumentLineLink` (built in Phase 6) is the shared substrate for all of
this: `ORDER_TO_SHIPMENT`, `SHIPMENT_TO_INVOICE`, `ORDER_TO_INVOICE`.
`OrderFulfillmentService.forOrder` (Sales Pre-Order) already aggregated
`ORDER_TO_SHIPMENT` links — that aggregation only started returning
non-zero `fulfilled` quantities once this build started writing them.

## B. Shipment posting — Inventory integration

`InventoryLedgerService` is a **real, quantity-only inventory register**
built on Phase 0's `RegisterMovement` (`registerCode = 'INVENTORY_REGISTER'`)
— not a stub, not a parallel stock ledger (spec section 123). It tracks
ISSUE/RECEIPT quantities per product/warehouse and nothing else — no unit
cost, no FIFO/weighted-average layers (that's Phase 11's job, spec section
36). `ShipmentPostingHandler`:

1. Validates the counterparty/warehouse are active, quantity doesn't
   exceed the source order line's remaining quantity
   (`ShipmentQuantityExceedsRemainingError`), and stock is sufficient
   (`ShipmentInsufficientStockError`, skipped when the warehouse allows
   negative stock).
2. On post: writes an ISSUE movement per line, a `ORDER_TO_SHIPMENT`
   `DocumentLineLink`, consumes the matching reservation
   (`ReservationService.consumeForLine`, FIFO across whatever reservation
   rows are ACTIVE/PARTIALLY_RELEASED), and recomputes the order's
   `fulfillmentStatus`/`reservationStatus`.
3. Carries **no GL consequence** — `buildAccountingBatch` always returns
   `null`. COGS is deferred (see section E).

`DocumentPostingHandler` gained a second optional hook,
`undoSideEffects`, called symmetrically by `DocumentPostingService.unpost`
— the existing generic cleanup (RegisterMovement/JournalEntry/TaxMovement)
doesn't know about a handler's own side effects like inventory movements
or reservation consumption. Unposting a Shipment removes its ISSUE
movements and `DocumentLineLink` rows, and restores reservation coverage
by creating a fresh ACTIVE reservation for the un-shipped quantity
(documented simplification: it doesn't reconstruct the exact original
reservation row(s) `consumeForLine` may have split across — the *net*
quantity is correct, the original reservation's own identity isn't
resurrected).

`SalesOrderToShipmentMapper` (Create Based On) defaults to the **remaining
fulfillable quantity only** (spec section 6's exact example: ordered 100,
shipped 40, cancelled 10 → new shipment defaults to 50) — never the full
order quantity.

## C. Sales Invoice posting — final tax, GL, AR

`SalesInvoicePostingHandler` (extended from the earlier [Sales
Reconciliation](./SALES_RECONCILIATION.md) build):

- Sets `taxPointDate` (defaults to the posting/document date) and
  `amountDue` on post.
- Validates invoiced quantity against the remaining invoiceable quantity
  on the **source** order or shipment line (`ORDER_TO_INVOICE`/
  `SHIPMENT_TO_INVOICE` link aggregation) — `InvoiceQuantityExceedsSourceError`.
- Writes the traceability link and a `SettlementObligation` row (the
  Phase 13 AR handoff contract — organization/partner/counterparty/
  currency/amount due/due date; `status` stays `NOT_PAID` forever in this
  build, spec section 40 forbids fabricating a real payment status
  without a real settlement module).
- Attempts COGS (Dr COGS / Cr Goods Inventory) only when the shipment
  line has a resolvable unit cost from `CostingService` — always skipped
  in this build (see section E).
- `undoSideEffects` blocks unposting when a **posted** `SalesReturn`
  references the invoice (`InvoiceHasReturnsError`) and removes the
  `SettlementObligation`/links otherwise.

`SalesLineItemDto` (shared by Order/Invoice lines) gained
`sourceOrderLineId`/`sourceShipmentLineId` — the columns already existed
on `SalesInvoiceLine` (one from the earlier build, one added here) but
nothing ever let a caller set them until now.

## D. Revenue recognition policy

This build's explicit, disclosed choice (spec section 27 requires one):
**revenue is recognized ON_INVOICE** — the Journal Entry (Receivable/
Revenue/VAT) posts when the SalesInvoice posts, regardless of whether a
Shipment exists or has posted. A direct Customer Order → Invoice flow
(no Shipment at all) works identically. `ON_SHIPMENT` is not implemented.

## E. COGS — Costing integration and timing

`CostingService.getUnitCost` **always returns `null`** — there is no
Phase 11 Costing Engine (FIFO/weighted-average) in this codebase, and
spec section 38 explicitly forbids fabricating a cost from the selling
price or any other proxy. Every caller treats `null` as "skip the COGS
posting for this line entirely" — never a zero-amount or estimated
posting. This is honest, not silently wrong: a `SalesInvoice` in this
build never has a COGS consequence. Swapping in a real Phase 11
implementation later requires no interface change on the Sales side.

## F. Tax — final calculation and Tax Register

Unchanged from the Sales Reconciliation build: `TaxCalculationService`
resolves the real rule at `taxPointDate` (never the Order/Offer's
historical Tax Preview), `TaxRegisterService.registerTaxable` writes the
`TaxMovement` and returns account-resolved GL lines, posted atomically
with the GL batch in `AccountingPostingEngine.postBatch`.

New for Sales Return (spec section 53): `SalesReturnPostingHandler`
looks up the **original posted `TaxMovement`** for the source invoice
line and prorates it (`return quantity / original quantity`) rather than
re-resolving today's Tax Engine rule against a historical sale. A return
line with no linked invoice line falls back to a fresh `STANDARD_VAT`
calculation (lower fidelity, documented).

`TaxRegisterService.registerTaxable` gained a `contra` flag: a Sales
Return still records `direction = OUTPUT` (it's still an output-VAT-
related event) but flips the GL side (`DEBIT` instead of `CREDIT` against
`VAT_OUTPUT_PAYABLE`) — reducing the liability rather than adding to it.
**Caveat**: `TaxRegisterService.taxBalance()`'s reversal-based sign
netting does not automatically net a return's contra movement against
the original sale's movement (they're two independent `TaxMovement` rows
with different `sourceDocumentType`s, not a reversal-of-relationship) — a
period net-output-VAT report must explicitly sum both `SALES_INVOICE` and
`SALES_RETURN` source types. `taxBalance()` itself is not extended to do
this automatically in this build.

## G. Accounting mappings used

`CUSTOMER_RECEIVABLE` (211), `SALES_REVENUE` (601), `VAT_OUTPUT_PAYABLE`
(521), `SALES_RETURN` (602), `COGS` (701, never actually posted — see E),
`GOODS_INVENTORY` (205, same caveat). All resolved through
`AccountingMappingService` — no literal account number anywhere in this
module's source.

## H. AR — settlement obligation for Phase 13

`SettlementObligation` — organization, counterparty, source document,
currency, amount due, due date, status (always `NOT_PAID`). Deliberately
NOT a full AR register: no payment allocation, no aging, no partial-
payment tracking. `dueDate` is not populated in this build (no
`PaymentTerms`-driven due-date calculation was implemented — see
Technical Debt).

## I. Returns — physical vs financial correction

`returnType`: `PHYSICAL_RETURN` (writes a RECEIPT inventory movement,
increases quantity on hand), `FINANCIAL_CREDIT_ONLY`/`PRICE_CORRECTION`
(no inventory effect — enforced by only calling `InventoryLedgerService`
when `returnType === 'PHYSICAL_RETURN'`). Return quantity is capped at
`sold − already-posted-returned` per source invoice line
(`ReturnQuantityExceedsSoldError`). COGS reversal (spec section 52,
`Dr Inventory / Cr COGS`) is skipped for the same reason original COGS
was never posted.

## J. Document chain

`Order → Shipment → Invoice → Return`, all via `DocumentLink` (header)
and `DocumentLineLink` (line-level execution). Every link carries a
`relationType` so a future query can walk the chain in either direction
without redesign (spec section 129 — Phase 27 territory, not built here,
but the data shape is ready).

## K. Permissions

`sales.shipment.{view,create,edit,cancel}`, `sales.invoice.reverse`,
`sales.return.{view,create,edit}`, `sales.accounting_entries.view`,
`sales.tax_details.view`. Posting/unposting for all three document types
(Shipment, SalesInvoice, SalesReturn) reuses the existing generic
`documents.post`/`documents.unpost` permissions via the shared
`/documents/:type/:id/post` route — matching this codebase's established
convention (Sales Order/Invoice from the earlier build already work this
way) rather than fragmenting into per-type post permissions the spec
suggests but this repo doesn't otherwise use.

## L. Audit

`SHIPMENT_CREATED` (via `AuditService`), plus the generic
`DOCUMENT_POSTED`/`DOCUMENT_UNPOSTED`/`DOCUMENT_CREATED` events already
emitted by the shared posting/create-based-on infrastructure for all
three new document types. Not yet emitted as distinct events:
`SHIPMENT_UPDATED`, `SALES_INVOICE_REPOSTED`, `SALES_TAX_RECALCULATED`,
`SALES_ACCOUNTING_POSTING_FAILED` (the generic `POSTING_ERROR` /
transaction rollback covers the failure case functionally, just not as a
named audit event).

## M. Tests

`test/sales-execution.e2e-spec.ts` — 8 tests: Order⇒Shipment defaulting
to remaining quantity (never full order quantity) and rejecting a second
shipment once fully fulfilled; draft shipments not counting as
fulfillment; partial shipments accumulating correctly with over-shipment
rejected; insufficient-stock rejection; reservation consumption on post
and restoration + inventory-movement reversal on unpost; Shipment⇒Invoice
with a verified-balanced Journal Entry, a `SettlementObligation`, and the
invoiceable-quantity cap; a physical Sales Return with prorated
historical tax, a balanced contra Journal Entry, an inventory RECEIPT,
excessive-return rejection, and invoice-unpost-blocked-by-posted-return;
tenant isolation. All passing alongside the pre-existing 147 tests (155
total, 152 e2e).

## N. Phase 8 readiness

Sales shortage (an order's `remaining` quantity, or a product with
`available < 0` per `InventoryLedgerService`) is queryable today via
`OrderFulfillmentService`/`InventoryLedgerService` but nothing in this
build creates a Purchase Requirement automatically (spec section 122
explicitly forbids that — "Do not directly create supplier order inside
SalesPostingHandler"). Phase 8 can query these services directly without
any redesign here.

## O. Deferred functionality (spec-sanctioned)

- Only VAT participates in final invoice tax calculation (matches Tax
  Engine's own scope).
- Invoice-before-shipment is architecturally possible (Invoice doesn't
  require a Shipment) but untested in this build's suite.
- Customer advance application (spec sections 44-45) — no advance
  allocation exists; `CUSTOMER_ADVANCE` mapping key exists from Tax
  Engine but nothing resolves it here.
- Multi-currency FX on Invoice — the currency-fallback mechanism exists
  (invoice → org → tenant base currency) but no live exchange-rate
  resolution/storage was added in this build specifically for Phase 7's
  multi-currency invoice requirements (spec sections 64-65).

## P. Technical debt

- **`SalesOrder.warehouseId` has no setter endpoint** — the column exists
  (added in Phase 6) but neither the create nor update DTO exposes it, so
  `SalesOrderToShipmentMapper` (which requires it) can only be exercised
  today by setting it directly in the database. A real fix means
  extending `CreateSalesOrderDto`/`UpdateSalesOrderDto`.
- **Due date generation** (spec section 42) — `SettlementObligation.dueDate`
  is never populated; no `PaymentTerms`-driven calculation exists (same
  gap as `PaymentScheduleService` in Sales Pre-Order — no rich
  `PaymentTerms` entity in this codebase).
- **Reposting** (spec section 59) is not a first-class generation-tracked
  operation for Shipment or SalesInvoice — same deferral already
  disclosed in Accounting Core's docs (unpost + post again is the
  practical equivalent).
- **`taxBalance()` doesn't net Sales Return contra movements automatically**
  against the original sale — see section F's caveat.
- **No true concurrent-shipment-posting race test** — the same class of
  gap already disclosed in Accounting Core/Tax Engine/Sales Pre-Order.
- **Service-line invoices without any Shipment** are structurally
  supported (COGS is simply never attempted when there's no
  `sourceShipmentLineId`) but not explicitly covered by this build's test
  suite.
- **No Sales reports foundation** (spec sections 79-83) — no dedicated
  query endpoints for "Sales by Customer/Product/Period", "Uninvoiced
  Shipments", "Net Sales", etc. The underlying data (posted invoices,
  `TaxMovement`, `SettlementObligation`, `DocumentLineLink`) is queryable
  directly; no summary/report layer was built on top of it.
