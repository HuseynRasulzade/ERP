# Treasury / Bank Operations (docx spec Phase 14)

Module: `src/treasury/`. Builds on Phase 0 (numbering, audit, approval
framework), Phase 4 (posting engine), Phase 9 (Purchase Invoice/
SupplierPayable), and Phase 13 (Settlement Subledger — never duplicated
here, only called into).

A prior build already shipped the core payment chain — `PaymentRequest`
(plain CRUD), `PaymentOrder` (full document-framework participant, FINANCE
approval, posting IS the "Bank Ödənişi" event, a lightweight `reconcile()`
action), `CashTransaction` (cashbox receipt/payment), `Bank`/`BankAccount`
master data, and `BankStatementLine` (manual entry + CSV import +
PaymentOrder-only matching) — see each file's own doc comments for that
half. This build adds everything the spec's three-layer architecture
(section 1) still needed: PaymentRequest's own amount-tier approval +
amount control + partial execution, the bank-side documents that didn't
exist yet (money coming IN via bank, internal transfers, bank fees, FX
conversion), a formal reconciliation period-close on top of the existing
line-matching, and the Treasury Plan layer (payment calendar, liquidity
forecast, health) that had no equivalent before.

## A. The three layers (spec section 1) — never merged into one document

```
Layer 1 — Treasury Plan (planning; never touches bank balance)
  PaymentRequest (+ its own amount-tier approval, PaymentRequestApprovalPlanProvider)
  PaymentCalendarService, LiquidityForecastService, TreasuryHealthService

Layer 2 — Bank Reality (what actually happened to the bank account)
  PaymentOrder (existing, outflow)         IncomingBankPayment (new, inflow)
  InternalBankTransfer (new)               BankFee (new)
  FXConversion (new)                       BankStatementLine + BankReconciliation

Layer 3 — Settlement Allocation (Phase 13, untouched, only called into)
  SettlementMovement / SettlementOpenItem / SettlementAllocation
```

Every Layer 2 document that clears a specific customer/supplier invoice
calls into Phase 13's `PaymentAllocationService`/`SettlementMovementService`
exactly the way `PaymentOrder`/`CashTransaction` already did — no second
allocation mechanism was built.

## B. PaymentRequest: amount-tier approval + amount control + partial execution

