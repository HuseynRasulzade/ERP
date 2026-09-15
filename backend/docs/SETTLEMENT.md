# AR/AP Settlement Engine (docx spec Phase 13)

A counterparty settlement subledger — commercial document (SalesInvoice)
vs settlement obligation (SettlementObligation/SupplierPayable, real open
items as of this phase) vs payment (SettlementPayment) vs allocation
(SettlementAllocation, the link) vs accounting entry (Phase 4
JournalEntry) are kept as separate concepts throughout (spec section 3).

## A. Architecture

```
SalesInvoice / PurchaseInvoice (POST)
   │ OpenItemService.createReceivable/createPayable
   ▼
SettlementObligation / SupplierPayable (open item, PROJECTION)
   │                                    ▲
   │ SettlementMovementService.record   │ rebuilt from
   ▼                                    │
SettlementMovement (immutable register, spec section 4) ◄──────────────┐
   ▲                                                                    │
   │ PaymentAllocationService.allocateManual/allocateAutomatic          │
SettlementPayment (POST) ──► SettlementAllocation ──applies to──► open item
   │                                                                    │
   │ AdvanceService.createFromUnallocatedPayment / .apply               │
   ▼                                                                    │
SettlementAdvance ───────────────────────────────────────────────────────┘

SalesReturn/PurchaseReturn (POST) ──► OpenItemService.reduceForReturn
DebtAdjustment (POST) ──► OpenItemService.createReceivable/Payable/applyToOpenItem
SettlementOffset (POST) ──► OpenItemService.applyToOpenItem (both sides)
```

