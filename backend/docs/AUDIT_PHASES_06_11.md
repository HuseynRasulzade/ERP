# Audit — Phases 6-11 (sales pre-order → inventory costing)

Checklist of each spec's acceptance criteria / mandatory rules / required
tests against the code, after this audit branch. Spec numbering is the
docx numbering (`phase06.txt` … `phase11.txt`); the README uses its own
module names (Sales Pre-Order, Sales Execution, Procurement, Purchase
Execution, Warehouse Inventory, Inventory Costing).

Legend: **Done** / **Partial** / **Missing** / **Fixed** (fixed on this branch).

## Phase 6 — Sales pre-order & orders (`src/sales-preorder`, `src/sales-documents`)

| Requirement | Status | Where |
|---|---|---|
| Customer Request / Commercial Offer / Order, Request→Offer→Order conversion with price preservation | Done | `customer-request.service.ts`, `commercial-offer.service.ts`, `commercial-offer-to-sales-order.mapper.ts`; `test/sales-preorder.e2e-spec.ts` |
| Price resolution, discount order, override permission + audit (offer) | Done | `commercial-offer.service.ts` |
| Price override gated on Sales Order lines | Partial | not gated by `sales.price.override` (documented tech debt) |
| Tax Preview only — no TaxMovement / GL / AR / revenue (spec 102-106, 125-126) | Done | explicit assertions in `sales-preorder.e2e-spec.ts` |
| Confirmation command, credit check (WITHIN/WARN/BLOCK), holds, manager approval | Done | `sales-order.posting-handler.ts`, `credit-check.service.ts`, `sales-order-approval.e2e-spec.ts` |
| Credit override with reason | Missing | permission exists, no endpoint |
| Remaining-quantity formula / line-level links (spec 27-30, 127-128) | Done | `order-fulfillment.service.ts` |
| Reservation = commitment, never stock movement; release audited | Done | `reservation.service.ts` |
| Reservation checked against real available stock + concurrency (spec 39, 130) | Missing | reservation checks only the order line's remaining quantity; `reservationPolicy` (NONE/TRY_RESERVE/REQUIRE_FULL/ALLOW_PARTIAL) not settable via DTO — deferred (needs product decision on default TRY_RESERVE semantics, see below) |
| Expired reservations stop reducing availability (spec 42) | Missing | `StockAvailabilityService.getReservedStock` ignores `validUntil` — deferred |
| Release reservations when order is cancelled (spec 41) | Missing | generic cancel has no handler hook — deferred |
| Order revision/versioning (spec 24, 138) | Missing | documented tech debt |
| Payment schedule with deterministic rounding | Done | `payment-schedule.service.ts` |
| Shipment planning | Done | `shipment-plan.service.ts` |
| Tenant/org isolation, RBAC, audit, optimistic concurrency | Done | tests in `sales-preorder.e2e-spec.ts` |

## Phase 7 — Sales execution (`src/sales-execution`, `src/sales-documents`)

| Requirement | Status | Where |
|---|---|---|
| Shipment separate from Invoice; partial shipments; over-shipment rejected | Done | `shipment.posting-handler.ts`; `sales-execution.e2e-spec.ts` |
| Stock availability on post, reservation consumption / restoration on unpost | Done | same |
| A shipment's OWN reservation counts as available for it (Phase 10 spec 28) | **Fixed** | `shipment.posting-handler.ts` adds the order line's active reservation back; previously a fully-reserved order could not be shipped |
| Stock-key lock on shipment availability check (race) | **Fixed** | `InventoryMovementService.lockStockKey` now taken in `validateForPosting` |
| Invoice: final tax, Tax Register, AR obligation, balanced GL, invoiceable caps | Done | `sales-invoice.posting-handler.ts` |
| COGS (spec 35-38): real cost, never fabricated | **Fixed** | COGS now booked at Shipment by the costing engine (Dr COGS / Cr Inventory via mappings) when the org has a costing policy; invoice-level COGS hook intentionally stays inert to avoid double COGS |
| Sales return: prorated historical tax, contra GL, physical receipt, excessive return rejected | Done | `sales-return.posting-handler.ts` |
| Return COGS reversal at original cost (spec 52) | **Fixed** | engine restores original shipment cost; return books Dr Inventory / Cr COGS |
| Multi-currency invoice FX (spec 64-65) | Partial | currency fallback only; document amounts treated as base currency |
| Sales reports foundation, due dates | Partial | COGS/gross-margin report added (`GET …/inventory-costing/cogs`); others deferred |

## Phase 8 — Procurement / PO (`src/procurement`)

| Requirement | Status | Where |
|---|---|---|
| Requirement, aggregation, supplier selection, PO confirm, approvals | Done | `procurement.e2e-spec.ts` |
| No GL / Tax Register / AP / stock on PO (spec 94-97, 110-111) | Done | handler has no `buildAccountingBatch` |
| Expected supply from confirmed lines, payment schedule, pegging | Done | `expected-stock.service.ts`, `supply-peg.service.ts` |
| `purchase.price.override` enforcement, MOQ/order multiple validation, budget hook | Missing | documented tech debt, unchanged |

## Phase 9 — Purchase execution (`src/purchase-execution`)