**Approval** (spec sections 11-13) reuses the same generic
`ApprovalService`/`ApprovalPlanProvider` framework `PaymentOrder`'s FINANCE
step already uses (docs/APPROVALS.md) — no second approval engine.
`PaymentRequestApprovalPlanProvider` reads `TreasuryPaymentApprovalRule`
rows (tenant/organization/category/amount-range → `ApprovalStepType`,
reusing the existing shared enum's `DEPARTMENT_HEAD`/`FINANCE`/`DIRECTOR`
values as stand-ins for the spec's "Department Manager"/"Finance
Manager"/"CFO" tiers — disclosed substitution) and plans that many steps
in sequence. **A tenant with zero rows configured plans zero steps**
(`NOT_REQUIRED`), so every pre-existing zero-config PaymentRequest flow
(including every earlier-phase test) keeps working completely unchanged —
configuring rows is what turns the gate on, never a migration-time
default. This is a deliberate reading of spec section 12's "Rules
hard-coded olmamalıdır": the *ladder* is configurable, but there is no
hardcoded always-on default ladder either, since that would have broken
every existing single-approver PaymentOrder flow.

**Amount control** (spec section 10 — requested/approved/planned/executed,
never conflated): `amount` is the requested amount; `approvedAmount` is
set once the approval chain clears — via `PaymentRequestService.approve(id,
approvedAmount?)`, which may be **less** than requested (partial approval,
recorded only at the point the WHOLE chain finishes, matching the spec's
own worked example: "Finance Manager approves 15,000 only"); `plannedAmount`
mirrors it once approved; **`executedAmount` is never stored** — always
computed live from this request's own linked, POSTED `PaymentOrder` rows
(spec section 7: "PAID status source bank payments-dən hesablanmalıdır").

**Partial execution** (spec section 72): a request's `status` no longer
flips to `FULFILLED` the moment the first `PaymentOrder` is created against
it — `PaymentOrderService.create()` now computes `committed` (the sum of
every non-cancelled order already raised against this request) and only
blocks a new order when `committed + newAmount` would exceed the
`approvedAmount` cap, marking `FULFILLED` only once that cap is fully
committed. Concurrency safety (spec sections 111, 171): an advisory
transaction lock on `tenantId:paymentRequestId` is acquired **before**
reading `committed`, so two concurrent orders against the same request can
never jointly over-commit it — one of `{7,000 + 6,000}` against a 10,000
cap is rejected, matching the spec's own test 111/171.

## C. Bank Reality — the new documents

Each is a full document-framework participant (its own repository +
posting handler), mirroring `PaymentOrder`'s shape:

- **`IncomingBankPayment`** (spec section 28) — the bank-side counterpart
  of `CashTransaction`'s RECEIPT direction (which is cashbox-only).
  Posting: Dr Bank / Cr AR (CUSTOMER_PAYMENT/CUSTOMER_ADVANCE) or a P&L
  income account otherwise; hooks into Phase 13's `allocateToDocument`/
  `createAdvance` exactly like `CashTransaction` does. Has `undoSideEffects`
  for symmetric unpost.
- **`InternalBankTransfer`** (spec sections 57-60) — moves money between
  two of the tenant's own bank accounts; never a customer/supplier
  settlement. **Disclosed simplification**: posted as a single atomic event
  (`transferState` defaults straight to `COMPLETED`) rather than the
  spec's own optional `INITIATED → DEBITED → IN_TRANSIT → CREDITED`
  multi-day timing split (spec sections 59, 168) — the schema field exists
  for a future increment to use, but the two-step timing logic itself was
  not built. The transfer fee (if any) is booked to its own expense
  account, kept separate from the principal (spec section 60).
- **`BankFee`** (spec section 54) — Dr Bank Expense / Cr Bank, plus a flat
  manual tax amount when recorded. **Disclosed simplification**: no full
  Tax Engine resolution for a bank commission line (overkill for this
  case) — just an optional `taxAmount` field.
- **`FXConversion`** (spec sections 61-63) — a currency exchange between
  two of the tenant's own bank accounts, **deliberately separate from
  Phase 13's realized settlement FX** (spec section 63: "Treasury FX vs
  Settlement FX — bunları qarışdırma") — its own `BANK_FX_GAIN`/
  `BANK_FX_LOSS` mapping keys, computed against an optional `officialRate`
  (no fabricated rate when none is given — the trade rate is then trusted
  outright, zero gain/loss booked). Never creates a settlement allocation.

## D. Bank statement matching, now multi-document-type

`BankReconciliationService.match()`/`suggestMatches()` (pre-existing,
`PaymentOrder`-only) now resolve a candidate's expected `(bankAccountId,
signed amount)` generically across `PAYMENT_ORDER` (outflow),
`INCOMING_BANK_PAYMENT` (inflow), `BANK_FEE` (outflow), and
`INTERNAL_BANK_TRANSFER`/`FX_CONVERSION` (either leg, resolved by which
bank account the statement line itself belongs to) — one function
(`resolveMatchCandidate`/`resolveTwoLegCandidate`), not five copy-pasted
branches. Concurrency safety (spec section 112, test 172): matching now
runs inside a transaction holding an advisory lock on the statement
line's own id for its whole duration — the lock **must** be held across
the read-check-write, not just the initial acquisition, since
`pg_advisory_xact_lock` releases at COMMIT; a standalone `$executeRaw`
call outside a transaction would auto-commit and release it immediately
(a bug this build found and fixed while writing the concurrency test).

**Unmatched-line classification** (spec sections 48, 55, 122): a
fee-like description (`FEE`/`COMMISSION`/`MAINTENANCE`/Azerbaijani
equivalents — deterministic regex rules only, spec section 123's own "AI
boundary": Phase 14 is rules + score foundation, Phase 29 is where ML
suggestion lives, and it must never bypass this rule engine) surfaces a
`suggestedClassification: 'BANK_FEE'` hint from `suggestMatches()`;
confirming it via `classifyAsBankFee()` creates (but does not
auto-post — post it through the generic `/documents/BANK_FEE/:id/post`
endpoint like any other document) the `BankFee` and marks the line
`MATCHED` against it. Never silently ignored.

## E. Bank Reconciliation period close (new, layered on top)

`BankReconciliation` (spec sections 49-51, 95-99) is a formal per-bank-
account/per-period checkpoint **on top of** `BankStatementLine`'s existing
line-level matching — never a second, parallel matching mechanism.
`refresh()` recomputes book/bank closing balances and the difference from
that period's own statement lines and PERSISTS the result as a new
version; `close()` recomputes the SAME numbers itself (a private
`computeBalances()` shared by both, so `close` never accidentally bumps
the row's version out from under the caller's own `expectedVersion` by
calling `refresh` internally — a real bug this build found and fixed)
purely to validate, then persists CLOSED with those exact numbers in the
same write. Close is blocked unless every line in the period is `MATCHED`
and the difference is within a 0.01 tolerance (spec section 95).
`reopen()` requires a mandatory reason and is itself audited (spec section
152). **Disclosed simplification**: the "executor ≠ reconciliation closer"
segregation-of-duties check (spec section 106) is not enforced — only a
mandatory-reason/audit trail on reopen.

## F. Treasury Plan — calendar, liquidity forecast, health

- **`PaymentCalendarService`** (spec sections 14-17) — a live, rebuildable
  projection (never a stored table, same principle as
  `SettlementOpenItem`), never a source of actual cash movement (spec
  section 22). Planned outflows come from `PaymentRequest` (approved or
  not-requiring-approval, still short of its approved cap); planned
  inflows reuse Phase 13's own open receivables' due dates — **never
  duplicated** as a second AR projection.
- **`LiquidityForecastService`** (spec sections 19-22, 76-78, 115) —
  Current Bank Balance and Projected Balance are always shown separately
  (spec section 22). The book balance is computed from the immutable
  `RegisterMovement` ledger under `BANK_CASH_MOVEMENT_REGISTER` (spec
  sections 30-31, 156) — never a mutable "current balance" field, the
  same Stock-Truth-Engine principle Warehouse/Stock already uses.
  `TreasuryLiquidityPolicy` rows (bank-account-specific beats
  currency-wide beats tenant-wide, most-specific-wins) provide the
  minimum buffer a cash-gap alert compares the projected closing balance
  against; `BankAccount.overdraftAllowed`/`overdraftLimit` (new, optional
  fields) feed "Available Liquidity" when set.
- **`TreasuryHealthService`** (spec sections 141-142) — computed live,
  never stored. Flags an overdue approved request still short of fully
  executed, a statement line unmatched for 14+ days, a reconciliation
  still `DIFFERENCE_FOUND`, and a gap between two reconciliation periods
  for the same bank account (spec section 98). **Disclosed gap**: the
  full Bank-vs-GL health engine (spec section 143) is Phase 30's job —
  this only surfaces the discrepancy data that phase will need.

## G. Disclosed simplifications

- **Payment Instruction as a separate document** (spec sections 23-25) is
  not built — `PaymentOrder` already folds "Bank Ödənişi" into its own
  posting event (a pre-existing simplification this build did not
  revisit, since undoing it would ripple through every existing
  PaymentOrder test).
- **InternalBankTransfer's in-transit timing split**, **BankFee's flat tax
  amount instead of full Tax Engine resolution**, and **no
  "executor ≠ reconciliation closer" segregation-of-duties check** — see
  sections C/E above.
- **MT940/CAMT.053/bank-specific statement formats** — only the
  pre-existing generic CSV importer exists; no bank-native parser was
  added (spec section 36 lists CSV as one acceptable format among
  several).
- **One-to-many/many-to-one composite statement matching** (spec sections
  45-46) — only 1:1 matching is supported, per document leg.
- **Forecast versioning** (v1/v2/actual comparison, spec section 83) — not
  built; Plan vs Actual is always computed live against the current state.
- **Credit-line/loan management** (spec section 116) — out of scope per
  the spec's own boundary; only `overdraftAllowed`/`overdraftLimit` exist
  as plain `BankAccount` fields.
- **A duplicate-suggestion guard for `IncomingBankPayment`/`BankFee`
  candidates already matched to another line** — `suggestMatches()`
  filters `PaymentOrder` candidates by its own `reconciled` flag, but
  `IncomingBankPayment`/`BankFee` have no equivalent flag, so a document
  already matched elsewhere could theoretically be suggested again (the
  actual `match()` call itself is still safe — a line can only be matched
  once, and nothing stops two DIFFERENT lines from being manually matched
  to the same document, which the spec does not forbid either).

## H. A pre-existing bug this build's tests surfaced and fixed

`PaymentAllocationService.autoAllocate()` (Phase 13, `src/settlement/`)
queried open items with **no `orderBy` at all** before sorting them by its
own FIFO strategy — since a JS stable sort preserves whatever order ties
arrive in, and Postgres never promises row order without an explicit
`ORDER BY`, two open items with the same due/source date could return in
either order depending on incidental physical row layout. This passed
"by accident" until this phase's own extensive test runs grew the shared
test database enough to change the query planner's behavior, at which
point `test/settlement.e2e-spec.ts`'s own FIFO test started failing.
Fixed by adding an explicit `orderBy: [{ sourceDate: 'asc' }, { createdAt:
'asc' }]` — the real, deterministic tiebreaker `sortByStrategy`'s
comparator was always missing.

## I. API surface

```
GET/POST   /organizations/:orgId/payment-requests[/:id/cancel|/:id/approve|/:id/reject]
GET/POST   /organizations/:orgId/payment-orders[/:id/approve|/:id/reject|/:id/reconcile|...]  (existing)
GET/POST   /organizations/:orgId/incoming-bank-payments[/:id]
GET/POST   /organizations/:orgId/internal-bank-transfers[/:id]
GET/POST   /organizations/:orgId/bank-fees[/:id]
GET/POST   /organizations/:orgId/fx-conversions[/:id]
GET/POST   /organizations/:orgId/bank-statement-lines[/import|/:id/suggestions|/:id/match|/:id/classify-as-fee]
GET/POST   /organizations/:orgId/bank-reconciliations[/:id/refresh|/:id/close|/:id/reopen]
GET        /organizations/:orgId/treasury/payment-calendar
GET        /organizations/:orgId/treasury/liquidity-forecast
GET        /organizations/:orgId/treasury/health
GET/POST/DELETE /organizations/:orgId/treasury/liquidity-policies[/:id]
GET/POST/DELETE /organizations/:orgId/treasury/approval-rules[/:id]
```

## J. Tests

`test/treasury.e2e-spec.ts` (pre-existing) covers the core
Purchase-Invoice → PaymentRequest → PaymentOrder chain, its FINANCE
approval, segregation of duties, and reconciliation.
`test/treasury-bank-operations.e2e-spec.ts` (new, 16 tests) covers
everything this phase added: incoming bank payment posting (named
invoice + unnamed advance), internal transfer with a separately-booked
fee (+ same-account rejection), bank fee posting, FX conversion (gain vs.
an official rate, currency-mismatch rejection, never a settlement),
multi-document-type statement matching (inflow, outflow, unmatched-line
classification, concurrent-match safety), bank reconciliation period
close/reopen (blocked while a line is unmatched, mandatory reopen
reason), the payment-request amount-tier approval ladder with partial
approval and partial multi-order execution (plus its own concurrency
test), payment calendar + liquidity forecast + cash-gap detection,
treasury health, and payment-order reversal (unposting fully reverses
the settlement allocation and the legacy SupplierPayable paidAmount).
