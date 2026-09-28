# HR Core / Employment Lifecycle Engine (docx spec Phase 17)

## Architecture

Person, identity, and employment are three separate concepts (spec section 1):

```
PhysicalPerson (real-world identity, tenant-wide)
      |
      v
   Employee (company HR identity, tenant-wide, personnel number)
      |
      v
 HireDocument --post--> Employment (org-scoped, one concrete employment relationship)
                              |
                              +--> EmployeeAssignment (effective-dated: department/position/manager/FTE/location)
                              +--> EmploymentStatusHistory (effective-dated: PLANNED/ACTIVE/TERMINATED/...)
                              +--> EmploymentContract -> EmploymentContractVersion (effective-dated terms)
                              +--> WorkScheduleAssignment (effective-dated, free-text code)
                              +--> LeaveRecord / AbsenceRecord (foundation only)
```

`EmployeeTransfer` and `TerminationDocument` are the two write paths that create new
checkpoints on `EmployeeAssignment`/`EmploymentStatusHistory` after the initial hire.
`StaffingTable`/`StaffingPosition` is the versioned planned org structure a
`HireDocument`/`EmployeeTransfer` can optionally target, with headcount/FTE capacity
enforcement.

No GL posting: HR Core is not a document-framework participant — none of these
documents touch the accounting ledger. (Phase 19's Payroll module is where HR data
meets the GL.)

## The effective-dated history pattern (same convention as Fixed Assets)

`Employment`'s own `departmentId`/`positionId`/`managerEmploymentId`/`fte`/`status`
fields are a **current-state projection**, refreshed by write actions (hire post,
transfer post, termination post) — never authoritative on their own. The
authoritative source of "what was true as of date X" is:

- `EmployeeAssignment` — department/position/branch/manager/location/FTE/cost center,
  one row per effective period (`effectiveFrom`/`effectiveTo`), closed and reopened by
  `EmployeeTransfer.post()`.
- `EmploymentStatusHistory` — status, one row per effective period, closed and
  reopened by hire, transfer (implicitly, via the live-status flip), and termination.

`EmploymentService.getState(employmentId, asOfDate)` is the as-of-date query engine:
it reads these two tables directly and returns the department/position/manager/FTE/
status that was true on that date, regardless of what the Employment row's own
current-state fields say right now.

### Disclosed simplification: no scheduled job for future-dated hires/transfers

A future-dated `HireDocument` or `EmployeeTransfer` can be posted today. Posting
always writes the correct `EmployeeAssignment`/`EmploymentStatusHistory` rows with the
real effective date, so `getState()` is correct for any date immediately. But
`Employment`'s own live-projection fields (`status`, `departmentId`, etc.) are only
refreshed immediately when the effective date is today or earlier. There is no
scheduled job that flips a `PLANNED` employment to `ACTIVE`, or a pending transfer's
department change into the live projection, exactly when the date arrives — call
`POST .../hr/employments/:id/sync-status` (cheap, idempotent) to refresh the
projection for a specific employment on demand (e.g. from a daily report or health
check). Anything reading historical or "as of today" data through `getState()` or
`getHistory()` is unaffected by this — only the convenience projection field lags.

## Hire lifecycle

`HireDocumentService.create()` resolves the target `Employee` at **create time**
(`HireDocument.employeeId` is a required field), via exactly one of:

- `employeeId` — an existing Employee (e.g. hiring into a second concurrent
  employment).
- `rehireOfEmployeeId` — spec section 48's Rehire path: reuses the same Employee row
  (no duplicate Employee is ever created for a person who left and came back), but
  only if that Employee currently has no open employment.
- `newPerson` — creates a new `PhysicalPerson` (with duplicate-personalId detection,
  spec section 3) and a new `Employee` inline, inside the same transaction as the
  `HireDocument` itself.

`post()` creates `Employment` + the initial `EmployeeAssignment` + the initial
`EmploymentStatusHistory` row, and rolls `Employee.status`/`hireFirstDate` forward.

### Multiple concurrent employments

An employee can have more than one open `Employment` at once (spec's own
primary/secondary/internal-combination model). `HireDocumentService` blocks a second
open `PRIMARY` employment for the same employee, but allows any number of
`SECONDARY`/`INTERNAL_COMBINATION`/`CONTRACTOR` employments alongside it.
`TerminationDocumentService.post()` only flips `Employee.status` to `TERMINATED` once
**every** open employment for that employee is closed — terminating one `SECONDARY`
employment while a `PRIMARY` one stays open leaves the Employee (and that other
employment) `ACTIVE`.