| Requirement | Status | Where |
|---|---|---|
| Goods Receipt (GRNI model A), partial receipts, over-receipt approval | Done | `goods-receipt.posting-handler.ts` |
| Purchase Invoice VAT + AP, duplicate control, receipt-less invoice | Done | `purchase-invoice.posting-handler.ts` |
| Invoice price ≠ receipt price must not strand a GRNI residual (spec 9 / costing spec 18) | **Fixed** | GRNI cleared at exactly the receipt value for the invoiced qty (`grniClearingAmount`), difference booked to inventory; costing engine splits it between on-hand and sold units |
| Purchase return, prorated tax, excessive return rejected | Done | `purchase-return.posting-handler.ts` |
| Purchase return inventory credit at cost (not document price) | **Fixed** | when costing is active the credit is the source layer's cost; difference → variance (OTHER_OPERATING_EXPENSE) |
| Additional purchase cost allocation (exact rounding) | Done | `additional-purchase-cost.posting-handler.ts` |
| Additional cost on partially sold goods split COGS/on-hand | **Fixed** | engine replay from the receipt date (`phase11` test) |
| FX: historical rate applied to base amounts (spec 27) | Partial | amounts posted as base currency, `exchangeRate` not applied — needs product decision |
| Posting preview, domain events/outbox, attachments | Missing | documented deferrals |

## Phase 10 — Warehouse / stock (`src/warehouse-inventory`)

| Requirement | Status | Where |
|---|---|---|
| Immutable signed movement register, live availability, stock-key advisory locks | Done | `inventory-movement.service.ts`, `stock-availability.service.ts` |
| Deterministic posting sequence (for costing order) | **Fixed** | `InventoryMovement.sequenceNo` (BIGSERIAL) |
| Transfers instant / two-step / location; status transfer; consumption; adjustments | Done | `warehouse-inventory.e2e-spec.ts` |
| Internal consumption / write-off accounting at actual cost (spec 16-17, 51) | **Fixed** | engine-valued: Dr expense (line account or operation-type mapping) / Cr Inventory; write-off ignores user `costReference` |
| Reservation expiry / hard-vs-soft reservations | Missing | see Phase 6 |
| Snapshots / partitioning | Missing | documented tradeoff |

## Phase 11 — Inventory costing (`src/inventory-costing`, new)

Built on this branch (previously only a `CostingService` stub returning
`null`). See `docs/INVENTORY_COSTING.md`. Tests: `test/phase11-inventory-costing.e2e-spec.ts` (23).

| Acceptance criterion (spec 136) | Status | Evidence |
|---|---|---|
| Quantity register stays authoritative; separate cost subledger | Done | `InventoryCostMovement` 1:1 with financial `InventoryMovement` |
| FIFO, layers traceable, consumption mapping | Done | FIFO basic/partial + trace test |
| Weighted average (moving + periodic month-close) | Done | WA + periodic finalize test |
| Provisional / final cost | Done | receipt PROVISIONAL until invoiced; FINAL at finalization |
| Goods Receipt forms cost; invoice difference corrects it | Done | price-difference test |
| Additional costs capitalized, split sold/on-hand, landed cost traceable | Done | APC test, layer card components |
| Shipment COGS; sales return at original cost; purchase return at source layer | Done | tests 124/125 equivalents |
| Transfer cost preservation; consumption/write-off at actual cost | Done | by-warehouse tests |
| Backdated recalculation from earliest affected date; queue; delta-only entries | Done | backdated FIFO test, deferred-policy test |
| Negative stock costing policy | Done | test 128 equivalent |
| Cost corrections → accounting adjustments, Debit = Credit | Done | system `InventoryCostAdjustment` + JE per date |
| Historical FX freeze / AP FX separation | Partial | engine never revalues; documents carry base amounts (see Phase 9 FX) |
| Recoverable vs non-recoverable tax in cost | Partial | recoverable VAT excluded; non-recoverable capitalization not implemented |
| Discounts in cost | Done | invoice `lineTotal` (net of line discount) drives the difference |
| Financial vs physical ownership | Done | consignment test |
| Month-end finalization, preview, finalized-period protection, audited reopen | Done | finalize tests |
| Costing errors register, uncosted movements, qty/value reconciliation, zero-qty/value anomalies | Done | `CostingReportingService.health` |
| Valuation (as-of), COGS, FIFO layer, health reports; drill-down to source | Done | API tests |
| Calculation runs versioned; idempotent; no duplicate adjustments on rerun | Done | idempotency tests |
| Tenant isolation; backend cost permissions (`inventory_cost.*`); audit | Done | security tests |
| Manual cost adjustment document with permission | Done (untested e2e) | `manual-cost-adjustment.service.ts` |
| Batch costing (`costByBatch`) | Done (untested e2e) | dimension resolver |
| Serial → layer traceability | Partial | serial movements produce per-unit cost rows; no specific identification |
| Characteristic dimension, standard cost, specific identification | Missing | no characteristic entity; strategy interface open for extension |
| Transit inventory account for two-step transfer | Partial | cost preserved, no separate transit GL account |
| Outbox/inbox events | Missing | synchronous in-transaction integration instead (spec 96 strict model) |
| Frontend screens (spec 83-85) | Missing | API only |

## Decisions needing the product owner

1. **Reservation default semantics** — should the default `TRY_RESERVE` policy
   check real available stock (breaking today's "soft commitment" behaviour,
   which existing tests rely on), or only `REQUIRE_FULL_RESERVATION`?
2. **Costing opt-in** — costing (and COGS/consumption/write-off GL) only runs for
   organizations with an `InventoryCostingPolicy`; should every organization
   get one by default (FIFO? WEIGHTED_AVERAGE as `AccountingPolicy` default)?
3. **FX on purchase documents** — apply the document `exchangeRate` to posted
   base amounts (affects GR/Invoice/AP postings).
4. **Unpost with consumed layers** — spec default "dependency block" is
   implemented; `RECALCULATE` is available per policy.
