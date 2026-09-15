# Payroll / Gross-to-Net Engine (docx spec Phase 19)

```
PayrollRateBracket (jurisdiction-agnostic core reads ONLY this — never a
  literal rate/divisor/multiplier in a calculation service)
  ├─ INCOME_TAX (progressive)         ├─ OVERTIME_MULTIPLIER (flat)
  ├─ SOCIAL_INSURANCE (EMPLOYEE/EMPLOYER, progressive)
  ├─ UNEMPLOYMENT_INSURANCE (EMPLOYEE/EMPLOYER)
  ├─ MEDICAL_INSURANCE (EMPLOYEE/EMPLOYER)
  ├─ NIGHT_PREMIUM / HOLIDAY_PREMIUM (flat)
  └─ AVERAGE_PAY_DIVISOR (flat, e.g. 30.4)

EmployeeCompensationAssignment (effective-dated) ─┐
EmployeeTaxProfile (effective-dated)              ├─> PayrollCalculationService.calculate
PayrollTimeInput (Phase 18, APPROVED/LOCKED ONLY) ─┤     (per eligible employment)
PayrollVariableInput (bonus/allowance)             │
PayrollExecutionOrder (alimony/execution)         ─┘
        │
        ▼
PayrollCalculationResult + PayrollResultLine (EARNING/DEDUCTION/
  EMPLOYER_CONTRIBUTION, each fully explained — spec section 78)
        │
        ▼ (period APPROVED)
PayrollPostingService.post ──> one GL batch (AccountingPostingEngine)
        │                       + one PayrollLiability row per
        │                         employment × liability type
        ▼
PayrollLiabilityService.allocate ──> links an ACTUAL SettlementPayment
  (Phase 13/14/15, never duplicated here) to the liability it settles
        │
        ▼
PayrollCloseService.close (checklist, payment NOT required — spec 124)
```

## A. Every jurisdiction-specific number is DATA, not code (spec sections 3, 27, 30, 37, 51, 131)

`PayrollRateBracketService` is the single place a progressive tax band, a
contribution rate, an overtime/night/holiday multiplier, or the leave-pay
averaging divisor lives. `PayrollCalculationService` and
`AverageEarningsService` never contain a literal `0.14`, `2`, or `30.4` —
every one of those numbers is looked up by `bracketType` + `regime` +
effective date. `seedAzerbaijan2026` loads the 2026 non-oil-private
figures quoted in the spec (sections 51, 55, 57-58) as ordinary seed rows
under regime `AZ_NON_OIL_PRIVATE_2026` — a starting point a tenant must
review, never assumed correct without verification (the medical insurance
rows are explicitly commented as needing confirmation).

## B. Three layers, never merged (spec section 1)

Compensation Entitlement (`EmployeeCompensationAssignment`) says what an
employee is ENTITLED to; Payroll Input (`PayrollTimeInput`, read-only from
Phase 18) says what actually counted THIS period; Payroll Calculation
(`PayrollCalculationResult`/`PayrollResultLine`) is the deterministic
result of combining the two with the rate brackets. Payroll never
re-interprets attendance itself (spec section 20) —
`PayrollCalculationService` only ever calls
`PayrollTimeInputService.forPayroll`, which itself only returns
`APPROVED`/`LOCKED` rows.

## C. Mid-period compensation change is prorated by day-share × eligibility ratio

