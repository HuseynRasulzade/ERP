# Cash Desk Engine (docx spec Phase 15)

Module: `src/cash-desk/`. Extends the existing `Cashbox`/`CashTransaction`
foundation from Phase 14 (`src/treasury/`) rather than duplicating it —
`cashbox.service.ts`'s own doc comment already deferred "cash movements
and balances" to this phase. No new `CashReceiptOrder`/`CashExpenseOrder`
document types were built; `CashTransaction` already IS the receipt/
expense document, extended with the fields and posting-time control this
phase adds.

## A. What already existed vs. what this build adds

Phase 14 shipped `Cashbox` (master data) and `CashTransaction` (a
document-framework participant that posts Dr Cash/Cr contra or the
reverse). This build extends both:

- `Cashbox`: `cashDeskType`, `negativeBalancePolicy` (default `NEVER`),
  `requireDailyClose`, `requireDenominationCount`, `maxCashLimit`.
- `CashTransaction`: `cashierId` (validated against `CashierAssignment` at
  posting, opt-in), `employeeId` (required for
  `EMPLOYEE_ADVANCE`/`EMPLOYEE_ADVANCE_RETURN`), and the category enum
  broadened from 4 values to the full spec catalog (18 categories:
  advances, salary, petty cash, shortage/surplus, loans, owner
  contribution, refunds, bank transfers).

New: `CashBalanceService` (the one authoritative live book-balance
reader), `CashierAssignmentService`, `AccountablePersonService`,
`CashDeskTransfer`, `CurrencyDenomination`, `CashPhysicalCount` +
`CashDenominationCountLine`, `CashCountAdjustment`,
`CashDeskDailyCloseService`, `CashierHandoverService`, `CashHealthService`,
`CashReportingService`.

## B. Book balance is always live, never a mutable field (spec section 15)

`CashBalanceService.getBookBalance(tenantId, cashboxId, asOfDate)` reduces
`RegisterMovement` rows under `CASH_MOVEMENT_REGISTER` — the exact same
Stock Truth Engine principle Phase 10 established for inventory and
Phase 14 reused for bank balances. `Cashbox` has no `balance` column at
all; every cash-affecting document (`CashTransaction`, `CashDeskTransfer`,
`CashCountAdjustment`) writes its own movement there via
`DocumentPostingHandler.buildMovements`, never a direct field write.

## C. Negative-balance control, concurrency-safe (spec sections 17-18)

`CashTransactionPostingHandler`/`CashDeskTransferPostingHandler` block a
cash outflow that would drive a `NEVER`-policy cashbox negative. The
check is concurrency-safe the same way Phase 14's bank-statement matching
had to be fixed to be: `CashBalanceService.lockCashbox()` (a
`pg_advisory_xact_lock`) is acquired **first**, inside the posting
transaction, before the balance is read — so two concurrent expenses can
never both pass the check and jointly overdraw the desk. This was a
lesson already learned once this session (Phase 14's `BankReconciliationService.match()`
originally called the lock via a standalone `$executeRaw` outside any
transaction, which auto-commits and releases the lock immediately,
defeating it) and applied proactively here from the start.

`ALLOWED`-policy cashboxes are permitted to go negative — the check is
skipped entirely for them.

## D. Cashier assignment (spec sections 6-7)

`CashierAssignment` records who may operate a cash desk within a date
range; multiple concurrent assignments to the same desk are allowed (no
exclusivity enforced, only existence). Enforcement at posting is opt-in:
`CashTransactionPostingHandler.validateForPosting` only checks
`CashierAssignmentService.hasActiveAssignment` when the document itself
sets `cashierId` — omitting it entirely skips the check, so every
pre-Phase-15 `CashTransaction` flow keeps working unchanged.

## E. Employee advances — Accountable Person balance (spec sections 27-32)

