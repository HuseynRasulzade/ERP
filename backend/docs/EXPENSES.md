# Expenses / Cost Centers / Employee Expenses (docx spec Phase 20)

## Architecture: Cost Center -> Claim -> Tax/Settlement -> Classification -> GL

```
CostCenter (distinct from Phase 17 Department — see below)
  + ExpenseCategory / ExpensePolicy (effective-dated, admin-configurable)
      |
      v
ExpenseClaim + ExpenseClaimLine + ExpenseReceipt
  (ExpenseValidationService: policy limit / duplicate receipt / business-
   purpose-required checks BEFORE submission is even allowed)
      |
      v
ExpenseApprovalService.approve() — partial approval per line
      |
      +--> ExpenseTaxService (Phase 5 Tax Engine reuse: gross input ->
      |     net expense + recoverable/nonrecoverable VAT split)
      |
      +--> ExpenseClassificationService (CURRENT_EXPENSE / PREPAID_EXPENSE /
      |     FIXED_ASSET / INVENTORY_COST / SUPPLIER_SETTLEMENT — the last
      |     one is EXCLUDED from GL/register: never double-recognize a cost
      |     a Supplier Invoice already recognized)
      |
      +--> EmployeeExpenseSettlementService (Phase 15 AccountablePerson
            advance reuse, via the ResponsiblePerson bridge — see below)
      |
      v
ExpenseClaimPostingHandler (document-framework participant: balanced GL
  entry + EXPENSE_MOVEMENT_REGISTER movements)
      |
      +--> PrepaidExpenseService + PrepaidRecognitionRunService
      |     (straight-line schedule, idempotent monthly recognition)
      |
      +--> AllocationDriverService / AllocationRuleService /
      |     CostAllocationRunService (DIRECT / DRIVER_BASED, cycle detection)
      |
      +--> ExpenseAdjustmentService (cost-center reclassification —
      |     the only sanctioned way to change a posted line's cost center)
      |
      v
ExpenseBudgetService (budget vs actual, actual from the posted register)
      |
      v
ExpensePeriodService.close() (checklist: no unresolved claim, no approved-
  but-unposted claim, no un-recognized prepaid schedule row this period,
  no un-allocated cost-allocation source amount this period)
```

## Cost Center is deliberately distinct from Department

The spec (sections 4-5) treats `CostCenter` as its own dimension, separate
from Phase 17's `Department` — a department maps to zero-or-one cost
centers in the common case, but the model does not force that: a
`CostCenter` optionally references a `departmentId` for reporting
convenience, but expense claims, budgets, and allocation rules all key off
`costCenterId`, never `departmentId` directly. This lets "Shared Services"
be its own cost center with no corresponding department, which is exactly
what the cost-allocation e2e scenario exercises.

## Bridging Phase 15's AccountablePerson to Phase 17's Employment

A genuine, pre-existing architectural inconsistency surfaced building this
phase: `AccountablePersonMovement.personId` carries a real Prisma foreign
key to Phase 0's `ResponsiblePerson` (a User-linked identity), not to
Phase 17's `Employment`. These are two separate, unreconciled identity
concepts in this codebase — an HR employee and a "person accountable for
cash" are not the same row anywhere yet.

Rather than duplicating Phase 15's advance ledger under a new
`Employment`-keyed identity, or forcing an invasive cross-phase identity
unification this phase has no mandate to do, `ExpenseClaim` carries a
nullable, caller-supplied `responsiblePersonId` that bridges the two: when
present, `EmployeeExpenseSettlementService.settle()` looks up that
`ResponsiblePerson`'s outstanding advance via the existing
`AccountablePersonService` and applies it FIFO-by-currency against the
claim's approved total. When absent, the claim is treated as 100%
employee-personal-funds — the full approved amount becomes a reimbursement
payable, never an error. No new advance ledger was built; Phase 15's is
reused exactly as, is, one directional bridge field added.

## VAT split follows the codebase's own established convention

