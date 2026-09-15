# Work Time / Timesheet (docx spec Phase 18)

```
Layer 1 — Planned          Layer 2 — Actual                Layer 3 — Payroll Input
ProductionCalendar    ┐    AttendanceEvent (raw, immutable)
WorkScheduleTemplate  ┼──> AttendanceInterval (interpreted)
  + WorkSchedulePattern    TimeEntry (normalized, base+premium)
WorkScheduleAssignment    LeaveRecord / AbsenceRecord (Phase 17)
  (Phase 17)          ┘         │
        │                       ▼
        ▼                 Timesheet (period control doc)
EmployeeDailyWorkPlan  ───>  TimesheetLine (= the WorkTimeRegister,
  (generated, never          see section C) — DRAFT→GENERATED→
   hand-edited)               PENDING_APPROVAL→APPROVED→LOCKED
                                     │
                                     ▼ (LOCKED only)
                          PayrollTimeInput (DRAFT→VALIDATED→
                            APPROVED→LOCKED) — Phase 19's ONLY
                            allowed read
```

## A. Three layers, never merged (spec section 1)

Planned (what SHOULD an employee have worked), Actual (what they DID,
from attendance/manual/leave/absence/corrections), and Payroll Input
(what's actually APPROVED/LOCKED for Phase 19 to consume) are three
distinct tables with three distinct lifecycles. Phase 19 Payroll never
reads raw attendance or an unlocked timesheet (spec section 56) —
`PayrollTimeInputService.forPayroll` only returns `APPROVED`/`LOCKED`
rows, and `generate` refuses to run against anything but a `LOCKED`
`Timesheet`.

## B. Base + premium classification, never double-counted (spec sections 46-48)

`TimeEntry.hours` is the BASE classification (`REGULAR_WORK` or
`OVERTIME`, resolved via `TimeCode`) — `nightHours`/`holidayHours`/
`weekendHours` on the SAME row are PREMIUM attributes describing the same
hours from a different angle, never additional hours stacked on top. 2h
of overtime worked at night is one `TimeEntry` (`hours: 2`, code
`OVERTIME`) with `nightHours: 2` — `TimesheetLine`'s own
`regularHours`/`overtimeHours`/`nightHours`/`holidayHours`/`weekendHours`
columns preserve that same non-additive shape, so summing
`regularHours + overtimeHours` (never `+ nightHours + ...`) is always the
correct "hours worked" total.

## C. TimesheetLine on a LOCKED Timesheet IS the WorkTimeRegister (disclosed simplification)

Spec section 108 asks for a separate `WorkTimeRegister` table dimensioned
identically to `TimesheetLine`. This build does not keep a second,
near-duplicate table for it — a `TimesheetLine` belonging to a `LOCKED`
`Timesheet` already carries every one of those dimensions
(employment/date/department/time-code breakdown) and is exactly as
immutable once locked. `PayrollTimeInputService.generate` reads directly
from these lines.

## D. Overtime is never automatic (spec sections 38-40)

`TimeEntryService.generateFromAttendance` computes `eligibleHours` from
attendance minus the shift's own break, caps `REGULAR_WORK` at the day's
planned hours, and classifies the excess as `OVERTIME` ONLY up to
whatever an `OvertimeRecord` has `APPROVED` for that exact date — actual
hours beyond both the plan AND the approved overtime are simply not
entered as any TimeEntry at all (they surface as `UNEXPLAINED_DIFFERENCE`
on the resulting `TimesheetLine` instead, per spec section 31, for a
human to resolve). Only `MANUAL_ONLY`/`POST_APPROVAL_ALLOWED`-shaped
overtime policy is supported this way — `PREAPPROVAL_REQUIRED`/
`AUTO_WITH_THRESHOLD` and daily/weekly/period threshold policies (spec
sections 39, 41) are not built (disclosed simplification).

## E. Night window is a fixed constant, not per-tenant configurable

`TimeEntryService`'s `NIGHT_WINDOW` (22:00–06:00, spec section 42's own
example) is a hardcoded constant in this build, computed via correct
crosses-midnight interval overlap arithmetic (spec section 43) — but not
yet a per-tenant/per-localization configuration row. Disclosed
simplification, see section H.