There is no separate `Employee` entity in this codebase; `ResponsiblePerson`
(already used for department/warehouse/branch/cashbox "responsible
person" roles) is reused as the accountable person. `AccountablePersonMovement`
is an append-only ledger (`ADVANCE_ISSUED` / `RETURNED` / `EXPENSE_REPORTED`
/ `ADDITIONAL_REIMBURSEMENT`), exactly mirroring Phase 13's
`SettlementMovement`/`SettlementOpenItem` principle: outstanding balance
is always the live sum of a person's own movements, never a mutable
field. `EMPLOYEE_ADVANCE`/`EMPLOYEE_ADVANCE_RETURN` cash transactions post
Dr/Cr the `ACCOUNTABLE_PERSON_RECEIVABLE` mapping key (account `244`,
"Təhtəlhesab məbləğlər" — a direct match in the AZ standard chart) with an
`EMPLOYEE` dimension, and record the matching movement in the same
posting transaction. Reversible on unpost, same as every other side
effect in this codebase.

No expense-report or payroll-deduction workflow was built (spec sections
29/59 mention both) — only the advance/return pair and the ledger/ageing
read model (`AccountablePersonService.ageing`) exist; a later phase's job.

## F. Cash-to-cash transfer (spec section 8)

`CashDeskTransfer` mirrors `WarehouseTransfer`'s own INSTANT/TWO_STEP
pattern (Phase 10) exactly, applied to cash instead of stock:

- **INSTANT**: posting IS the whole transfer — one register movement out
  of the source desk and one into the destination desk, one GL entry (Dr
  destination cash / Cr source cash, same `CASH` account, different
  `CASHBOX` dimension), `transferState` goes straight to `RECEIVED`.
- **TWO_STEP**: posting only ships — the source desk is debited
  immediately (Cr Cash) but the money sits in `CASH_IN_TRANSIT` (account
  `222`) until the bespoke `receive()` action moves some/all of it into
  the destination desk's own balance (Dr Cash / Cr `CASH_IN_TRANSIT`).
  `receive()` supports partial receipts across multiple calls.

**The duplicate-journal-entry problem, solved by a suffixed
`sourceDocumentId`**: `AccountingPostingEngine.postBatch()` only allows
ONE active journal entry per `(sourceDocumentType, sourceDocumentId)`
pair. A TWO_STEP transfer's `receive()` action posts a *second* entry for
the same document — using the plain document id would collide with the
initial ship-side entry's own guard. Each `receive()` call instead posts
under `` `${transfer.id}:RECEIVE:${n}` `` (`n` counted from prior receive
entries for this transfer), so repeated partial receives never collide
with each other or with the ship-side entry. Unposting is blocked once
any receive has happened (`PARTIALLY_RECEIVED`/`RECEIVED`), the same
`TransferUnpostBlockedError` `WarehouseTransfer` already uses.

## G. Physical count -> adjustment resolution chain (spec sections 47-59)

`CashPhysicalCount` snapshots the live book balance at `start()`, then
`submitLines()` records the counted `CashDenominationCountLine` rows and
derives `physicalBalance`/`difference` **from those lines** (never a
typed-in total) — `physicalBalance = Σ(faceValue × quantity)`. `approve`/
`reject` are the only state transitions after submission.

A non-zero difference is resolved **only** through a `CashCountAdjustment`
— never a silent edit of the register or the count row itself (`countId`
is unique: one adjustment per count). Adjustment types:

- `CASH_SURPLUS` (physical > book): Dr Cash / Cr `CASH_SURPLUS_INCOME` (611).
- `CASH_SHORTAGE` (physical < book): Dr `CASH_SHORTAGE_LOSS` (731) / Cr Cash.
- `CASHIER_RECEIVABLE`: the shortage is charged to a named
  `ResponsiblePerson` instead of expensed — Dr `ACCOUNTABLE_PERSON_RECEIVABLE`
  (244, dim `EMPLOYEE`) / Cr Cash, and records an `AccountablePersonMovement`
  so it ages alongside employee-advance receivables. No payroll-deduction
  wiring (spec section 59) — a later phase's job.
- `DOCUMENT_CORRECTION` / `OTHER`: same Dr/Cr shape as surplus/shortage,
  sign-agnostic, for a difference that isn't a real till count issue.

`BLIND` vs `OPEN` count method is stored as recorded, but this build does
not withhold `bookBalance` from the API response during a `BLIND` session
— hiding it is a client-side/UI concern, not a data-model one.

## H. Daily close and cashier handover (spec sections 60-72)

`CashDeskDailyCloseService` is the cash-side mirror of Phase 14's
`BankReconciliationPeriodService`: `refresh()` recomputes opening/closing
book balances and totals from `CASH_MOVEMENT_REGISTER` and derives a
status (`OPEN` → `COUNT_REQUIRED` if the cashbox policy demands a count
and none is linked/approved yet → `DIFFERENCE_FOUND` if an approved
count's difference has no resolving adjustment yet → `PENDING_APPROVAL`
if the adjustment exists but isn't `POSTED` yet); `close()` re-validates
that same readiness before persisting `CLOSED`, so a stale read can never
slip a not-actually-ready close through. `reopen()` requires a mandatory
reason, same as bank reconciliation.

`CashierHandover` records a shift changeover between two cashiers and is
only completable once any linked physical-count difference is resolved
by a `POSTED CashCountAdjustment` — the same resolution rule as daily
close. **Disclosed simplification**: completing a handover does not
itself end the outgoing cashier's `CashierAssignment` or start the
incoming one's — that stays a separate, explicit
`CashierAssignmentService` call. A handover records the fact and the
numbers; it is not the thing that grants operating rights on the desk.

## I. Health checks and reporting (spec sections 42-44, 94, 96-103)

`CashHealthService.check()` — computed live, never a stored issues table,
same principle as `TreasuryHealthService`/`SettlementHealthService`:
negative balance under a `NEVER` policy (should never happen; a bug
signal if it does), **book-vs-GL mismatch per cash desk** (sums
`JournalEntryLine` rows on the `CASH` account filtered by the `CASHBOX`
dimension and compares against the live book balance — the one check no
other Phase 15 service already surfaces), stale unresolved count
differences, daily closes left open too long, and transfers stuck
`IN_TRANSIT`/`PARTIALLY_RECEIVED`.

`CashReportingService` — Cash Book (opening balance + every movement in a
date range + running balance), Cash Balance Report (every active desk's
live balance), Cashier Turnover Report (per-cashier receipt/expense
totals), Difference Report (every count with a non-zero difference and
its resolution state), Transfer Report. The Accountable Person Report is
`AccountablePersonService`'s own `getBalance`/`ageing` — not duplicated
into the reporting service.

## J. A pre-existing bug this build's tests surfaced and fixed

`ChartOfAccountsService.ensureAdopted`/`seedSystemTemplate` were
all-or-nothing: once the shared system template (`tenantId: null`) or a
tenant's own adopted chart existed, the seed function returned early and
never looked at `AZ_ACCOUNTS`/`AZ_DEFAULT_DIMENSION_RULES`/
`AZ_DEFAULT_MAPPINGS` again. This phase is the first to add genuinely new
accounts (`244`, `222`) and a new dimension code (`EMPLOYEE`) to an
already-seeded long-running system — every existing/new tenant silently
never got them, and every `EMPLOYEE_ADVANCE`/`CASHIER_RECEIVABLE` posting
failed with "Unknown accounting dimension: EMPLOYEE". Fixed by making
both functions backfill (create-if-missing, by code, never touching an
existing row) instead of short-circuiting — `backfillSystemTemplate` for
the shared template, `backfillTenantChart`/`backfillTenantMappingsAndRules`
per tenant. This closes a real gap for any future phase that adds a new
account/dimension/mapping to a chart that has already been adopted
somewhere, not just this one.

## K. Disclosed simplifications

- **No separate `CashReceiptOrder`/`CashExpenseOrder` document types** —
  `CashTransaction`'s existing `direction`/`category` fields already model
  both; building parallel types would have duplicated the posting
  handler and the settlement-allocation hooks it already has.
- **No payroll-deduction or expense-report workflow** for
  `CASHIER_RECEIVABLE`/employee advances (spec sections 29/59) — only the
  advance/return pair and the AccountablePersonMovement ledger.
- **Cashier handover does not itself change `CashierAssignment` rows** —
  see section H.
- **`BLIND` count method does not withhold `bookBalance` from the API** —
  see section G.
- **`CASH_OVERRIDE_NEGATIVE`/`CASH_PERIOD_OVERRIDE` permission codes are
  declared but not yet wired to any bypass** — the negative-balance block
  and the generic period-open check (`PeriodService`, unchanged from
  every other document type) are unconditional in this build; a
  permission-gated override is a natural follow-up, not built here to
  avoid adding an untested bypass path.
- **Maximum cash limit (`Cashbox.maxCashLimit`)** — stored but not yet
  enforced anywhere; a warning-level health check or a hard block on
  RECEIPT posting is a natural follow-up.
- **Multi-currency denomination counting** — `CurrencyDenomination` is
  scoped per currency and a count's lines can mix denominations of the
  same currency the cashbox holds; no cross-currency till (e.g. a desk
  holding both AZN and USD notes) was modeled — that would need a
  currency column on `CashDenominationCountLine` itself.

## L. API surface

```
GET/POST   /organizations/:orgId/cash-transactions[/:id]                      (existing, extended)
GET/POST   /organizations/:orgId/cash-desk-transfers[/:id/receive]
GET/POST   /organizations/:orgId/cashier-assignments[/:id/end]
GET        /organizations/:orgId/accountable-persons/:personId/balance
GET        /organizations/:orgId/accountable-persons/ageing
GET/POST   /currency-denominations[/:id/deactivate]
GET/POST   /organizations/:orgId/cash-physical-counts[/:id/submit|/:id/approve|/:id/reject]
GET/POST   /organizations/:orgId/cash-count-adjustments
GET/POST   /organizations/:orgId/cash-desk-daily-closes[/:id/link-count|/:id/refresh|/:id/close|/:id/reopen]
GET/POST   /organizations/:orgId/cashier-handovers[/:id/complete]
GET        /organizations/:orgId/cash-desk-health
GET        /organizations/:orgId/cash-desk-reports/{cash-book|balances|cashier-turnover|differences|transfers}
POST       /documents/CASH_TRANSACTION|CASH_DESK_TRANSFER|CASH_COUNT_ADJUSTMENT/:id/{post|unpost|cancel}  (generic)
```

## M. Tests

`test/cash-desk.e2e-spec.ts` (new, 15 tests): basic receipt/expense +
negative-balance block + its concurrency safety + an `ALLOWED`-policy
cashbox going negative, cashier-assignment enforcement, employee advance
+ return (and its own validation), cash-to-cash transfer INSTANT and
TWO_STEP (two partial receives, unpost blocked once received, over-receive
rejected, same-desk rejection), the full physical-count → adjustment
chain (shortage resolved, `CASHIER_RECEIVABLE` charged to a person,
difference report clears), daily close (gated on an unresolved count,
closed once resolved, reopened), cashier handover (blocked then
completed), and cash health (no false-positive book-vs-GL mismatch on a
healthy desk).

`test/treasury-bank-operations.e2e-spec.ts` and `test/settlement.e2e-spec.ts`
(pre-existing) were re-run to confirm no regression; one pre-existing
settlement test (`Supplier advance › reduces the payable when applied`)
needed a one-line fix — it made a `SUPPLIER_PAYMENT` cash outflow against
a freshly-created, never-funded cashbox, which is now correctly blocked
by the new negative-balance control. Fixed by funding the cashbox with a
receipt first, matching the same realistic pattern this phase's own
tests use throughout.
