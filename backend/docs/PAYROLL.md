# Payroll / Gross-to-Net Engine (docx spec Phase 19)

## Architecture: a fixed pipeline over admin-configurable data

```
PayrollPeriod (per organization/month)
  + EmployeeCompensationAssignment (effective-dated, never overwritten)
  + Phase 18 PayrollTimeInputRegister (the ONLY door into attendance/hours)
  + PayrollVariableInput (bonus/allowance, one-off amounts)
  + PayrollExecutionOrder (alimony/court order/union dues, capped + carry-forward)
  + PayrollLegalRuleSet / PayrollTaxBracket / PayrollContributionBracket / PayrollTaxRelief
    (effective-dated, seeded DATA — never hardcoded rates in the engine)
      |
      v
EarningCalculationService (base salary proration + overtime/night/holiday premiums)
      |
      v
GrossToNetService (taxable/social/unemployment/medical bases, progressive tax,
                    contributions, execution orders, employer cost)
      |
      v
PayrollCalculationResult + PayrollResultLine (versioned, explainable trace)
      |
      +--> PayrollRecalculationService (retro correction: new version, old SUPERSEDED)
      |
      v
PayrollPosting (document-framework participant: balanced GL entry
                 + PAYROLL_LIABILITY_REGISTER movements)
      |
      v
PayrollPaymentBatch / PayrollPaymentAllocation (pays down the liability register)
      |
      v
PayrollCloseService (CLOSED once PAID + POSTED + no blocking errors)
```

Payroll never re-derives raw attendance itself: `PayrollInputService` is the only door
into Phase 18, and it reads exclusively `PayrollTimeInputService.getPayrollTimeInputs()`
— APPROVED/LOCKED rows only (spec section 55). Payroll also never hardcodes a tax or
contribution rate: `PayrollLegalRulesService` resolves `PayrollTaxBracket`/
`PayrollContributionBracket`/`PayrollTaxRelief` rows by `asOfDate`, so a historical
period's calculation is immune to a future law change (spec's own "never retroactively
change law" rule) — see `az-payroll-localization.data.ts` for the seeded illustrative AZ
2026 figures.

## Effective-dated compensation, not an overwritten field

`EmployeeCompensationAssignment` is never mutated in place. `CompensationService.create()`
closes the prior overlapping ACTIVE assignment's `effectiveTo` and opens a new row.
`resolveSegments()` splits a payroll period into one segment per assignment that applies
within it — this is what makes a mid-month salary change prorate correctly with no
special-case code in the calculation engine itself.

## No double-paying holiday/weekend hours

Same disclosed principle as Work Time: `eligibleHours` for the base-salary proration
ratio EXCLUDES holiday/weekend hours (`regularHours - holidayHours - weekendHours +
leaveHours + businessTripHours`) — those hours are instead compensated ENTIRELY through
their own `HOLIDAY_PREMIUM`/`WEEKEND_PREMIUM` earning line at the full statutory
multiplier. Night hours remain a pure ADD-ON premium since they overlap with
already-paid regular/overtime hours rather than replacing them.

## Idempotent regular runs, versioned retro corrections

`PayrollCalculationEngine.calculate()` (a REGULAR run) deletes and recreates the result
at the period's CURRENT `calculationVersion` — retrying a regular run is always safe and
never creates a duplicate. A genuinely new version is exclusively
`PayrollRecalculationService.recalculate()`'s job: it computes with
`computeForEmployment()` (the pure half of the engine, resolving THAT historical
period's own compensation/tax/contribution brackets — never today's), persists it as
`version + 1`, and marks the prior result `SUPERSEDED` with `supersededById` pointing
forward. The original result is never deleted or mutated — only superseded — and the
returned `delta` is what a caller posts, not a duplicate full payroll.

## PayrollPosting: the document-framework participant

`PayrollPosting` is a proper `BaseDocumentFields`-shaped document (one per
`PayrollPeriod`, `@unique`) registered with `DocumentFrameworkRegistry` like every other
GL-affecting document in this codebase. Posting it (`POST
documents/PAYROLL_POSTING/:id/post`) runs `PayrollPostingHandler` inside the existing
generic post/unpost/repost transaction:

- `buildMovements` — one `PAYROLL_LIABILITY_REGISTER` INCREASE movement per employment
  per liability category (`NET_PAY`, each statutory deduction code, each employer
  contribution code) — the SIXTH reuse of this codebase's generic `RegisterMovement`
  Truth Engine, after Stock/Cash/Bank/FixedAsset/WorkTime.
