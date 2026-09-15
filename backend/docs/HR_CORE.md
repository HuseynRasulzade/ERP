# HR Core / Kadr Uçotu (docx spec Phase 17)

```
PhysicalPerson (real human, created once, tenant-wide)
  --EmployeeService.create--> Employee (HR identity, tenant-wide)
    --HireService.create--> Employment (PLANNED) + EmploymentContract v1
                             + HireDocument (DRAFT)
      --POST (DocumentPostingService)-->
          Employment -> ACTIVE|PLANNED (by hireDate vs today)
          + EmployeeAssignment (opens, spec sections 22-23)
          + WorkScheduleAssignment (if given)
          + EmploymentStatusHistory row

EmployeeTransfer (spec sections 24-28)
  --POST--> closes current EmployeeAssignment, opens a new one
            effective the transfer date (future-dated supported)

TerminationDocument (spec sections 43-46)
  --POST--> closes assignment/schedule/status-history,
            Employment -> TERMINATED (Employee/PhysicalPerson untouched)

Rehire = HireService.create({ isRehire: true, previousEmploymentId })
  --> a brand-new Employment, never reopening the terminated one
      (spec section 47)
```

HR "posting" (spec section 65) is never an accounting posting — Hire/
Transfer/Termination route through the shared `DocumentFramework` purely
for its status/version/audit lifecycle; every posting handler's
`buildAccountingBatch` always returns `null`. `EmployeeAssignment` is the
one authoritative, effective-dated history register (spec sections 22-23,
50-51) — `Employment`'s own department/position/manager/fte columns are
kept in sync as a convenience LATEST snapshot, never read by a report or
health check directly.

## A. Three separate concepts, never merged (spec section 1)

`PhysicalPerson` (the real human, created once, tenant-wide, no
organization), `Employee` (the tenant's HR identity for that person —
personnel number, corporate contact, never itself an employment), and
`Employment` (one concrete employment relationship — organization,
department, position, FTE, dates). One `PhysicalPerson` can have several
`Employee`... no — exactly one `Employee` per `PhysicalPerson` in this
build (a person has one HR identity), but that one `Employee` can have
MANY `Employment` rows: a primary full-time employment, a secondary
part-time one, a past terminated one, a new one after rehire — all
distinct rows, never overwritten.

## B. EmploymentContract is its own version history (disclosed simplification)

Spec section 12 asks for an `EmploymentContractVersion` child table.
This build instead makes `EmploymentContract` itself the version
sequence: `EmploymentContractService.amend` closes the current row's
`effectiveTo`, and creates a NEW row with the same `contractNumber` and
`versionNumber + 1` carrying a `changeSummary`. The original is never
mutated in place — this satisfies the spec's actual requirement
("original contract overwrite edilməməlidir") without a second table.

## C. Assignment overlap: one open-ended assignment per employment

`EmployeeAssignmentService.openAssignment` supports exactly one currently
-open (`effectiveTo: null`) assignment per employment at a time — opening
a new one always closes whichever was open the day before. The spec's own
multi-assignment extension point (a person concurrently holding more than
one open assignment under ONE employment) is not built (disclosed
simplification) — use a second `Employment` (secondary employment, spec
sections 29-31) for that case instead, which this build fully supports.

## D. Circular manager hierarchy detection (spec sections 71-72, 34)