## F. Attendance interpretation is intentionally conservative

`AttendanceService.interpretDay` pairs CLOCK_IN/CLOCK_OUT chronologically
and NEVER invents a duration for an unpaired IN (spec section 21) —
it's flagged `MISSING_CLOCK_OUT` and excluded from
`generateFromAttendance` until a human calls `reviewInterval` (today just
a manual review marker; resolving the actual gap still requires a
`TimeCorrection` or a fresh, complete attendance pair). A second
consecutive `CLOCK_IN` (or a stray `CLOCK_OUT` with nothing open) is
flagged `DUPLICATE`, never silently merged (spec section 22).

## G. Corrections are deltas, never overwrites (spec sections 57-60)

`TimeCorrectionService.correct` marks the original `TimeEntry`
`SUPERSEDED` and creates a new one — the correction row itself is the
permanent link between them. A correction landing on a date whose
`Timesheet` is already `LOCKED` sets `requiresRecalculation: true`
(spec section 59's own `WorkTimeRecalculationRequired`) instead of
touching the locked numbers; `TimesheetService.reopen` (mandatory reason,
spec section 60) is the only way to then re-generate that period, and
`PayrollTimeInputService.generate` marks any prior rows for the same
employment/period `REPLACED` rather than deleting them (spec section 97).

## H. Disclosed simplifications / Phase 18 boundaries

- Night window is a fixed 22:00–06:00 constant, not a per-tenant/
  localization-configurable window (see section E).
- Overtime policy support is limited to manual per-date approval (see
  section D) — daily/weekly/period thresholds and pre-approval-required
  policies are not implemented.
- `WorkTimeRegister` is not a separate table (see section C).
- No separate `NightWorkRecord`/`HolidayWorkRecord`/`LeaveTimeRecord`/
  `AbsenceTimeRecord`/`BusinessTripTimeRecord` tables — the spec's own
  base+premium recommendation (section 47) is implemented directly on
  `TimeEntry`/`TimesheetLine` instead of five near-duplicate record types.
- Grace periods / late-arrival / early-departure tolerances (spec
  sections 74-76), rest-period compliance checks (spec section 88), and
  weekly-hours-control monitoring (spec section 89) are not built —
  schema and services don't block adding them later.
- Flexible schedule "core hours + monthly target" (spec section 80) is
  representable via `WorkScheduleTemplate.scheduleType: 'FLEXIBLE'` but
  the planned-hours generation logic treats it the same as any other
  pattern-based template — no distinct flexible-hours algorithm.
- On-call/standby (spec section 79) and downtime subtype/reason
  structured storage (spec section 77) are not modeled beyond the
  `TIME_CODE`s `DOWNTIME`/`OTHER` and a free-text `reason`.
- Bulk/grid timesheet entry (spec section 94) and employee self-service
  (spec section 92) are not built — `TimeEntryService.createManual` is
  what a future bulk/self-service layer would call per line.
- `WorkSchedulePattern.workStartTime`/`workEndTime` are plain `"HH:mm"`
  strings, not timezone-aware — this build assumes one working timezone
  per tenant (consistent with the rest of the codebase's date handling).

## I. Permissions

`TIME_VIEW`, `_VIEW_OWN`, `_VIEW_DEPARTMENT`, `TIME_CALENDAR_EDIT`,
`TIME_SCHEDULE_EDIT`, `TIME_ATTENDANCE_IMPORT`, `_ATTENDANCE_EDIT`,
`TIME_TIMESHEET_CREATE`, `_TIMESHEET_EDIT`, `_TIMESHEET_APPROVE`,
`_TIMESHEET_LOCK`, `_TIMESHEET_REOPEN`, `TIME_OVERTIME_CREATE`,
`_OVERTIME_APPROVE`, `TIME_CORRECTION_CREATE`, `_CORRECTION_APPROVE`,
`TIME_VIEW_PAYROLL_INPUT`, `TIME_OVERRIDE_VALIDATION` — see
`rbac/permission-codes.ts`.