## Transfers and manager-hierarchy cycle detection

`EmployeeTransferService.post()` closes the `EmployeeAssignment` row covering the
transfer's `effectiveDate` (`effectiveTo` = the day before) and opens a new one from
that date — this always happens, even for a future-dated transfer, so `getState()` is
correct immediately. Before allowing a `newManagerEmploymentId`, the service walks up
that manager's own reporting chain (`Employment.managerEmploymentId`, up to 50 levels)
to confirm the transferred employment never appears in it — otherwise the transfer
would create a circular reporting hierarchy.

## Staffing capacity

`StaffingTableService.checkCapacity(staffingPositionId, additionalFte)` counts every
`Employment` currently in an open status (`PLANNED`/`ACTIVE`/`SUSPENDED`/`ON_LEAVE`)
against that `StaffingPosition`'s `headcountLimit`/`fteLimit`. Both `HireDocumentService`
and `EmployeeTransferService` call it before creating a draft document that targets a
staffing position, and block over-capacity unless the caller both passes
`overrideStaffingLimit: true` **and** holds `HR_OVERRIDE_STAFFING_LIMIT` — checked via
`RequestContextService.hasPermission()`, the same pattern used elsewhere in this
codebase (e.g. `SALES_PRICE_OVERRIDE`).

Disclosed simplification: capacity is only checked against the organization's
currently `ACTIVE` `StaffingTable`, as of today — not the hire/transfer's own
effective date. A staffing table change scheduled for a future date is not
anticipated when checking a hire dated for that same future date.

## Termination and reversal

`TerminationDocumentService.post()` closes the open `EmployeeAssignment` and
`EmploymentStatusHistory` rows (`effectiveTo` = `lastWorkingDate`), writes a new
`TERMINATED` status-history row from `terminationDate`, and rolls `Employee.status`
based on whether any other employment for that employee is still open.
`reverse()` undoes exactly that — deletes the `TERMINATED` status-history row, reopens
the closed assignment/status rows, and flips `Employment`/`Employee` back to `ACTIVE`.
It refuses to reverse if the employment's live status has since changed for any other
reason (defensive check against reversing a stale or already-modified state).

## Disclosed simplifications (full list)

- **No GL posting** — HR Core is entirely outside the document-framework/accounting
  engine. Compensation, payroll liabilities, and any GL impact are Phase 19's job.
- **No scheduled job** for future-dated hire/transfer projection refresh (see above) —
  `getState()`/`getHistory()` are always correct; the live projection field lags until
  `syncStatus()` is called or the next write action touches that employment.
- **LeaveRecord/AbsenceRecord are foundation only** — request/approve lifecycle and
  simple record-keeping, no entitlement/accrual engine, no worked-hours impact. Phase
  18 (Work Time) is expected to build on these tables.
- **WorkScheduleAssignment is a free-text code**, not a foreign key to a schedule
  template entity — that entity doesn't exist until Phase 18.
- **Staffing capacity checked against today's active table only** (see above), not the
  hire/transfer's own effective date.
- **No approval sub-workflow** on `HireDocument`/`EmployeeTransfer`/`TerminationDocument`
  — the spec's own `PENDING_APPROVAL`/`APPROVED` states are folded into a simple
  `DRAFT` -> `POSTED` lifecycle, consistent with every other document-framework-
  adjacent module in this codebase pending a later, dedicated approval-workflow phase.
- **`EmploymentContract` is 1:1 with `Employment`** (a `@unique` constraint) — the
  spec's broader model of multiple historical contracts per employment is
  approximated via `EmploymentContractVersion`'s own amendment history on the single
  contract row, not multiple contract rows.

## Test coverage

`test/hr-core.e2e-spec.ts` (11 tests, all passing against real PostgreSQL) covers:
physical-person duplicate detection, hire lifecycle (new-person path, post),
as-of-date employment state resolution, contract create/amend with version history,
transfer + manager-hierarchy cycle rejection, assignment-history splitting at a
transfer's effective date, staffing-capacity enforcement + override, termination with
correct employee-status rollup, rehire (reusing the same Employee), multiple
concurrent employments (secondary termination leaving primary/employee active), and
the org-chart/headcount/staffing-capacity/health reports.
