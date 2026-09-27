# Counterparty Settlement Engine (docx spec Phase 13)

Module: `src/settlement/`. Builds on Phase 0 (document framework
primitives, numbering, audit), Phase 4 (Sales Invoice, tax/accounting
posting), Phase 5 (Purchase Invoice), Phase 9 (Treasury — Cash
Transaction, Payment Order/Request), and the Currency module
(`CurrencyService.resolveRate`/`recordExchangeRate`).

There was no prior scaffolding for this phase. The pre-existing
`SettlementObligation`/`SupplierPayable` rows (still written today by
`sales-invoice.posting-handler.ts`/`purchase-invoice.posting-handler.ts`)
store a mutable running `paidAmount`/`amountDue` — exactly the anti-pattern
the spec forbids (section 173: never treat an invoice's own `paid_amount`
field as the authoritative settlement record). This build adds a real
**subledger** — `SettlementMovement` as the append-only, never-updated
source of truth, with `SettlementOpenItem` as a rebuildable balance
projection over it — additively, alongside the legacy fields (never
removing or changing their existing behavior), because too many other
modules already read `SettlementObligation.status`/`SupplierPayable.status`
for a wholesale replacement to be safe within this phase's own scope.

## A. Architecture — movements are truth, open items are a projection

```
SettlementMovement (append-only, immutable, signed amount+baseAmount)
        |
        v (SettlementMovementService.applyDelta, advisory-locked)
SettlementOpenItem (one row per source document, or per OrderPaymentSchedule
                    installment when the source order has one)
        |
        v (PaymentAllocationService.allocate / autoAllocate / applyAdvance)
SettlementAllocation (links a payment, or an existing advance/credit item,
                      to the open item it settles; realized FX recorded here)
        |
        +--> SettlementOffset (AR/AP netting for one counterparty)
        +--> DebtAdjustment (write-off / increase / reclassification,
        |                    segregation-of-duties: approver != creator)
        +--> SettlementReconciliation (statement snapshot + confirmation)
```

`SettlementOpenItem` is never hand-edited outside `applyDelta` — every
balance change is a `SettlementMovement` row first, then a signed delta
applied to the item's `allocatedAmount`/`remainingAmount` (and their
`...BaseAmount` twins) inside the same DB transaction as the movement,
serialized per open item with `pg_advisory_xact_lock(hashtext(tenantId:id))`
(the same pattern `InventoryMovementService.lockStockKey` already uses for
stock — see docs/WAREHOUSE_INVENTORY.md). `remainingAmount` is allowed to
go negative: that negative balance **is** a customer/supplier credit
position (an overpaid invoice, or a return posted after full payment),
never blocked or clamped to zero.

## B. Movement creation (`settlement-movement.service.ts`)

- `createReceivable`/`createPayable` — one open item per source document,
  or one per `OrderPaymentSchedule` installment when the sales/purchase
  order behind the invoice has one (spec section 15), each installment's
  `originalAmount`/`originalBaseAmount` scaled to the *invoice's own* gross
  total (an invoice can be a partial draw against a multi-installment
  order).
