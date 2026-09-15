# Cash / Kassa Engine (docx spec Phase 15)

```
Cash desk master data (Phase 1's own Cashbox, extended)
  Cashbox.cashDeskType/allowMultiCurrency/negativeBalancePolicy/
  requireDailyClose/requireDenominationCount/maxCashLimit

Layer 1 — Cash documents (the spec's own CashReceiptOrder/CashExpenseOrder,
  extended into SettlementPayment — see section A below)
  SettlementPayment (cashDeskId set) --POST--> CashMovementService.record
  CashDeskTransfer (INSTANT|TWO_STEP) --POST--> CashMovementService.record x2
  CashCountAdjustment (CASH_SURPLUS|CASH_SHORTAGE|DOCUMENT_CORRECTION|
    CASHIER_RECEIVABLE|OTHER) --POST--> CashMovementService.record
    (+ AccountablePersonMovement for CASHIER_RECEIVABLE)

Layer 2 — Cash register (immutable, spec section 14)
  CashMovementService.record/reverse/getBalance/getBalancesByCurrency
    --> CashMovement

Layer 3 — Physical control
  CashPhysicalCountService.count (denomination lines OR manual total,
    blind mode) --> CashPhysicalCount (+ CashDenominationCount/Lines)
  CashierHandoverService.initiate/resolveDifference/complete/cancel
    --> CashierHandover
  CashDailyCloseService.attempt (4 gates) / .reopen --> CashDailyClose

Layer 4 — Oversight
  CashHealthService.check (rebuildable projection, never stored)
```

## A. SettlementPayment extension, not a duplicate CashReceiptOrder/CashExpenseOrder table

Exactly the same move Phase 14 made for bank payments (see
docs/TREASURY.md section A): `SettlementPayment` now also carries
`cashDeskId`, `cashierId`, `employeeId`. When `cashDeskId` is set (and
`bankAccountId` is not — the two are mutually exclusive by convention,
never enforced at the DB level in this pass) the document IS the spec's
own `CashReceiptOrder`/`CashExpenseOrder` (spec sections 9-11), sharing
its `operationType` field for the receipt/expense operation-type lists
in spec sections 10 and 11. `employeeId` covers `EMPLOYEE_ADVANCE`/
`EMPLOYEE_ADVANCE_RETURN` without ever touching `counterpartyId` — an
accountable person is its own settlement dimension (spec section 27, see
`AccountablePersonMovement`), never forced through the counterparty-shaped
open-item tables from Phase 13.

## B. Two more standalone leaf modules, same cycle-avoidance reason as Phase 14's BankCashMovementModule

`CashMovementModule` and `AccountablePersonModule` have no dependency on
`SettlementModule` or `CashModule` themselves, so `SettlementModule` can
import them directly to give `SettlementPaymentPostingHandler` a cash leg
and an accountable-person leg without importing the whole `CashModule` (a
cycle, since `CashModule` itself imports `SettlementModule` for
`SettlementPaymentService`/`DocumentPostingService`'s payment routes).

## C. Three-way reconciliation (spec section 27 intro)

Cash register balance (`CashMovementService.getBalance`), the cashier's
physical hand (`CashPhysicalCountService`/`CashierHandoverService`), and
the GL Cash Account balance are three separate numbers that must agree,
never one blended figure. This build reconciles the first two live
(`CashHealthService`); the third — cross-checking against the posted GL
Cash Account balance itself — is left to a general-ledger reporting
service outside this phase's scope (disclosed simplification, same
boundary Treasury drew for its own GL cross-check).

## D. CashCountAdjustment dispatch and GL