`TaxRegisterService.registerTaxable()` for a PURCHASE/INPUT-direction line
emits SEPARATE GL debit lines for `VAT_INPUT_RECOVERABLE` and
`VAT_INPUT_NONRECOVERABLE` — it never folds the nonrecoverable portion into
the expense account itself (confirmed against
`purchase-invoice.posting-handler.ts`, the codebase's own precedent). This
phase follows the identical convention: `Dr Expense = taxableBase` (the net
amount) always, with VAT posted on its own line(s) regardless of the
recoverable/nonrecoverable split. `transactionAmount` on a claim line is
treated as GROSS input to the Tax Engine (`priceIncludesTax: true`) — the
register and every downstream report (budget-vs-actual, cost-center P&L)
read the NET expense amount, never the gross claimed figure.

## The Expense Movement Register — the 7th Truth Engine reuse

`EXPENSE_MOVEMENT_REGISTER` is this codebase's seventh reuse of the generic
`RegisterMovement` ledger pattern (after Stock/Cash/Bank/FixedAsset/
WorkTime/PayrollLiability). `CURRENT_EXPENSE` movements are written once,
at posting time, by `ExpenseClaimPostingHandler` — carrying the NET
expense amount per cost center/category dimension. `COST_ALLOCATION_OUT`/
`COST_ALLOCATION_IN` movement pairs are written later, by
`CostAllocationRunService.post()` and `ExpenseAdjustmentService`, to
reclassify cost between cost centers WITHOUT changing total company
expense (spec section 72/107: allocation and reclassification must always
net to zero company-wide). `SUPPLIER_SETTLEMENT`-classified lines write no
movement at all — the cost was already recognized when the Supplier
Invoice posted, so recognizing it again here would double-count it.

## Employee Expense Reimbursement Register (the "company owes employee" direction)

`EMPLOYEE_EXPENSE_REIMBURSEMENT_REGISTER` is a NEW register (this phase's
own, not a reuse) that tracks the opposite direction from Phase 15's
`AccountablePersonMovement`: money the company owes the employee once
approved expenses exceed any advance received. `EmployeeExpenseSettlementService`
writes an INCREASE movement for the excess; a future reimbursement payment
(once a real payment path exists) would write the matching DECREASE.

## Prepaid Expense: straight-line schedule, idempotent recognition

`PrepaidExpenseService.buildSchedule()` splits `originalAmount` across
monthly (or daily) periods between `recognitionStartDate` and
`recognitionEndDate`, with the LAST schedule row absorbing any rounding
residual so the total always reconciles exactly to the original amount.
`PrepaidRecognitionRunService.run()` is idempotent by construction: it only
ever processes schedule rows still in `PLANNED` status for the requested
period — retrying the same period recognizes nothing further (verified by
the e2e suite's own retry assertion), the same convention as every other
recognition/allocation engine in this codebase (no run-level duplicate
guard needed).

## Cost Allocation: Drivers, Rules, Runs

- **Drivers** (`AllocationDriverService`) are backed by real data where it
  already exists: `computeHeadcount()`/`computeFte()` read Phase 17
  employment state, `computeWorkedHours()` reads Phase 18's
  `WorkTimeRegister` — never a separately-maintained shadow figure.
  `MANUAL_PERCENTAGE` remains a hand-entered driver for cases with no
  natural underlying metric.
- **Rules** (`AllocationRuleService.create()`) detect a self-loop
  (`sourceCostCenterId` targeting itself) and a direct two-rule reciprocal
  cycle (A→B and B→A both ACTIVE) at creation time and reject them
  outright. This is a disclosed, PARTIAL cycle guard — full N-node
  topological cycle detection across an arbitrary rule graph is out of
  scope for this build.
- **Runs** (`CostAllocationRunService`): `preview()` is a pure read that
  writes nothing, not even a run row (spec section 70). `calculate()`
  persists a `CostAllocationRun` + lines at `CALCULATED` status;
  `DRIVER_BASED` weighting splits the source amount proportionally to each
  target's driver value for that exact period, with the LAST target
  absorbing the rounding residual so the allocated total always equals the
  source total exactly. `post()` builds a single reclassification GL entry
  (Dr each target cost center / Cr each source cost center, through the
  SAME account — `ADMIN_EXPENSE`) and writes the matching
  `COST_ALLOCATION_IN`/`OUT` register movements; this never changes total
  company expense, only where it is booked.

## Adjustments: cost-center reclassification

`ExpenseAdjustmentService.reclassifyCostCenter()` is the only sanctioned
way to move a POSTED claim line's cost-center assignment after the fact.
Rather than unposting/reposting the original `ExpenseClaim` (which would
require a dependency-safe reversal the document-framework does not
currently guarantee across a claim that may already feed a budget/
allocation run), it books a small standalone GL entry (Dr new cost center
/ Cr old cost center, same account) plus a `COST_ALLOCATION_OUT`/
`COST_ALLOCATION_IN` pair on the Expense Movement Register, and updates the
line's `costCenterId` in place. This is a disclosed simplification: only
`RECLASSIFY_COST_CENTER` is wired end-to-end; other adjustment types are
recorded to the `ExpenseAdjustment` table for audit/traceability but have
no automated GL effect in this build.

## Budget vs Actual

`ExpenseBudgetService.budgetVsActual()` always reads `actual` from the
POSTED `EXPENSE_MOVEMENT_REGISTER` — never from claim totals, and never
from an unposted/pending claim (spec section 78's own explicit requirement:
"Actual expense should come from posted expense/accounting subledger. Not
from approved claim only"). `committedAmount` is a manually-entered field
in this build — a live purchase-order/expense-request commitment engine
(the spec's fuller ask, section 79) is future work. `available = (revised
or original) budget - committed - actual`.

## ExpensePeriod close: a practical checklist subset

`ExpensePeriodService.close()` gates on:

- no claim with a claim date in the period still `DRAFT`/`SUBMITTED`/
  `PENDING_APPROVAL`/`PARTIALLY_APPROVED`;
- no `APPROVED` claim in the period left unposted;
- no `PLANNED` prepaid recognition schedule row for the period;
- **only when this period actually has unallocated source cost** sitting
  behind an ACTIVE `AllocationRule` (checked via
  `CostAllocationRunService.preview()`, never a blanket "any active rule
  anywhere" count) — a POSTED `CostAllocationRun` for the period.

That last check was deliberately NOT written as "any ACTIVE
AllocationRule exists in the organization" — an org-wide rule with nothing
to allocate in a given month (its source cost center had no expense that
month) must never permanently block every future period close. It is
scoped to whether THIS period's own cost-allocation preview shows a
nonzero source amount.

This does NOT independently reconcile the Expense/Prepaid/Employee-
Settlement subledgers against the GL byte-for-byte (the spec's fuller ask,
sections 121-123) — `ExpenseReportingService`'s reports are the read-side
of that instead. Phase 22 Month Close is expected to own the fuller
cross-module orchestration.

## Disclosed simplifications

- **Cost allocation cycle detection is partial**: self-loop + direct
  two-rule reciprocal only, not full topological cycle detection across an
  arbitrary rule graph.
- **The cost-allocation reclassification GL entry assumes a single
  account** (`ADMIN_EXPENSE`) for the whole allocated pool — a cost pool
  spanning multiple GL accounts is not split per-account; scope
  `expenseCategoryFilter` to same-account categories for correctness.
- **Only `RECLASSIFY_COST_CENTER` adjustments have an automated GL
  effect** — other `ExpenseAdjustment` types are recorded for audit only.
- **Budget commitment is manually entered**, not a live purchase-order/
  expense-request commitment engine.
- **No printable/offline expense-report forms** (spec's own Phase 12-style
  ask elsewhere in the doc) — API-only in this build.
- **INVENTORY_COST classification is recognized by the Classification
  Engine but not auto-wired into a Phase 9/11 receipt** — a claim line
  classified `INVENTORY_COST` is flagged but posts no inventory movement
  in this build.
- **`FIXED_ASSET` classification is recognized but does not auto-create a
  Phase 16 acquisition candidate** — flagged only, same reasoning as
  `INVENTORY_COST` above.
- **No approval sub-workflow beyond the single partial-approval step** —
  Phase 26's fuller multi-level hierarchy is not wired here, same
  convention as every other phase in this codebase.

## Test coverage

`test/expenses.e2e-spec.ts` (16 tests, all passing against real
PostgreSQL) covers: claim create/submit with a mandatory-receipt block and
duplicate-receipt rejection, business-purpose-required rejection, employee
advance settlement (fully settled, overspend producing a reimbursement
payable, no-advance producing a full reimbursement payable), partial
approval keeping claimed/approved amounts distinct, a gross-to-net VAT
split via the Tax Engine, a balanced GL posting (net expense + recoverable
VAT = employee reimbursement payable), SUPPLIER_SETTLEMENT exclusion from
GL and the register, a 12-month straight-line prepaid schedule with
idempotent recognition and a same-period retry recognizing nothing
further, a headcount-driver cost allocation reconciling to the exact total
with zero residual and a balanced GL entry, reciprocal/self-loop cycle
detection blocking rule creation, budget-vs-actual computed from the
posted register (never claim totals), a cost-center reclassification
adjustment producing a balanced GL entry and appearing correctly in the
cost-center P&L, expense-period close gated on an unresolved claim then an
approved-but-unposted claim then a not-yet-recognized prepaid schedule row,
successful close/reopen, and the health check surfacing a real
approved-but-unposted claim.
