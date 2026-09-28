# Work Time / Timesheet Engine (docx spec Phase 18)

## Architecture: three layers, kept strictly separate

```
Layer 1 — Planned Work Time
  ProductionCalendar (+versioning) ─┐
  WorkScheduleTemplate/Pattern     ─┼─> EmployeeDailyWorkPlan (derived, per employment/date)
  Phase 17 Employment state (as-of)─┘

Layer 2 — Actual Work Time
  AttendanceEvent (raw, immutable)
    -> AttendanceInterval (interpreted: paired IN/OUT, missing/duplicate punch flags)
    -> TimeEntry (normalized: timeCode + hours, from attendance or manual or Phase 17 leave/absence)

Layer 3 — Payroll Work-Time Input
  TimeEntry -> Timesheet/TimesheetLine (plan-vs-actual, overtime/night/holiday/weekend classification)
    -> WorkTimeRegister (RegisterMovement, on Timesheet LOCK — the approved layer)
    -> PayrollTimeInput (aggregated per payroll period — what Phase 19 reads)
```

Phase 19 (Payroll) never reads raw attendance or even Timesheet rows directly — only
`PayrollTimeInputService.getPayrollTimeInputs()` / the internal API methods below,
which are built entirely on `WorkTimeRegister`.

## The effective-dated Daily Work Plan (same convention as HR Core/Fixed Assets)

`EmployeeDailyWorkPlan` is always DERIVED, never hand-typed. For each date,
`DailyWorkPlanService.generate()` combines:

1. The `WorkScheduleAssignment` (Phase 17) covering that date, resolved to a
   `WorkScheduleTemplate` by code — this is what makes a mid-period schedule change
   (spec section 16) fall out of the per-date lookup for free, with no special-case
   code.
2. The `WorkSchedulePattern` for that date's cycle day (`resolveCycleDay()`: a
   deterministic, Unix-epoch-anchored index, so the same calendar date always maps to
   the same cycle day regardless of when the schedule was first generated).
3. The `ProductionCalendarDay` for that date — holiday/weekend/shortened/transferred
   ALWAYS overrides the raw weekly pattern (spec sections 44-45). A
   `TRANSFERRED_WORKDAY` turns an otherwise-OFF pattern day into a working day at the
   calendar's own default hours (compensating for a midweek holiday).
4. Phase 17's `EmploymentService.getState()` as-of that date, for
   department/position/FTE — which is what makes hire/termination/mid-period-transfer
   dates naturally zero out or shift the plan without any special-case code (spec
   sections 15-17).

A row already marked `generationStatus = 'LOCKED'` is left untouched by regeneration
(spec section 63).

## No double counting: base hours vs premium overlays

The single most important rule in this phase (spec sections 47-48): **REGULAR_WORK**
and **OVERTIME** are the only two buckets that make up "total worked hours". **NIGHT**,
**HOLIDAY**, and **WEEKEND** are separate premium OVERLAY measures computed
independently from the exact same source hours — they are added to the timesheet line
and to `WorkTimeRegister` as their own movements, but they are never summed into a
worked-hours total. An hour that is both overtime and night shows up as `overtimeHours
+= 1` AND `nightHours += 1` on the same line — never `worked += 2`.

`WorkTimeRegisterService.getHours()` reflects this directly: `getWorkedHours()` only
sums `[REGULAR_WORK, OVERTIME]`; a caller asking for night or holiday hours gets a
separate, independent query.

## Plan vs actual: unexplained differences are never silently absorbed

For a normally-scheduled day (`TimesheetService.generateLine()`):

```
cappedRegular = min(actualRegularHours, plannedHours)
excess        = max(0, actualRegularHours - plannedHours)
overtimeHours = min(excess, approvedOvertimeHoursForThatDate)
unexplained   = max(0, excess - approvedOvertimeHoursForThatDate)
regularHours  = cappedRegular + trainingHours
```

`unexplained` is excluded from every hours bucket — it is never automatically overtime
(spec section 38), never silently counted as absence, and never dropped invisibly
(spec section 31). Instead the line's `validationStatus` becomes `EXCEPTION` with a
note naming the amount, and `TimesheetService.approve()` refuses to approve a
timesheet with any unresolved `EXCEPTION` line.

For a day the calendar marks as HOLIDAY or WEEKEND (`plannedHours = 0`), any actual
`REGULAR_WORK` hours are instead classified directly as holiday/weekend work (no
overtime-approval gate — working a day you weren't scheduled at all is a different
scenario from working extra hours on a scheduled day; `WorkTimeHealthService` can still
flag unapproved holiday work for review).

## Night hours: interval-intersection arithmetic

`computeNightOverlapMinutes()` intersects a `TimeEntry`'s actual `[startTime, endTime)`
against the night window (22:00-06:00, fixed) anchored to the entry's own date, and
also checks the previous day's window instance for a shift that starts before dawn. A
shift crossing midnight (e.g. 20:00-04:00) is anchored to its `CLOCK_IN` date
(`SHIFT_START_DATE`, spec section 17's own configurable option — only this anchor is
implemented).

