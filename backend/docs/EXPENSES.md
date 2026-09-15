# Expenses / Cost Centers / Employee Expenses (docx spec Phase 20)

```
ExpenseCategory (policy limits inline) ─┐
CostCenter (financial dimension,        │
  distinct from Department)             ├─> ExpenseClaimService.create
Phase 15 AccountablePersonMovement      │     (per-line policy check —
  (employee advance balance)           ─┘      spec section 17)
        │
        ▼
ExpenseClaimLine.policyStatus: OK | MISSING_RECEIPT | MISSING_BUSINESS_PURPOSE
  | EXCEEDS_LIMIT | EXCEPTION_APPROVED
        │
        ▼ (manager decisions each line, spec sections 52-53)
approveLine (claimed amount NEVER overwritten) → finalizeApproval
        │
        ▼ (POST via DocumentPostingService)
ExpenseClaimPostingHandler dispatches by line.classification:
  CURRENT_EXPENSE → Dr category expense account + Dr recoverable VAT
  PREPAID_EXPENSE → Dr PREPAID_EXPENSE (PrepaidExpense schedule created)
  FIXED_ASSET/CIP → Phase 16 FixedAssetAcquisitionCandidateService (handoff,
                     no expense line posted here)
  (everything else → posts as CURRENT_EXPENSE, disclosed simplification)
Credit side: EMPLOYEE_ADVANCE → AccountablePersonService.record
             (EXPENSE_REPORTED) + Cr SUPPLIER_ADVANCE stand-in account
             anything else → Cr EMPLOYEE_EXPENSE_PAYABLE
```

## A. Cost Center ≠ Department (spec sections 4-5)

`CostCenter` is its own financial-responsibility dimension with an
optional `departmentId` link — one department (e.g. IT) can contain
several cost centers (IT Infrastructure, Software Development, IT
Support). Every expense line, allocation, driver value, and budget row
carries a `costCenterId`, never a `departmentId` alone.

## B. Employee settlement reuses Phase 15/13/14, never duplicated (spec sections 21, 26-28)

`ExpenseClaimPostingHandler` calls `AccountablePersonService.record`
(the SAME Phase 15 register `CashCountAdjustment`'s `CASHIER_RECEIVABLE`
path and `SettlementPaymentPostingHandler`'s employee-advance path both
already write to) with movement type `EXPENSE_REPORTED` to draw down an
advance. `ExpenseSettlementService.register` reads that register plus
Phase 13/14/15's own `SettlementPayment` rows LIVE — there is no new
`EmployeeExpenseSettlementRegister`/`AccountablePersonAdvance`/
`EmployeeSettlementMovement` table in this build (disclosed
simplification): the spec's own "do not store only claim.is_paid" is
satisfied by computing advance-issued/expense-approved/returned/
reimbursed/outstanding-debt/outstanding-payable every time from the
existing subledgers instead.

## C. Fixed asset handoff, never a duplicate capitalization engine (spec section 31)

A line classified `FIXED_ASSET`/`CIP` calls Phase 16's own
`FixedAssetAcquisitionCandidateService.createFromSource` and posts NO
expense GL line itself — the resulting `FixedAssetAcquisitionCandidate`
enters Phase 16's own classify → capitalize flow from there. The
Phase 9/11 inventory-cost handoff (spec section 32) for an
`INVENTORY_COST`-classified line is NOT wired the same way in this build
— such a line currently posts as a plain current expense (disclosed
simplification, see section G).

## D. Policy is per-category, not a separate multi-dimensional rule engine (spec section 9)

`ExpensePolicy`'s own dimensioned rule set (organization × grade ×
position × department × travel type × category × payment method ×
currency) is folded into a handful of fields directly on
`ExpenseCategory` (`receiptRequirement`/`receiptThreshold`,
`businessPurposeRequired`, `perTransactionLimit`) — one limit per
category rather than a fully dimensioned policy matrix (disclosed
simplification, see section G). `ExpenseClaimService.create` evaluates
these at line-creation time and NEVER silently accepts a line that fails
them (spec section 17) — it sets `policyStatus`, and posting later
refuses any line still flagged unless a manager calls
`approveLineException`.

## E. Cost allocation posts an analytical reclassification, never a duplicate expense (spec sections 71-72)