`SettlementObligation`/`SupplierPayable` are the SAME tables Sales/Purchase
Execution already had (spec section 2's own "don't duplicate") — extended
here with real `allocatedAmount`/`remainingAmount`/`status` fields instead
of the pre-Phase-13 build's permanent `NOT_PAID`/`OPEN` placeholder.
`SettlementMovement` is the new, single authoritative register everything
else is a rebuildable projection of (spec section 6).

## B. Payment adapter boundary (spec sections 84-85)

`SettlementPayment` is a minimal, bank/cash-agnostic payment document —
Phase 14 (bank)/15 (cash) are expected to supersede or wrap it with real
treasury execution. It always posts against the `CUSTOMER_ADVANCE`/
`SUPPLIER_ADVANCE` clearing account, never directly against AR/AP (spec
sections 105-106); `PaymentAllocationService`/`AdvanceService` post the
reclassification into the real AR/AP account only for however much is
actually allocated, via `AccountingPostingEngine.postBatch` called
directly (not through a `DocumentPostingHandler` — an allocation is a
service action, not itself a document post).

## C. Realized FX (spec sections 54-56)

Only computed when the payment and the open item share the same
transaction currency: `realizedFx = settledAmount × (paymentRate −
openItemRate)`, both rates frozen at their own document's post time
(never today's rate). Booked to `OTHER_OPERATING_INCOME`/`_EXPENSE` (no
dedicated FX gain/loss mapping key in this build — disclosed
simplification). Cross-currency settlement is policy-gated
(`SettlementPolicy.allowCrossCurrencySettlement`) and, when allowed,
booked at face value with no computed FX line — full cross-currency
precision is out of this pass's scope.

## D. Returns and the GL/subledger edge case (spec sections 34-37, 156-157)

`OpenItemService.reduceForReturn` reduces the original invoice's open
item(s) up to what is still open, and diverts any EXCESS into a new
`SettlementAdvance` (spec section 35's "customer artıq ödəyib, return
credit yaradır" case) — this is exact in the subledger. The EXISTING
Sales/Purchase Return posting handlers' own GL entry (Phase 7/9,
untouched by this phase) always credits/debits AR/AP the full return
amount regardless of how much was actually open. In the overpaid-then-
returned edge case this means the GL's AR balance can briefly diverge
from the subledger's own total until a manual `DebtAdjustment` reclass is
posted — `SettlementHealthService` surfaces this rather than it being
silently hidden. Rewiring Phase 7/9's own tested GL shape was out of
scope for this pass.

## E. Offset (spec sections 41-44)

`SettlementOffset` has a SINGLE `counterpartyId` field — cross-counterparty
netting is blocked by construction, not a runtime check (spec section
43's default). Every line's open item must belong to that same
counterparty (validated in `SettlementOffsetService.create`).

## F. Universal DebtAdjustment (spec sections 38-40)

Credit notes, debit notes, write-offs, and reclassifications are ONE
document type dispatched by `operationType` — the same consolidation
convention this codebase already applies to Phase 10's InventoryAdjustment.
`COUNTERPARTY_TRANSFER` is blocked outright (spec section 97) — no
controlled-transfer procedure is built in this pass.

## G. Ageing (spec sections 68-74)

Computed per OPEN ITEM (never invoice total) from `remainingAmount` +
`dueDate` — a payment-schedule invoice naturally ages each installment
separately since each is its own `SettlementObligation` row (this build
creates one open item per invoice; multi-installment payment-schedule
open items are a `sourceDocumentLineId`-keyed extension point the schema
supports but this pass's invoice posting handlers don't yet split into).
Advances are never included in ageing (spec section 72) — a completely
separate query surface (`AdvanceService.listUnapplied`).

## H. Disclosed simplifications / Phase 13 boundaries (spec section 172)

- Only `BY_DOCUMENT` settlement dimension mode has real behavior;
  `BY_CONTRACT`/`BY_ORDER`/`BY_AGREEMENT`/`BY_PAYMENT_SCHEDULE`/
  `GENERAL_BALANCE` are stored on `SettlementPolicy` but resolve to the
  same BY_DOCUMENT open-item behavior underneath.
- No installment/payment-schedule-line-level open item splitting yet
  (spec sections 15, 71, 162) — one open item per invoice today; the
  schema (`sourceDocumentLineId`, `paymentScheduleLineId`) is ready for a
  follow-up that splits at invoice-posting time.
- No persisted `settlement_reconciliation_lines`/
  `settlement_balance_snapshots`/`settlement_disputes` tables —
  reconciliation lines and health issues are computed live from
  `SettlementMovement` (same pattern as Phase 11/12's own health
  reports); dispute state lives on the open item's own `disputedAmount`/
  `collectionStatus` fields.
- No `settlement_policies`-driven auto-allocation strategy besides
  `FIFO_BY_DUE_DATE` — other named strategies (spec section 28) fall back
  to it.
- Cross-currency settlement, when policy-allowed, is booked at face value
  with no true multi-currency conversion precision.

## I. Permissions

`SETTLEMENT_VIEW`, `_VIEW_ALL`, `_ALLOCATE`, `_AUTO_ALLOCATE`,
`_REVERSE_ALLOCATION`, `_APPLY_ADVANCE`, `_CREATE_ADJUSTMENT`,
`_APPROVE_ADJUSTMENT`, `_WRITE_OFF`, `_OFFSET`, `_RECONCILE`, `_VIEW_FX`,
`_OVERRIDE_FX`, `_VIEW_ACCOUNTING`, `_OVERRIDE_CONTRACT`,
`_PERIOD_OVERRIDE` — see `rbac/permission-codes.ts`.

## J. Internal API for other modules (spec section 147)

`CreditExposureService.getCurrentExposure/getAvailableCredit/validateOrderCredit`
is the interface Phase 6/7 (order/shipment confirmation) are meant to
call before committing a new customer order. `SettlementMovementService.getBalanceAsOf`
answers spec section 92's `getSettlementBalance(asOfDate, ...)` requirement.
`AgeingService.customerAgeing/supplierAgeing` back Phase 24's overdue/
profitability analytics. `SettlementHealthService.check`/`subledgerTotals`
back Phase 30's Accounting Health suite.