## Corrections: append-only, never overwrite

`TimeCorrectionService.apply()` never mutates the original `TimeEntry`. It creates a
brand-new entry (`source = CORRECTION`) and marks the original `REPLACED`
(`supersededById` points forward), keeping the full chain for audit. If the affected
date's `Timesheet` is already `LOCKED`, the correction is still recorded — silently
blocking a legitimate late-arriving correction is exactly as wrong as silently
overwriting locked data — but `requiresRecalculation` is set and an audit event is
raised (`WORK_TIME_RECALCULATION_REQUIRED`) so the payroll dependency is trackable
(spec section 59). This codebase has no separate event bus; the audit log is the event
record here, the same convention used throughout.

## WorkTimeRegister: the fifth Truth Engine reuse

`WorkTimeRegisterService` reuses the generic `RegisterMovement` ledger (`registerCode =
'WORK_TIME_REGISTER'`) — the same immutable-append-only-ledger pattern already used for
Stock (Phase 10-11), Cash (Phase 15), Bank (Phase 14), and Fixed Assets (Phase 16).
Movements are written exactly once, when a `Timesheet` transitions to `LOCKED`
(`TimesheetService.lock()`), never from raw attendance directly (spec section 109).

## Disclosed simplifications

- **No biometric/access-control device integration** — `AttendanceEventService`
  accepts manual/API-created events only; idempotent on `(sourceSystem,
  externalEventId)`. Real device integration is Phase 28's job.
- **No AI attendance anomaly detection** — Phase 29's job.
- **TimeCode catalog is hardcoded**, not a per-tenant configurable entity
  (`time-codes.ts`) — same convention as `DEPRECIATION_METHODS` in Fixed Assets.
  `countsAsWorkedTime`/`countsAsPaidTime`/`isPremiumOverlay` are modeled precisely even
  though the catalog itself isn't admin-editable yet.
- **Only `PREAPPROVAL_REQUIRED` overtime policy** — every excess hour needs an
  `APPROVED` `OvertimeRecord` for that exact date; `POST_APPROVAL_ALLOWED`/
  `AUTO_WITH_THRESHOLD`/`MANUAL_ONLY` and the daily/weekly/period threshold
  configuration (spec sections 39/41) aren't implemented.
- **No actual-clock-based break deduction** — break minutes come uniformly from the
  day's `WorkSchedulePattern.breakDurationMinutes`, not from interpreting
  `BREAK_START`/`BREAK_END` events (those are stored as raw data but not paired).
- **FLEXIBLE/ROTATING schedule types use the same cycle-day generation algorithm** as
  `STANDARD_WEEK` — FLEXIBLE's own "core hours" policy modeling (spec section 80) and
  ROTATING's multi-crew rotation aren't separately implemented.
- **Business Trip reuses Phase 17's `AbsenceRecord` (`absenceType = 'BUSINESS_TRIP'`)**
  rather than a dedicated `BusinessTripTimeRecord` entity — folded directly into
  `TimesheetLine.businessTripHours`.
- **Partial-day leave/absence has no dedicated Phase 17 field** — `LeaveRecord`/
  `AbsenceRecord` are whole date-range records, so auto-generation only produces
  whole-day `TimeEntry` rows (hours = that date's planned hours). A partial day (spec
  test 149: 6h regular + 2h absence) is entered as a manual `TimeEntry` alongside the
  attendance-derived one for the same date — Timesheet generation sums every active
  `TimeEntry` for a date, so this composes correctly without requiring Phase 17's
  schema to carry hour granularity it doesn't have.
- **No approval sub-workflow** — Timesheet/Correction lifecycles are simple `DRAFT ->
  ... -> LOCKED` state machines, not the spec's fuller hierarchy (Phase 26's job).
- **Staffing-position-style capacity checks don't apply here** — Work Time has no
  analogous headcount constraint.
- **Grace period / late-arrival tolerances (spec section 74) are not implemented** —
  every actual hour is counted as worked; a late arrival only shows up as a smaller
  attendance interval, not a distinct exception category.
- **Rest-period-between-shifts compliance and on-call/standby (spec sections 79/88)**
  are not modeled — explicitly optional in the spec itself.

## Test coverage

`test/work-time.e2e-spec.ts` (14 tests, all passing against real PostgreSQL) covers:
attendance idempotency (duplicate external-id re-import), missing-clock-out and
duplicate-punch detection, a production calendar with a holiday and a shortened day, a
standard 5-day schedule template, the full spec section-172 end-to-end month (hire,
schedule assignment, mid-month department transfer, annual leave, approved overtime,
daily plan generation reflecting calendar + transfer, regular attendance with break
deduction, partial absence, a night shift crossing midnight with correct 6h night
premium and no worked-hours inflation, holiday work, timesheet generate/submit/
approve/lock, Work Time Register + Payroll Time Input Register generation with no
money fields), a locked-timesheet direct-edit block requiring a Time Correction (which
correctly flags `requiresRecalculation`), an unapproved-overtime exception that blocks
timesheet approval until resolved, and the plan-vs-actual/overtime/night/holiday-
weekend reports.
