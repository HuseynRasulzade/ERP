# Phase 26 — Workflow / Approval Engine

Implements docx spec Phase 26: a governed Workflow/Approval/Execution-Gate
engine — effective-dated workflow versions, a safe condition DSL,
sequential/parallel/quorum/any-one routing, dynamic approver resolution,
delegation, four-eyes/segregation-of-duties, material-change reapproval,
durable SLA deadlines, and an execution gate every business module can
call before a critical action — deliberately separate from the business
document's own status and from whether the action has actually executed.

```
WorkflowDefinition ──┬── WorkflowDefinitionVersion (effective-dated,
                      │    immutable once ACTIVE) ── WorkflowStepDefinition
                      │       (stage/sequence, executionMode, conditionExpression,
                      │        approverRule, SLA, escalationRule)
                      │
WorkflowConditionService ── safe EQ/NEQ/GT/.../AND/OR/NOT/BETWEEN DSL
ApproverResolutionService ── SPECIFIC_USER/ROLE/MANAGER/MANAGER_N_LEVELS/
                              DEPARTMENT_HEAD/COST_CENTER_OWNER/...
ApprovalAuthorityService ── amount-limit check, currency-normalized
                      │
WorkflowInstanceService (start/activateStage) ──┬── WorkflowStepInstance
                                                  │     ── ApproverAssignment
ApprovalDecisionService (decide) ── concurrency-safe quorum/CAS ── ApprovalDecision
DelegationService / SegregationOfDutiesService
WorkflowReapprovalService ── material-change detection (reuses Phase 25's
                              AuditDiffService) → invalidate/restart
WorkflowSLAService / WorkflowEscalationService
WorkflowExecutionGateService ── assertExecutionAllowed(...) — the ONLY
                                 stable API a business module needs
WorkflowCancellationService / WorkflowSimulationService
WorkflowReportingService / WorkflowHealthService
```

## A. No general workflow DAG; stages are a strict total order

Spec section 93 allows a full DAG model. This build keeps `stage`
(sequential) × steps-within-a-stage (parallel, per `executionMode`) —
a simpler, still-genuinely-concurrent model that covers every worked
example in the spec (Manager → Finance → CFO; Legal + Finance in
parallel; a Board quorum) without needing general cycle detection over
an arbitrary graph. `WorkflowDefinitionService.activateVersion`
validates step configuration (quorum count present, condition syntax)
but does not run a graph-cycle check, since stages cannot cycle by
construction.

## B. PROJECT_MANAGER and DYNAMIC_QUERY_RULE approver types are stubs

Neither has real backing data in this codebase — there is no `Project`
master table (a soft `projectId` reference everywhere, per Phase
17/20/24's own established convention) and no governed dynamic-query
surface. Both resolve to an empty approver list (blocking, per spec
section 88), rather than guessing.

## C. Manager/Department-Head/Cost-Center-Owner resolution needs a linked User

HR's own `Employee`/`Employment` graph (Phase 17) has no native link to
an application `User` account. This phase adds `Employee.linkedUserId`
(nullable) as the bridge — an employee never linked to a user account
simply cannot be resolved as a MANAGER/MANAGER_N_LEVELS/
DOCUMENT_OWNER_MANAGER approver (a real, blocking `WorkflowException`,
not a silent skip). `DEPARTMENT_HEAD`/`COST_CENTER_OWNER` resolve
through `ResponsiblePerson.userId` directly, which already existed.

## D. REQUIRE_EXTRA_APPROVAL reapproval action is folded into CURRENT_STEP_ONLY

Spec section 53 lists `REQUIRE_EXTRA_APPROVAL` as its own reapproval
action (add an approver without resetting existing approvals). This
build treats it identically to `CURRENT_STEP_ONLY` (reset and re-run the
current stage) — a genuinely additive "keep prior approvals, just add
one more" path is not implemented.

## E. SLA durations are plain calendar hours

No business-hours/working-day calendar (spec section 67) — every
`slaDurationHours` and computed deadline is wall-clock time.

## F. Escalation actions beyond REMIND/MARK_BREACHED are audit-only stubs

`ADD_APPROVER`/`REASSIGN`/`NOTIFY_MANAGER`/`ESCALATE_TO_ROLE` record an
audit event describing the intended escalation but do not themselves
re-invoke `ApproverResolutionService` to actually add/reassign a live
`ApproverAssignment` row — disclosed gap, real re-resolution wiring is
a follow-up. `runDueEscalations` itself needs an external scheduler;
none is built in this phase (spec section 73's own durable timer is
the deadline column already being durable — the periodic *check* against
it is not wired to a cron job here).

## G. Not retrofitted into any prior phase's own posting handler

Per spec section 210's own boundary ("stable extension interfaces," not
a mandate to touch all 25 prior phases), no existing document's posting
handler (Payment Request, Expense Claim, Period Reopen, ...) calls
`WorkflowInstanceService.start`/`WorkflowExecutionGateService.
assertExecutionAllowed` yet. The stable API exists and is
independently tested (`test/phase26.e2e-spec.ts`); wiring a specific
business module to require it is left to that module's own future
change, consistent with "approval and business action are the SAME
principle" — the interface must exist NOW, the retrofit can happen
incrementally.

## H. Other acknowledged gaps

- No `WorkflowNotification` table — delivery channels are out of
  scope; workflow truth never depends on notification delivery by
  construction (there simply is no delivery-dependent state).
- `WorkflowCondition`, `WorkflowSLA`, and `WorkflowApprovalSnapshot` are
  folded into JSON/columns on `WorkflowStepDefinition`/
  `WorkflowInstance` rather than separate tables (spec's own entity
  list names them individually) — disclosed consolidation, matching
  this codebase's established "don't duplicate objects" convention.
- Digital-signature reference on a decision (spec section 81) is
  foundation-only via `ApprovalDecision.evidenceId` (linking to Phase
  25's own `AuditEvidence`) — no signature verification logic.
- Bulk approval (spec sections 78-79) is not implemented — every
  decision is per-instance.

## Permissions

`WORKFLOW_VIEW`, `WORKFLOW_VIEW_OWN`, `WORKFLOW_VIEW_DEPARTMENT`,
`WORKFLOW_APPROVE`, `WORKFLOW_REJECT`, `WORKFLOW_REQUEST_CHANGE`,
`WORKFLOW_DELEGATE`, `WORKFLOW_ADMIN`, `WORKFLOW_DEFINITION_VIEW`,
`WORKFLOW_DEFINITION_EDIT`, `WORKFLOW_DEFINITION_APPROVE`,
`WORKFLOW_RESTART`, `WORKFLOW_CANCEL`, `WORKFLOW_ESCALATE`,
`WORKFLOW_OVERRIDE_SOD`, `WORKFLOW_VIEW_AUDIT`, `WORKFLOW_VIEW_SENSITIVE`.