- `buildAccountingBatch` — a single balanced journal entry per period:

  ```
  Dr Salary Expense (per department)          = sum(EARNING lines)
  Dr Employer Contribution Expense (per dept) = sum(EMPLOYER_CONTRIBUTION lines)
  Cr Salary Payable                           = sum(net)
  Cr <statutory payable per DEDUCTION code>   = sum(DEDUCTION lines by code)
  Cr <statutory payable per EMPLOYER_CONTRIBUTION code> = sum(those lines)
  ```

  Balanced by construction: `net = gross - sum(DEDUCTION lines)`, so
  `Dr(gross + employerContributions)` always equals
  `Cr(net + deductions + employerContributions)`. The GL account for each EARNING/
  DEDUCTION code comes from that code's own `PayrollEarningDefinition`/
  `PayrollDeductionDefinition.accountingMappingKey` (admin-configurable per tenant, via
  `AccountingMappingService`) — never a single hardcoded account for every earning type.
  Employer contribution codes (`EMPLOYER_SOCIAL_INSURANCE`/etc.) have no catalog row, so
  their mapping is fixed in `payroll-codes.ts`'s `EMPLOYER_CONTRIBUTION_PAYABLE_MAPPING`.

  Posting also flips `PayrollPeriod.status` to `POSTED`; `undoSideEffects` (on unpost)
  flips it back to `APPROVED` — but refuses outright if any `PayrollPaymentAllocation`
  is already `PAID` against the period, so a GL correction can never silently disagree
  with money already paid out.

## PayrollPaymentBatch: the stable contract Phase 14/15 consume

Phase 19 determines who is owed what (via `PayrollLiabilityService.getOutstandingBalance`
against the register) and records that it was paid; it never executes the actual money
movement. `PayrollPaymentBatchService.createAndConfirm()` pays each listed employment's
FULL outstanding `NET_PAY` liability immediately (writes a DECREASE movement + a `PAID`
`PayrollPaymentAllocation`) and recomputes the period's `PARTIALLY_PAID`/`PAID` status.
`recordPayment()` is the companion path for a single, possibly PARTIAL, off-batch
payment — this is the shape Phase 14 (bank)/Phase 15 (cash), once built, are expected to
call from their own posting handler with their own `paymentDocumentType`/
`paymentDocumentId`.

## PayrollCloseService

A practical subset of the spec's own close checklist: a period can only close once it
is fully `PAID`, its `PayrollPosting` is `POSTED`, and no unresolved blocking
`PayrollError` remains. Reopening (`PayrollPeriodService.reopen()`, already covers
`CLOSED` in its allowed-from list) bumps `calculationVersion` and sets `REOPENED` — it
does NOT cascade-unpost the GL entry or reverse payments already made; that is left as a
manual follow-up (unpost the `PayrollPosting` separately once outstanding payments allow
it).

## Disclosed simplifications

- **AZ 2026 bracket figures are illustrative**, derived narratively from the spec text,
  not verified official figures — `az-payroll-localization.data.ts` says so explicitly
  and they must be confirmed/corrected via the admin API (`PayrollSetupController`)
  before real use.
- **Fixed calculation pipeline**, not a generic runtime dependency-graph-with-cycle-
  detection engine (spec's fuller ask) — Base Salary → Overtime → Night → Holiday →
  Leave Average → Bonus/Allowance → Gross-to-Net is a hardcoded sequence.
- **Only the statutory-minimum overtime/night/holiday multiplier** is applied — no
  stored contract/company-multiplier override field (`max(statutory, contract)` isn't
  wired).
- **Overtime/night/holiday premiums always use the LAST compensation segment's
  tariff** for the period, rather than being sub-divided across a mid-period
  compensation change the way base salary itself is.
- **`PayrollContributionBracket.fixedComponent` and `PayrollTaxBracket.baseTax` are
  informational-only** — `computeProgressive`/`computeContribution` are pure
  portion-sum calculations and never rely on a stored cumulative base amount.
- **Department is resolved ONCE per employment** (as of the posting's business date,
  via `EmploymentService.getState()`) for both the GL dimension and the employer-cost
  report — a mid-period department transfer is not sub-split across old/new department
  the way a mid-period compensation change already is.
- **A payment batch confirms immediately at creation** rather than a separate draft/
  confirm workflow — Phase 14/15 do not exist yet in this build to be the real trigger
  for a later "confirm" step.
- **Reopen does not cascade-undo** the GL posting or recorded payments (see above).
- **No approval sub-workflow** beyond the single `APPROVED` status transition — Phase
  26's fuller hierarchy is not wired here, same convention as every other phase.

## Test coverage

`test/payroll.e2e-spec.ts` (3 tests, all passing against real PostgreSQL) covers: full
base-salary proration with progressive AZ tax/contributions against a real Work Time
Register month, a backdated salary raise recalculated into a new version with the
original preserved as `SUPERSEDED`, and the full GL-posting pipeline — approve, draft
`PayrollPosting`, post it through the generic document-framework command, assert the
resulting journal entry balances exactly (`Dr(gross + employerContributions) ==
Cr(net + deductions + employerContributions)`), pay it out via a payment batch, confirm
a second batch against an already-fully-paid period is refused, confirm unposting after
payment is refused, then read back the payroll register/payslip/employer-cost/liability
reports and close the period.