`manager` is a self-relation on `Employment`, never on `Employee` (spec
section 34 — the same person can have several employments, so "who is
whose manager" must be employment-scoped). Every assignment/transfer that
sets a new manager walks the candidate's own chain upward and rejects
self-management or any cycle before writing anything.

## E. Staffing capacity is always computed live

`StaffingService.capacity`/`checkOverstaff` never read a stored counter —
occupied headcount/FTE is summed from currently-open `EmployeeAssignment`
rows for a given `staffingPositionId` every time (spec section 17's own
worked example: headcount limit 3, current FTE 2.5, vacancy 0.5).
`overstaffPolicy` (`BLOCK`/`WARNING`/`APPROVAL_REQUIRED`/`ALLOW`) is
read from the `StaffingPosition` itself — only `BLOCK` throws inside
`checkOverstaff`; the other three are returned as a decision object for
the caller/UI to act on (spec section 18).

## F. Future-dated hire and transfer (spec sections 21, 28)

A `HireDocument`/`EmployeeTransfer` posts immediately regardless of
whether its `hireDate`/`effectiveDate` is in the future — only the
resulting `EmploymentStatus`/`EmployeeAssignment.effectiveFrom` carries
the future date. `getStateAsOf` correctly returns the PRIOR state for any
date before that effective date, and the new state from that date onward,
with no separate "activation" step required for the assignment history
itself. The one exception, disclosed: `Employment.employmentStatus` is
computed ONCE at hire-post time (`ACTIVE` if `hireDate <= today` else
`PLANNED`) and nothing in this build later flips a `PLANNED` employment
to `ACTIVE` automatically when its hire date arrives — a scheduled job or
manual call would need to do that (out of this phase's scope, no
scheduler infrastructure introduced here).

## G. Disclosed simplifications / Phase 17 boundaries

- No separate `EmploymentContractVersion` table (see section B).
- No multi-assignment concurrent-open-assignment support (see section C).
- No `RehireDocument`/`BusinessTrip`/generic `HRDocumentLink` tables — 
  rehire reuses `HireService` (see intro), business trips are the spec's
  own "optional" and not built, and document traceability uses this
  codebase's existing `sourceDocumentType`/`sourceDocumentId` convention
  instead of a generic link table.
- `PLANNED` employments do not auto-activate on their hire date (see
  section F) — no scheduler exists in this build to do it.
- Field-level security (spec section 62 — a manager sees name/position
  but not personal ID/bank account) is NOT enforced at the field level;
  `HR_VIEW_SENSITIVE_DATA`/`HR_VIEW_PERSONAL_DATA` gate whole ENDPOINTS
  (e.g. `attributes`), not individual response fields. A finer-grained
  field-level authorization layer is a future extension point the schema
  doesn't block.
- Segregation-of-duties (hire creator != approver, spec section 81) is
  not enforced structurally — left to RBAC configuration.
- `EmployeeAttributeHistory` (spec section 59) exists for
  localization/tax/social attributes only — never used for core typed
  fields, per the spec's own instruction.
- Bulk hire/bulk transfer (spec sections 84-85) and CSV import (spec
  section 86, itself deferred to Phase 28) are not built — the core
  single-row `HireService`/`EmployeeTransferService` are what a future
  bulk wrapper would loop over.
- `locationId`/`costCenterId`/`projectId` throughout are soft string
  references — no dedicated Location/CostCenter/Project master-data
  model exists in this codebase yet.

## H. Permissions

`HR_PERSON_VIEW`, `_PERSON_CREATE`, `_PERSON_EDIT`, `HR_EMPLOYEE_VIEW`,
`_EMPLOYEE_CREATE`, `HR_EMPLOYMENT_CREATE`, `HR_HIRE_CREATE`,
`_HIRE_POST`, `HR_TRANSFER_CREATE`, `_TRANSFER_POST`,
`HR_TERMINATE_CREATE`, `_TERMINATE_POST`, `HR_CONTRACT_VIEW`,
`_CONTRACT_EDIT`, `HR_STAFFING_VIEW`, `_STAFFING_EDIT`, `HR_LEAVE_VIEW`,
`HR_ABSENCE_VIEW`, `HR_VIEW_PERSONAL_DATA`, `HR_VIEW_SENSITIVE_DATA`,
`HR_VIEW_HISTORY`, `HR_OVERRIDE_STAFFING_LIMIT` — see
`rbac/permission-codes.ts`.
