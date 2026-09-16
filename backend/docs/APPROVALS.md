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

## Goods Receipt (increment 2)

`approvalStatus` added the same way. Plan is usually empty
(`NOT_REQUIRED`) — a single `WAREHOUSE_SUPERVISOR` step is only added when
a line's quantity exceeds its source PO line's remaining quantity
(`GoodsReceiptApprovalPlanProvider`). The over-quantity check itself moved
from posting-time-only to `resolveLines` (`create`/`update`): a line
exceeding remaining requires `GoodsReceiptLine.overReceiptReason` or the
save is rejected outright — never silently allowed as a draft.
`GoodsReceiptPostingHandler` blocks post unless `approvalStatus` is
`APPROVED` or `NOT_REQUIRED`, and — once `APPROVED` — skips its own
independent "exceeds remaining" hard-reject (the approval **is** the
authorization to exceed it). Editing lines re-plans (delete-and-recreate
`PENDING` steps) unless a step has already been decided, to avoid
discarding an in-progress approval.

A new `purchase_execution.price_view` permission gates whether a caller
sees or can override `price`/`lineTotal` on a Goods Receipt: without it,
`resolveLines` silently forces the linked PO line's price regardless of
what's submitted (not an error — see `goods-receipt.service.ts`), and
`get`/`list`/`create`/`update` responses strip `price`/`lineTotal` from
every line via `goods-receipt-redaction.util.ts`. `WAREHOUSE_USER` does
not hold this permission; `PROCUREMENT_OFFICER`/`FINANCE_USER`/
`ACCOUNTING_USER` do. Frontend: `DocKind.priceViewPerm` makes
`showPrice`/`showTax` permission-derived instead of static (currently only
`GoodsReceiptPage`) — see `DocDetailPage.tsx`/`DocListPage.tsx`.

## Purchase Invoice (increment 2)

`approvalStatus` added the same way, reusing the existing `ACCOUNTING`
step type (no new enum value). `PurchaseInvoiceApprovalPlanProvider`
compares each line's price against its source (the linked Goods Receipt
line if any, else the linked Purchase Order line) — a difference over 2%
(`PURCHASE_INVOICE_PRICE_VARIANCE_TOLERANCE_PERCENT`) requires
`ACCOUNTING_USER` approval before posting; within tolerance posts
directly. This is independent of `PurchaseMatchingService`'s own
on-demand, 0-tolerance three-way-match report, which is unchanged.

## Sales Order (increment 3, `src/sales-documents/`)

`approvalStatus` on `SalesOrder` predates this increment (a dead placeholder
column from an earlier phase) — this increment is the first to read or write
it. `SalesOrderApprovalPlanProvider` emits a single `SALES_MANAGER` step when
either the order's AZN-equivalent grand total exceeds
`SALES_ORDER_MANAGER_APPROVAL_THRESHOLD` (15,000), or `credit-check.util.ts`'s
threshold calculation returns `APPROVAL_REQUIRED` — one step either way, not
two. `SalesOrderPostingHandler.validateForPosting` (which already **is**
`ConfirmCustomerOrder`, spec section 22) refuses to confirm until
`approvalStatus` is `APPROVED` or `NOT_REQUIRED`.

The credit check itself changed shape: an order landing in the 10% grace band
above the counterparty's limit used to be a `WARNING` that never blocked
anything — a no-op. It now returns `APPROVAL_REQUIRED`/`REQUIRE_APPROVAL`
(values this codebase already defined but never produced) and requires the
same `SALES_MANAGER` approval before posting. A result beyond the grace band
is still `BLOCKED` — a hard stop no approval can override, checked again by
`validateForPosting` itself (independent of `approvalStatus`) exactly as
before. The threshold math is now in `sales-preorder/credit-check.util.ts`, a
pure function shared by `CreditCheckService.check` (posting-time, via
`this.prisma`) and the approval provider's `planSteps` (create-time, inside
the creation transaction) — extracted so both run the identical calculation
without one calling through the other's transaction boundary.

Auto-creating a `StockReservation` on order confirmation was attempted and
reverted in this same increment: it silently consumed the remaining-quantity
budget that `ReservationService`'s existing explicit, manual reservation call
depends on, breaking `sales-execution.e2e-spec.ts`'s reservation-consumption
test. Reservation stays exactly what `docs/SALES_PREORDER.md` already
documents it as — a separate, explicit action — and this increment does not
touch it.

## What's deliberately out of scope

Condition DSL, DAG-based conditional routing, quorum/voting, delegation,
SLA/escalation/timers, material-change reapproval detection, digital
signatures, approval inbox UI, bulk approval, route simulation, a GL
variance line for invoice price variance, and approval for any document
type beyond Purchase Requirement/Order/Goods Receipt/Purchase Invoice/Sales
Order, and auto-stock-reservation on Sales Order confirmation (tried and
reverted — see above). See
`docs/PURCHASE_EXECUTION.md`/`PROCUREMENT.md` and
`document-framework/base-document.ts`'s "Phase 26" comment for the
original deferred scope.