`EmployeeCompensationService.getOverlapping` returns every compensation
segment touching the period; `calculateEmployment` prorates each
segment's `BASE_SALARY` earning by `(days that segment covers within the
period) / (total period days)`, then further multiplies by an
`eligibilityRatio` (accounted hours ÷ monthly norm hours, spec sections
21-23) so a mid-month hire/termination or a partial unpaid-leave month
never gets a blind half-salary (spec section 23's own explicit warning).

## D. Overtime/night/holiday resolve to `max(statutory, contract)` where the spec asks for it

`OVERTIME_PAY`'s multiplier is `max(OVERTIME_MULTIPLIER bracket,
PayrollEarningDefinition.defaultMultiplier)` (spec section 27's own
formula) — never a hardcoded `2.0`. `NIGHT_PREMIUM`/`HOLIDAY_PREMIUM` only
post an earning line when their bracket is actually configured; if
unconfigured, the premium is simply omitted (0), not a guessed default —
a tenant that hasn't seeded these yet gets a visibly-zero premium line
rather than a silently-wrong non-zero one.

## E. Leave pay uses the real 12-month average, fully traced

`AverageEarningsService.calculate` sums, month by month, every
`PayrollResultLine` whose earning code is flagged
`averageEarningsInclusion` on `PayrollEarningDefinition` (spec section
38's own include/exclude classification, done through the earning
catalog rather than a separate `AveragePayEarningClassification` table —
disclosed simplification, see section H), over the 12 calendar months
before the leave, clipped to the employment's own start date if shorter
(spec section 37). The divisor comes from the `AVERAGE_PAY_DIVISOR`
bracket. Every month's included/excluded lines are captured in
`traceDetail` (spec section 39's own traceability requirement) — `leave
hours ÷ 8` is used as a days approximation (disclosed simplification, see
section H).

## F. Deduction order, caps, and carry-forward (spec sections 62-64, 130)

Deductions apply in a fixed sequence — statutory (income tax, then
employee social/unemployment/medical insurance) always before
`PayrollExecutionOrder` rows (alimony/execution documents, spec sections
65-66), which themselves apply in their own `priority` order. A
`DEDUCTION_CAP` bracket (percentage of net-before-post-tax-deductions), if
configured, bounds the total; whatever an execution order couldn't
withhold because of that cap is written to
`DeductionCarryForwardBalance` — never silently dropped (spec section
130's own worked example). `protectedMinimum` on an execution order
additionally floors net pay for that specific order.

## G. Posting is one balanced batch per run, liabilities are the real subledger

`PayrollPostingService.post` builds ONE `AccountingPostingEngine` batch
per calculation run: Dr Salary Expense + Dr Employer Contribution Expense
/ Cr Employee Net Payable + Cr Income Tax Payable + Cr Social/
Unemployment/Medical Insurance Payable (employee AND employer shares
pooled into the same account, see section H) + Cr Other Deduction
Payable — and asserts debit = credit before ever calling `postBatch`
(spec section 117). Every employment then gets one `PayrollLiability` row
per liability type (spec sections 99-103) — this is what
`PayrollLiabilityService.allocate` and the close checklist both read,
never the GL.

## H. Disclosed simplifications / Phase 19 boundaries

- Employee AND employer social/unemployment/medical insurance share ONE
  GL payable account each in this build (`SOCIAL_INSURANCE_PAYABLE`
  etc.) rather than four separate accounts — most charts of accounts in
  practice do this; a tenant needing the split can extend the mapping
  resolver later.
- No separate `PayrollTaxRelief` combinability engine (spec sections
  49-50) — `EmployeeTaxProfile.exemptionAmount` is one flat monthly
  exemption instead of a catalog of combinable/exclusive/priority-ranked
  relief codes.
- No separate `AveragePayEarningClassification` table (spec section 38)
  — `PayrollEarningDefinition.averageEarningsInclusion` is reused for
  this instead of a second, date-versioned classification entity.
- Leave hours → days uses a flat 8-hours-per-day approximation rather
  than each day's own planned hours from `EmployeeDailyWorkPlan` (would
  require per-day proration inside the leave calculation).
- Sick pay uses the same `LEAVE_AVERAGE_PAY` strategy and
  `AverageEarningsService` as annual leave — no separate
  employer-paid-vs-social-insurance-paid-portion split (spec sections
  42-44) is computed; `PayrollEarningDefinition.benefitPayer` exists on
  the schema for a future pass to use.
- Termination-specific settlement (severance, unused leave compensation,
  final settlement run type `TERMINATION`) is representable
  (`PayrollEarningDefinition` codes exist, `runType` accepts
  `TERMINATION`) but no dedicated termination-settlement calculation
  path is wired — `PayrollVariableInputService` is the manual entry point
  for those amounts today.
- `PayrollRecalculationRequest` is never auto-created by
  `EmploymentContractService.amend`/`TimeCorrectionService.correct` —
  those Phase 17/18 services would need to import this module to call
  `PayrollRecalculationService.flag` automatically, which this pass does
  not wire (see that service's own docstring). Flagging is a deliberate,
  callable action instead.
- No `PayrollPaymentBatch`/bank-file-export entity (spec sections
  110-111) — `PayrollLiabilityService.allocate` records a reference to
  whatever payment document (a Phase 13/14/15 `SettlementPayment`) was
  created elsewhere; batching multiple employees into one bank file is
  left to that existing bank/cash tooling, never duplicated here.
- `CompensationChangeBatch` (spec section 134, mass raise) is not built
  — a caller loops over `EmployeeCompensationService.assign` per
  employment instead, same "bulk wrapper not built" pattern as HR's own
  bulk-hire boundary.
- Statutory report versioning/submission tracking (spec section 121) and
  payment-deadline resolution from a tax calendar (spec section 122) are
  not built — `PayrollReportingService.statutoryReport` returns the
  current subledger snapshot only.
- `regime` is passed explicitly to `PayrollCalculationService.calculate`
  (defaulting to `AZ_NON_OIL_PRIVATE_2026`) rather than resolved
  automatically from `EmployeeTaxProfile.sectorCategory`/`taxRegime` —
  those fields are stored and available for a future resolver, but every
  call in this build states the regime itself (spec section 52's full
  employer-sector/oil-vs-non-oil/employee-category resolution is not
  wired end-to-end).
- Minimum-wage/salary-compliance validation at hire/salary-change time
  (spec sections 131-132) is not wired into `HireService`/
  `EmployeeCompensationService` — a `MINIMUM_WAGE` bracket type exists in
  the schema for a future validator to read.

## I. Permissions

`PAYROLL_VIEW`, `_VIEW_OWN`, `PAYROLL_CONFIG_EDIT`,
`PAYROLL_COMPENSATION_EDIT`, `PAYROLL_TAX_PROFILE_EDIT`,
`PAYROLL_VARIABLE_INPUT_CREATE`, `PAYROLL_EXECUTION_ORDER_EDIT`,
`PAYROLL_PERIOD_MANAGE`, `PAYROLL_CALCULATE`, `PAYROLL_APPROVE`,
`PAYROLL_POST`, `PAYROLL_REOPEN`, `PAYROLL_CLOSE`,
`PAYROLL_LIABILITY_MANAGE`, `PAYROLL_RECALCULATION_MANAGE`,
`PAYROLL_VIEW_PAYSLIP`, `PAYROLL_VIEW_STATUTORY_REPORT` — see
`rbac/permission-codes.ts`.