`CostAllocationService.post` debits a generic expense account dimensioned
to each TARGET cost center and credits `EXPENSE_ALLOCATION_CLEARING`
dimensioned to the SOURCE cost center — the organization's total expense
never changes, only its cost-center attribution does. Only `DIRECT`
(equal split) and `DRIVER_BASED` (weighted by `AllocationDriverValue`)
are calculated end-to-end (spec section 65's own stated minimum);
`STEP_DOWN`/`RECIPROCAL_FUTURE` are valid `allocationType` values with a
`sequence` field ready for a future multi-pass engine but this build runs
one direct pass per rule only.

## F. Prepaid recognition schedule IS the recognition-run history (spec sections 33-41)

`PrepaidExpenseService.buildSchedule` supports `STRAIGHT_LINE_BY_MONTH`
(equal months) and `STRAIGHT_LINE_BY_DAY` (true day-count proration —
spec section 39's own mid-month example, e.g. 15 January to 14 January
next year) — never a blind 12-equal-months assumption unless that method
is chosen. `recognizePeriod` posts Dr Expense / Cr Prepaid Expense (spec
section 36) for every due `PrepaidExpenseSchedule` row and marks it
`RECOGNIZED` — there is no separate `PrepaidRecognitionRun` table
(disclosed simplification): the schedule rows' own `status`/
`postingReference`/`recognizedAt` already are that run's history.

## G. Disclosed simplifications / Phase 20 boundaries

- `ExpensePolicy`'s full multi-dimensional rule engine is not built (see
  section D) — one limit per category instead.
- No generic `CostObject` master table (spec section 6) —
  `ExpenseAllocation.targetType`/`targetId` is a soft polymorphic
  reference, consistent with this codebase's established convention.
- `INVENTORY_COST` classification does not hand off to the Phase 9/11
  Additional Purchase Cost interface (spec section 32) — it posts as a
  current expense today.
- Only `EMPLOYEE_ADVANCE` and (implicitly) `EMPLOYEE_PERSONAL_FUNDS`
  payment sources have a real settlement path wired; `CASH_DESK`/`BANK`/
  `CORPORATE_CARD`/`SUPPLIER_PAYABLE` all credit the same generic
  `EMPLOYEE_EXPENSE_PAYABLE` account rather than triggering their own
  cash/bank/supplier-payable document (would require `cashDeskId`/
  `bankAccountId`/`supplierId` fields on the line, not added in this
  pass).
- No Phase 5 Tax Engine service call for VAT computation — an
  `ExpenseClaimLine`'s `taxAmount`/`recoverableVat`/`nonrecoverableVat`
  are caller-supplied inputs rather than derived by invoking that
  engine; `taxStatus`/`vatTreatmentProfile` fields exist for a future
  pass to wire that resolution.
- Tax-deductibility as its own dimension (spec section 49, "Accounting
  Expense ≠ Tax Deductible Expense") is not modeled — one amount, one
  GL treatment.
- `AllocationDriverService` stores whatever value is written to it — it
  does not itself pull live headcount/FTE from Phase 17 or worked hours
  from Phase 18 (disclosed in that service's own docstring); a caller
  resolves and writes the number.
- No employee-debt-to-payroll-deduction wiring — Phase 20 never touches
  net salary directly (spec section 28's own explicit instruction); a
  `PayrollDeductionDefinition` code (`EMPLOYEE_ADVANCE_RECOVERY`) exists
  on the Payroll side for a future integration to use.
- Duplicate-receipt detection (spec section 18) is a `DUPLICATE_SUSPECTED`
  flag, never an automatic block — always reviewable.

## H. Permissions

`EXPENSE_VIEW`, `_VIEW_OWN`, `EXPENSE_CONFIG_EDIT`, `EXPENSE_CLAIM_CREATE`,
`_CLAIM_APPROVE`, `_CLAIM_POST`, `EXPENSE_ALLOCATION_EDIT`,
`EXPENSE_COST_ALLOCATION_RUN`, `EXPENSE_PREPAID_MANAGE`,
`EXPENSE_BUDGET_MANAGE`, `EXPENSE_VIEW_SETTLEMENT` — see
`rbac/permission-codes.ts`.