- `reduceReceivable`/`reducePayable` — a sales/purchase return after the
  original invoice has (partially) settled; reduces the same open item
  rather than creating a new one, and is allowed to push `remainingAmount`
  negative (spec sections 34-37's own credit-position scenario).
- `createAdvance` — an unmatched payment (no invoice named, or an
  overpayment's excess) becomes its own `CUSTOMER_ADVANCE`/
  `SUPPLIER_ADVANCE` open item, always stored as a **positive**
  `remainingAmount` (it is money the counterparty is owed/owes back, not a
  negative receivable).
- `removeExposureFor`/`reverseMovementsFor` — used by `undoSideEffects()`
  on unpost; `hasActiveAllocations()` guards it: an invoice with a live
  allocation against it cannot be unposted (`InvoiceHasSettlementsError`)
  until that allocation is reversed first.

## C. Payment allocation & realized FX (`payment-allocation.service.ts`)

`allocate()` is the manual/system entry point (spec sections 16, 31),
called from inside the caller's own posting transaction so a payment's
own posting and its allocations commit atomically. Concurrency safety
(spec sections 137-138): the open item's advisory lock is acquired
**before** its `remainingAmount` is read, never just before the write —
otherwise two concurrent allocations could both read the same pre-lock
balance, both pass the exceeds-remaining check, and over-settle the item
once each applies its own delta.

**Realized FX** (spec sections 54-56): the open item's own *historical*
unit base rate — `originalBaseAmount / originalAmount`, frozen the moment
the item was created — decides how much of `remainingBaseAmount` this
allocation clears, never the payment's current rate. The difference
between what the payment is actually worth in base currency today (at
`CurrencyService.resolveRate` for the payment's own date) and what was
cleared at the historical rate is the realized FX gain/loss, recorded on
the `SettlementAllocation` row (`realizedFxAmount`) and mirrored as a
`FX_ADJUSTMENT` movement for traceability. No fabricated rate: if no
exchange rate is on file for the payment's date, `currentRate` falls back
to the historical rate and realized FX is zero rather than guessed.

`autoAllocate()` — FIFO by due date across a counterparty's open items,
used for a payment that doesn't name a specific invoice. `applyAdvance()`
consumes an existing advance/credit open item as the payment source
instead of a fresh payment document (`sourceOpenItemId` set on the
allocation). `reverse()`/`reverseForPaymentDocument()` — a reversal
guards against reversing an already-consumed advance (an advance applied
onward to a second invoice cannot be un-applied from the first without
first reversing the second).

**Cross-currency settlement is blocked by default** (spec section 60's own
policy option, and literally section 148's own suggested error message,
`AllocationCrossCurrencyBlockedError`) — an invoice in one currency cannot
be settled by a payment in another; no conversion path is built for that
case (as opposed to the base-currency FX conversion above, which always
runs).

## D. Offsets, debt adjustments, ageing, credit exposure, health

- **`settlement-offset.service.ts`** — nets a counterparty's own
  receivable against its own payable (spec section AR/AP offset scenario)
  via a `SettlementOffset` + `SettlementOffsetLine` document that itself
  posts through two `PaymentAllocationService.allocate()` calls (one per
  side) — no separate ledger mechanics duplicated here.
- **`debt-adjustment.service.ts`** — `DEBT_WRITE_OFF` /
  `RECEIVABLE_INCREASE`/`PAYABLE_INCREASE` / `COUNTERPARTY_TRANSFER`
  (reclassify an open item to a different counterparty). Segregation of
  duties enforced directly: `if (adj.createdBy === userId) throw
  ValidationAppError(...)` — the creator cannot also approve their own
  write-off (mirrors `PaymentOrderPostingHandler`'s executor-vs-approver
  check in Treasury).
- **`ageing.service.ts`** — due-date based (never document-date, spec
  section 68), always on the item's *remaining* balance (section 70 — a
  1,000 invoice with 600 paid ages on the 400 still outstanding), advances
  excluded entirely (section 72). Buckets: `NOT_DUE`, `1_30`, `31_60`,
  `61_90`, `91_180`, `181_365`, `OVER_365`.
- **`credit-exposure.service.ts`** — `getCurrentExposure` (open
  receivables minus open customer advances), `getAvailableCredit`
  (`creditLimit - exposure`), `validateOrderCredit` (any overdue
  receivable blocks a new order outright — spec sections 75-77). This is
  the **stable interface** Sales Pre-Order/Execution (Phases 6-7) can call
  before confirming an order; it is not wired into those modules in this
  build (spec section 172's own boundary: building the interface is this
  phase's job, consuming it from Phase 6/7 is a follow-up).
- **`settlement-health.service.ts`** — computed live, never a stored
  issues table. Flags a negative remaining on a non-advance item (info —
  a credit position), a negative remaining on an advance (error —
  over-applied), a `SETTLED` item with a non-zero residual base amount
  (warning — FX/rounding), a missing due date, more than one open item for
  the same source document/schedule line (error — duplicate), and a
  payment sitting unallocated for 90+ days. **Disclosed gap**: the
  spec's AR/AP-vs-GL balance check (section 110) is a placeholder
  returning no issues — it needs a per-dimension GL balance query
  Accounting Core does not expose yet.
- **`settlement-reconciliation.service.ts`** / `SettlementReconciliation`
  — a per-counterparty statement snapshot (opening balance + movements in
  period + closing balance) that can be `confirm`ed, matching
  `settlement-reporting.service.ts`'s `statement()` engine used for the
  live, unconfirmed report.

## E. Posting-handler hooks (additive, existing behavior untouched)

Each hook runs inside the document's own posting/unposting transaction,
right alongside the legacy `SettlementObligation`/`SupplierPayable`
writes it does not replace:

| Document | Hook |
|---|---|
| `SalesInvoicePostingHandler` | `createReceivable()` after the legacy obligation write; `undoSideEffects()` checks `hasActiveAllocations()` then `removeExposureFor()` |
| `PurchaseInvoicePostingHandler` | mirror, `createPayable()` |
| `SalesReturnPostingHandler` | `reduceReceivable()` when `originalSalesInvoiceId` is set; `undoSideEffects()` calls `reverseMovementsFor()` |
| `PurchaseReturnPostingHandler` | mirror, `reducePayable()`, only for the post-invoice portion of the return |
| `CashTransactionPostingHandler` | `allocateToDocument()` when an invoice is named, else `createAdvance()`; `undoSideEffects()` calls `reverseForPaymentDocument()` |
| `PaymentOrderPostingHandler` | loops its own already-computed per-invoice split (`invoiceAmounts`) calling `allocateToDocument()`, plus `createAdvance()` for any unmatched remainder. **Gap inherited from the base handler**: it has no `undoSideEffects()` at all (pre-existing, left as-is for parity) |

All five resolve the tenant's true base currency the same way:
`organization.baseCurrencyId ?? tenant.baseCurrencyId ?? <document's own
currency>` — the fallback to the document's own currency only applies
when *neither* the organization nor the tenant has one configured, in
which case no FX conversion is possible or attempted.

## F. Disclosed simplifications

- **GL posting for realized FX** is not built — `realizedFxAmount` is
  computed and stored for reporting/traceability, but no accounting
  batch line exists for it yet (the existing payment posting handlers
  have no FX-aware GL path today; spec section 61's rate resolution and
  section 103's GL integration are future work).
- **Cross-currency settlement** is blocked outright rather than
  supporting an explicit conversion-at-allocation-time policy (section
  60's second option).
- **AR/AP-vs-GL reconciliation** in `SettlementHealthService` is a
  placeholder (section D above).
- **Credit exposure** is a callable interface only — Sales Pre-Order/
  Execution do not call it yet (section D above).
- **`BATCH_CORRECTION`/`SERIAL_CORRECTION`**-style bespoke documents are
  not relevant to this phase; noted here only because the same
  "reuse an existing document type rather than invent a fourth" principle
  from Phase 12 (docs/INVENTORY_COUNT.md) applies to the offset/debt-
  adjustment split above.

## G. API surface

```
GET        /organizations/:orgId/settlements/open-items
GET        /organizations/:orgId/settlements/open-items/:id
GET        /organizations/:orgId/settlements/balances/:counterpartyId
GET        /organizations/:orgId/settlements/customer-ageing
GET        /organizations/:orgId/settlements/supplier-ageing
GET        /organizations/:orgId/settlements/advances
GET        /organizations/:orgId/settlements/unallocated-payments
GET        /organizations/:orgId/settlements/reports/open-receivables
GET        /organizations/:orgId/settlements/reports/open-payables
GET        /organizations/:orgId/settlements/reports/overdue-debt
GET        /organizations/:orgId/settlements/reports/statement/:counterpartyId
GET        /organizations/:orgId/settlements/reports/debt-movement/:counterpartyId
GET        /organizations/:orgId/settlements/credit-exposure/:customerId
GET        /organizations/:orgId/settlements/health

GET/POST   /organizations/:orgId/settlements/allocations[/auto|/:id/reverse|/apply-advance]
GET/POST   /organizations/:orgId/settlements/offsets[/:id/post]
GET/POST   /organizations/:orgId/settlements/debt-adjustments[/:id/approve|/:id/post]
GET/POST   /organizations/:orgId/settlements/reconciliations[/:id/confirm]
```

## H. Tests

`test/settlement.e2e-spec.ts` covers the spec's own listed scenarios
(sections 149-170): basic receivable + full payment, partial payment,
multiple payments accumulating to zero, one payment auto-allocated FIFO
across multiple invoices, customer and supplier advances (including
partial application of an advance against a later invoice), overpayment
becoming a customer advance, a sales return after full payment producing
a credit position, AR/AP offset, write-off (segregation of duties: the
creator's own self-approval is rejected, a second user approves), due-
date ageing (only the remaining balance ages, `OVER_365` bucket), realized
FX on both a full and a partial foreign-currency payment, concurrent
allocation safety (two simultaneous over-allocation attempts against the
same open item — exactly one succeeds), invoice-unpost dependency (blocked
while an allocation is active), counterparty reconciliation (statement
closing balance matches the register), and tenant isolation.

## I. A pre-existing numbering bug this phase's tests surfaced

`NumberingService.allocateNumber` (`src/numbering/numbering.service.ts`,
pre-existing, not specific to this phase) unconditionally overwrote its
sequence row's `current_year`/`current_month` with whatever business date
it was asked to allocate for — including a **backdated** document (an
invoice or payment dated earlier than the highest period already
allocated). That regressed the recorded period backward, so the very next
chronologically-later allocation saw a stale `current_year` and reset its
counter back to 1, colliding with a number already handed out for that
period (`Unique constraint failed on the fields: (tenant_id, number)`,
surfaced here by the Ageing test's intentionally old `2020-01-01` invoice
followed by a `2026-01-01` invoice in the Realized FX test). Fixed to only
ever advance the recorded period forward — a backdated allocation still
consumes the next running number (so numbers stay unique) but never moves
`current_year`/`current_month` backward. Normal chronological posting is
unaffected (verified against the full e2e suite).
