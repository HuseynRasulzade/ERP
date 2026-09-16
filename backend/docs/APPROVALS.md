# Approval Workflow MVP

A scoped, purpose-built multi-stage approval mechanism for Purchase
Requirement and Purchase Order — not the full generic enterprise workflow
engine the wider spec calls "Phase 26" (`~/Downloads/Pahse/Phase 26.docx`:
DAG routing, quorum, delegation, SLA/escalation, digital signatures, 20+
entities, depending on Phase 17 employee hierarchy and Phase 25 immutable
audit, neither of which exists in this build). This is a deliberately
smaller increment that establishes the same core principle Phase 26 itself
states — **Document State, Approval State, and Posting State are three
independent axes; approving a document never posts it** — with an
extension seam so a later increment can add Goods Receipt / Purchase
Invoice / Sales Order approval without a rewrite.

## Architecture

- `approvalStatus` (`NOT_REQUIRED | PENDING | APPROVED | REJECTED`) is a
  column on `PurchaseRequirement` and `PurchaseOrder`, independent of the
  existing `DocumentStatus`/`PostingStatus` pair.
- `ApprovalStep` (`prisma/schema.prisma`) is a generic table — one row per
  required approval on a document instance, keyed by the same polymorphic
  `documentType` + `documentId` string pair used throughout
  `document-framework`/`RegisterMovement`.
- `src/approvals/` is a small standalone module (kept separate from
  `DocumentFrameworkRegistry` on purpose — approval and posting are
  independent axes):
  - `ApprovalPlanProvider` (interface) — the extension seam. One
    implementation per document type: `planSteps` computes which steps a
    specific document instance needs, `resolveApprover` checks whether a
    user may act on a given pending step, `loadDocument`/
    `setApprovalStatus` are the generic read/write hooks so `ApprovalService`
    itself never branches on document type.
  - `ApprovalPlanRegistryService` — strategy registry, same shape as
    `DocumentFrameworkRegistry`.
  - `ApprovalService` — `createStepsForDocument` (called once, inside the
    same transaction as document creation), `approve`/`reject` (sequential:
    only the earliest `PENDING` step can be acted on), `getSteps`.
  - `purchase-requirement-approval-plan.provider.ts` /
    `purchase-order-approval-plan.provider.ts` (in `src/procurement/`) —
    the two concrete plans (see below).

## Purchase Requirement

One step: `DEPARTMENT_HEAD`. Resolved via
`Department.managerPersonId → ResponsiblePerson.userId`; if the department
has no manager assigned, falls back to any user holding role
`DEPARTMENT_HEAD` whose `OrganizationAccess.departmentId` matches. No
downstream document may be created from an unapproved requirement — this
is enforced at every creation path that reads a `PurchaseRequirementLine`
(`ProcurementPlanningService.createPurchaseOrderFromRequirement(s)` AND
`PurchaseOrderService.resolveLines`, since a raw `requirementLineId` can
otherwise reach the direct `POST /purchase-orders` endpoint too).

## Purchase Order

`PROCUREMENT_OFFICER` → `DEPARTMENT_HEAD` → `DIRECTOR` always (the
`DEPARTMENT_HEAD` step auto-`SKIPPED` when the order has no
requirement-linked lines to resolve a department against); `FINANCE`
appended when the AZN-equivalent grand total exceeds 10,000; `ACCOUNTING`
appended when line tax rates are non-standard (some lines zero-rated,
others not). `PurchaseOrderPostingHandler.validateForPosting` refuses to
confirm (`postingStatus = POSTED` is this document type's de-facto
"confirmed" state — see `PROCUREMENT.md`) until `approvalStatus =
APPROVED`. `GoodsReceiptService.create` refuses to receive against a
not-fully-approved order.

## Self-approval / segregation of duties

`ApprovalService.decide` rejects if the acting user is the document's own
`createdBy` — the single hardcoded SoD check this MVP implements (not the
full `SegregationRule` entity system Phase 26 describes).

## RBAC

Module-scoped permission codes (`purchase.requirement.approve/reject`,
`purchase.order.approve/reject`) — not the generic `documents.*` family,
since eligibility differs by document type. Step-type eligibility is
checked by **Role.code identity** (`PROCUREMENT_OFFICER`,
`DEPARTMENT_HEAD`, `DIRECTOR`, `FINANCE_USER`, `ACCOUNTING_USER`) — a
deliberate, narrow exception to this codebase's usual "only check
permission codes" convention, because a single flat permission can't
distinguish which of several named approver categories a user belongs to.
`src/seed/seed-data.ts` seeds these five roles (curated permission subset
each) plus four inert placeholders (`WAREHOUSE_USER`, `SALES_USER`,
`SALES_MANAGER`, `AUDITOR`, view-only) under a demo tenant/org/department
(`acme` / `sinteks` / `PROCUREMENT`), with one named test user per role
(`department_head@acme.test` etc., password `Passw0rd!23`).

## What's deliberately out of scope

Condition DSL, DAG-based conditional routing, quorum/voting, delegation,
SLA/escalation/timers, material-change reapproval detection, digital
signatures, approval inbox UI, bulk approval, route simulation, and
approval for any document type beyond Purchase Requirement/Order. See
`docs/PURCHASE_EXECUTION.md`/`PROCUREMENT.md` and
`document-framework/base-document.ts`'s "Phase 26" comment for the
original deferred scope.