One document, `adjustmentType` dispatches (spec sections 53-54,
mirroring `DebtAdjustment`'s own single-document/multi-operation shape):
- `CASH_SURPLUS` — cash INFLOW; Dr Cash / Cr `CASH_SURPLUS` mapping key
  (falls back to `OTHER_OPERATING_INCOME` if a tenant hasn't seeded it).
- `CASH_SHORTAGE` — cash OUTFLOW; Dr `CASH_SHORTAGE` mapping key (falls
  back to `OTHER_OPERATING_EXPENSE`) / Cr Cash — the shortage is written
  off as an expense.
- `CASHIER_RECEIVABLE` — cash OUTFLOW plus an `AccountablePersonMovement`
  (ISSUE-shaped) charging the shortage to a specific cashier instead of
  writing it off; GL uses `SUPPLIER_ADVANCE` as a stand-in for
  "accountable person receivable" — the same disclosed simplification
  `SettlementPaymentPostingHandler` already uses for employee advances
  (no dedicated mapping key exists yet).
- `DOCUMENT_CORRECTION` / `OTHER` — cash register movement only, no fixed
  GL shape prescribed by the spec; any ledger entry for these two is
  expected through a separate manual journal entry.

## E. CashDailyClose gates (spec sections 45-47, 76-78)

`CashDailyCloseService.attempt` never throws its way through a failed
gate — it returns the blocking status so a caller can poll "why can't I
close" freely:
1. `BLOCKED` — a cash document on this desk dated on/before the business
   date is still un-posted (checked across `CashDeskTransfer`,
   `CashCountAdjustment`, and cash-leg `SettlementPayment`).
2. `COUNT_REQUIRED` — the desk requires a denomination count
   (`Cashbox.requireDenominationCount`) and none exists for the day yet.
3. `DIFFERENCE_FOUND` — that count's difference has no posted
   `CashCountAdjustment` resolving it yet.
4. `PENDING_APPROVAL` — a `CashierHandover` on the desk is still
   `PENDING`/`DIFFERENCE_PENDING`.
Only a call that clears all four actually writes `CLOSED`. `reopen`
requires a reason (spec's own audit expectation) and clears the closed
state back to `REOPENED` without deleting the close record.

## F. CashierHandover completion gate (spec section 8)

`complete` only succeeds from `PENDING` — a `DIFFERENCE_PENDING` handover
must go through `resolveDifference` first (spec: "yalnız fərq
resolution-dan sonra complete edilə bilər"). Completing a handover ends
the outgoing cashier's active `CashierAssignment` and stamps
`closingHandoverDocumentId`.

## G. Disclosed simplifications / Phase 15 boundaries

- No dedicated `CASH_SURPLUS`/`CASH_SHORTAGE`/accountable-person-receivable
  GL accounts are required to be seeded — each falls back to an existing
  generic mapping key if unseeded (see section D).
- `DOCUMENT_CORRECTION`/`OTHER` cash-count-adjustment types post no GL
  entry automatically (see section D) — a manual journal entry is
  expected alongside them.
- The GL-Cash-Account leg of the three-way reconciliation (section C) is
  not built in this pass.
- `CashDenominationCount`/`CashDenominationCountLine` exist and are
  populated by `CashPhysicalCountService.count`, but there's no separate
  denomination-count-only workflow (e.g. an interim spot count without a
  full physical count) — denomination lines are always attached to a
  `CashPhysicalCount`.
- `CashierAssignment`'s "multiple cashiers per desk per policy" (spec
  section 6) is representable (multiple ACTIVE rows) but no policy engine
  enforces which one is "the" active cashier for a given document — left
  to the calling UI/process today.

## H. Permissions

`CASH_VIEW`, `_VIEW_ALL_DESKS`, `_ASSIGN_CASHIER`, `_CREATE_PAYMENT`,
`_POST_PAYMENT`, `_CANCEL_PAYMENT`, `_TRANSFER`, `_COUNT`,
`_CREATE_ADJUSTMENT`, `_APPROVE_ADJUSTMENT`, `_HANDOVER`, `_DAILY_CLOSE`,
`_REOPEN_DAY`, `_OVERRIDE_LIMIT` — see `rbac/permission-codes.ts`.
