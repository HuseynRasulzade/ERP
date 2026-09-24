# Phase 17 — HR Core / Kadr uçotu

Module: `src/hr/` (`HrModule`). Migration: `prisma/migrations/20261017000000_phase17_hr_core`.
Tests: `test/phase17-hr-core.e2e-spec.ts` (31 scenarios, incl. the spec's test cases 127-143 and the section 149 end-to-end scenario).

## What was built

**Three separate identities (spec 1, 146).** `PhysicalPerson` (the human, personal contacts, legal IDs), `Employee` (the tenant's HR identity: personnel number `EMP-…` from the row-locking NumberingService, corporate contacts; one per person per tenant) and `Employment` (one concrete relationship with one organization). One person can have many employments: parallel, secondary, other organizations, rehires.

**Effective-dated, immutable histories (spec 22/23/50).** Authoritative sources:

| Table | What |
|---|---|
| `employee_assignments` | department, position, staffing position, branch, manager employment, location, FTE, cost center, project |
| `work_schedule_assignments` | work schedule per date |
| `employment_status_history` | ACTIVE / SUSPENDED / TERMINATED |
| `employment_contract_versions` | full contract-term snapshot per version |
| `employee_attribute_history` | tax / residency / social-insurance / disability ... (sensitive flag) |

Ranges are inclusive calendar days (`DATE` columns, `effective_to = null` = open-ended). A change at date D closes the covering row at D-1 and inserts a new row at D; rows are never overwritten or deleted. Same-day changes leave a zero-length row and a strictly increasing `sequence` (spec 27). A change before an already-posted later change is refused (reverse the later one first). Reversals mark rows `record_status = REVERSED` and restore the predecessor. All of this lives in one helper: `effective-timeline.ts`. The columns on `employments` (`department_id`, `fte`, `employment_status` ...) are a projection refreshed on every write. They are never read to answer an as-of question.

**Status derivation (spec 10).** PLANNED before the start date, TERMINATED after the end date, CANCELLED when the hire was reversed. Otherwise the status comes from the status history, and an approved leave shows as ON_LEAVE. A future-dated hire therefore becomes ACTIVE on its date without any job.

**HR documents (spec 19/24/43/48/64).** `HireDocument` (and rehire = `isRehire`, always a NEW employment), `EmployeeTransfer`, `TerminationDocument`. They are numbered, audited, linked through the Phase 0 `DocumentLink` (hire → contract, hire → employment, termination → employment, employment → rehire) and use the status machine DRAFT → PENDING_APPROVAL → APPROVED → POSTED → REVERSED, with CANCELLED also possible. APPROVED is not the same as POSTED. Segregation of duties is on by default: the creator cannot approve. Each document has a **preview** (no writes): the new state for a hire, before → after for a transfer, and for a termination the status after the date, open leave/absence, the future schedule, direct reports and the final-payroll indicator.

**Design decision:** HR documents do **not** go through the accounting `DocumentPostingService`. HR posting is a history write and never a GL movement (spec 65). That engine is tied to accounting periods and to delete-and-regenerate register semantics, which would break immutable HR history. Instead HR has its own close-period foundation (`hr_periods`, spec 125) and reuses numbering, audit, DocumentLink, idempotency, settings and organization access.

**Posting rules implemented:**
- duplicate employment (policy BLOCK/WARNING/ALLOW)
- at most one active primary employment (scope TENANT/ORGANIZATION)
- the rehire date must be after the previous end date
- FTE > 0, per-employment maximum and aggregate maximum
- inactive department, position, branch or schedule blocks the change
- a staffing position must be valid on the date (the staffing-table version covering it)
- staffing capacity (FTE and headcount), checked on the date and on every later occupancy date, under overstaff policy BLOCK/WARNING/APPROVAL_REQUIRED/ALLOW; override requires `hr.staffing.override_limit`
- the manager must be active, cannot be the employee themself, and circular reporting lines are refused
- a contract is required (optionally signed)
- HR closed period
- a downstream finalized period (see below)

Error messages are specific, e.g. *"Employment cannot be activated because Staffing Position FIN-ACC-02 has no available FTE on 01.02.2026 (limit 2, occupied 1.5, requested 1)"*.

**Concurrency and idempotency (spec 77/78).** Every writer takes `SELECT … FOR UPDATE` on the document and the employment (and on the employee for hires). A transfer stores the assignment it was based on (`old_assignment_id`). When two transfers are posted in parallel for the same date, exactly one succeeds and the other fails with `HR_EFFECTIVE_DATE_CONFLICT`. Posting an already-POSTED document returns the original result (`alreadyPosted: true`). An optional `Idempotency-Key` header also goes through the Phase 0 `IdempotencyService`. `employments.hire_document_id` is unique, and outbox events are unique per `(tenant, idempotency_key)`.

**Also built:**
- staffing tables: versioned and effective-dated; activation supersedes the previous version; slot identity = organization + code
- positions (generic job titles) and a minimal work-schedule catalog (`hr_work_schedules`; Phase 18 extends it or links it via `template_ref`)
- contracts with amendments/versions
- suspension / return to work
- leave (REQUESTED → APPROVED overlays ON_LEAVE), absence (partial-day hours), business trips
- internal combination (`isSecondary` assignment rows)
- configurable catalogs: termination reasons, leave/absence types, suspension reasons, attribute types
- HR policy stored as the tenant setting `hr.policy`
- bank accounts, personnel-document metadata with a sensitivity class
- bulk hire, bulk transfer (per-line validation), import validation API (no writes; duplicates against the DB and within the file)

**Reports (spec 87-98), all computed from the history register:**
- headcount and FTE (always separate measures) grouped by organization, branch, department, position, employment type or status
- org chart (departments + manager tree)
- staffing (approved / occupied / vacant / planned)
- employee movement
- hires, terminations (with service length), transfer history
- contract expiry, probation, leave/absence
- employee list

**HR health** covers every check listed in spec 98, each with a severity of INFO, WARNING, ERROR or BLOCKING.

**Security (spec 61/62/80).** Every permission code from spec 80 is implemented, plus `hr.leave.manage`, `hr.absence.manage`, `hr.compensation.view`, `hr.bank_info.view`, `hr.medical.view`, `hr.document.approve`, `hr.document.reverse`, `hr.reports.view` and `hr.config.manage`. The seed adds two roles: HR_SPECIALIST and HR_MANAGER. `HrSecurityService` applies field-level redaction:
- personal IDs, birth date and private contacts are hidden without `hr.personal_data.view`
- the compensation reference is hidden without `hr.compensation.view`
- sensitive attributes and medical documents are filtered out without their permissions
- reading personal data writes an `HR_SENSITIVE_DATA_VIEWED` audit entry (policy `auditSensitiveViews`)

Organization-scoped data (employments, documents, reports) goes through `OrganizationAccessService`. Persons and employees are tenant-level HR identity. Audit entries carry old/new values and effective dates.

## Downstream contract (Phase 18 / 19 / 20 / 22)

Import `HrModule` and inject `HrHistoryService`:

- `getEmploymentState(tenantId, employmentId, asOf)` returns status, isEmployed, the assignment (department, position, staffing slot, manager, FTE, cost center …), work schedule, contract version and terms, leave/absence/business trips covering the date.
- `getActiveEmployments(tenantId, employeeId, asOf)`, `getDepartment`, `getPosition`, `getManager`, `getWorkSchedule`, `getFTE`, `validateEmploymentActive(..., {strict})`.
- `getEffectiveSegments(tenantId, employmentId, from, to)` returns maximal date slices of constant HR state. **Payroll must use these slices, never the current fields** (spec 115). Also exposed at `GET /hr/employments/:id/segments`.
- `getEmploymentsInPeriod(tenantId, {organizationId|organizationIds, from, to})` returns the payroll / month-close population with `hiredInPeriod`, `terminatedInPeriod` and segments (`GET /hr/employments-in-period`).

**Events.** The outbox table `hr_events` is read via `GET /hr/events` and acknowledged via `POST /hr/events/ack`. Every event payload carries employee_id, employment_id, organization_id, effective_date, old_state, new_state and source_document. The event types are:
- `PHYSICAL_PERSON_CREATED`, `EMPLOYEE_CREATED`
- `EMPLOYMENT_PLANNED`, `EMPLOYEE_HIRED`, `EMPLOYEE_REHIRED`
- `EMPLOYEE_TRANSFERRED`, `EMPLOYEE_POSITION_CHANGED`, `EMPLOYEE_DEPARTMENT_CHANGED`, `EMPLOYEE_MANAGER_CHANGED`, `EMPLOYEE_FTE_CHANGED`
- `EMPLOYEE_SCHEDULE_CHANGED`, `EMPLOYEE_SUSPENDED`, `EMPLOYEE_RETURNED_TO_WORK`
- `EMPLOYEE_LEAVE_REGISTERED`, `EMPLOYEE_ABSENCE_REGISTERED`
- `EMPLOYEE_TERMINATED`, `EMPLOYEE_TERMINATION_REVERSED`, `EMPLOYEE_HIRE_REVERSED`, `EMPLOYEE_TRANSFER_REVERSED`
- `CONTRACT_AMENDED`, `STAFFING_POSITION_CHANGED`
- `HR_RECALCULATION_REQUIRED`

**Recalculation and finalized periods.** Downstream modules implement `HrDownstreamDependencyProvider` (`hasDerivedData`, `isFinalized`) and register it with `HrEventService.registerDownstreamProvider`. Any HR change that is backdated, or that falls on or after a date for which a provider already derived data, emits `HR_RECALCULATION_REQUIRED` with `affected_from` and `affected_consumers`. A change dated inside a period a provider has finalized is blocked with `HR_DOWNSTREAM_DEPENDENCY` (for example, reversing a termination after final settlement).

## API (prefix `/hr`)

- **People:** `persons` (+ `duplicate-check`), `employees` (+ `/:id?asOf=` card, `attributes`, `bank-accounts`), `documents`
- **Employments:** `employments` (+ `/:id`, `/:id/state`, `/:id/segments`, `/:id/schedule-changes`, `/:id/suspend`, `/:id/return-to-work`, `/:id/secondary-assignments`), `history/:employmentId`
- **Contracts:** `contracts` (+ `amendments`, `version?asOf`, `sign`, `cancel`)
- **HR documents:**
  - `hires` (+ `bulk`, `preview`, `submit`, `approve`, `reject`, `cancel`, `post`, `reverse`)
  - `rehires` (+ `post`)
  - `transfers` (+ `bulk`, the same actions as hires)
  - `terminations` (+ the same actions; `reverse` = termination cancellation)
- **Leave and absence:** `leaves`, `absences`, `business-trips`
- **Configuration:** `positions`, `work-schedules`, `staffing-tables` (+ `activate`), `staffing-positions`, `catalogs/:type`, `policies`, `periods`, `events`
- **Reports:** `staffing`, `headcount`, `org-chart`, `reports/{movement,hires,terminations,transfers,contract-expiry,probation,leave-absence}`, `health`, `import/validate`

## Deferred / known limits

- **Frontend pages were not built in this phase** (the time budget ran out). The backend API is complete; HR list and card pages, the hire wizard, transfer and termination forms, reports and the as-of selector remain to be done.
- Personnel numbers use the shared numbering format `EMP-YYYY-NNNNNN`: the engine always includes the year, and `reset=NEVER` keeps the sequence global.
- Personnel documents store metadata only (upload/storage like counterparty documents is not wired).
- Multi-step HR approval routing is Phase 26; the HR close period is a foundation only.
- Health checks are computed on demand; they are not persisted in an `hr_health_issues` table.
- There is no automatic manager reassignment when a manager is terminated: the termination returns a warning listing the direct reports.
- The existing `settings.valid_from` default drift (present before this phase) is untouched and excluded from this migration.
