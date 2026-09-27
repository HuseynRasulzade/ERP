# Inventory Count / Reconciliation Engine (docx spec Phase 12)

Module: `src/inventory-count/`. Builds on Phase 0 (document framework
primitives, audit, numbering), Phase 1 (organization/warehouse), Phase 2
(product/batch/serial master data), Phase 4 (accounting/posting engine),
Phase 10 (`InventoryMovement` register, `InventoryAdjustment`/
`WarehouseTransfer`/`InventoryStatusTransfer` documents), and Phase 11
(`InventoryCostingService` for valuation).

A prior build already shipped the plan/scope/snapshot/freeze/session/
sheet/entry half of this engine (steps 1-8 of the spec's own development
order, section 137) — see each service's own doc comment for that half.
This build completes steps 9-20: the variance engine, recount, decision/
approval, real posting through Phase 10's existing documents, Phase 11
costing integration, reconciliation, and reporting.

## A. Architecture — a process, not a document

Inventory Count is modelled as a multi-entity process aggregate, never a
single document:

```
InventoryCountPlan --scopes--> InventoryCountScope
        |
        v
InventoryCountSession --snapshot--> InventoryCountSnapshotLine (immutable)
        |
        v
InventoryCountSheet --> InventoryCountEntry --> InventoryCountEntrySerial
                                              --> InventoryCountEntryVersion
        |
        v (InventoryVarianceService.calculate)
InventoryVariance --> InventoryRecount (0..n, never overwrites the original)
        |
        v (InventoryVarianceResolutionService)
InventoryVarianceDecision (PENDING -> APPROVED -> POSTED)
        |
        v (InventoryCountAdjustmentService)
InventoryCountAdjustmentLink --> InventoryAdjustment | WarehouseTransfer | InventoryStatusTransfer
        |
        v (InventoryCountReconciliationService)
InventoryCountReconciliation (NOT_STARTED -> ... -> BALANCED -> CLOSED)
```

Session status machine: `DRAFT -> SNAPSHOT_CREATED -> COUNTING ->
UNDER_REVIEW -> (RECOUNT_REQUIRED)* -> PENDING_APPROVAL -> APPROVED ->
POSTED -> RECONCILED -> CLOSED`, with `CANCELLED` reachable any time no
adjustment has posted yet. A session with **no** non-MATCH variance (or
every one auto-accepted within tolerance) skips straight from variance
calculation to `APPROVED` — there is nothing for a human to approve.

## B. Variance engine (`inventory-variance.service.ts`)

`InventoryVarianceService.calculate` is the central comparison service
(spec sections 31-36). It is deliberately re-runnable while the session
sits in `UNDER_REVIEW`/`RECOUNT_REQUIRED`: a variance row already
`APPROVED`/`POSTED` is left untouched by a later recalculation (spec
section 47 — a decided variance is never silently overwritten by a
refresh); everything still open is recomputed.

Never a per-product net (spec section 33): every row is keyed by the FULL
dimension tuple — warehouse, location, product, batch, ownership,
quality status. A Batch A `-10` / Batch B `+10` pair stays two rows even
though the product-level net is zero, and `classifyMismatches` tags such
a pure-redistribution pair `LOCATION_MISMATCH`/`BATCH_MISMATCH` instead of
letting it read as an unremarkable cancelling `SURPLUS`/`SHORTAGE` — only
when the group's net is genuinely ~zero; a real net difference is left as
ordinary `SURPLUS`/`SHORTAGE` on each row. Serial identity (spec section
24) is compared independently of quantity — `SERIAL_MISSING`/
`SERIAL_UNEXPECTED` rows are written even when the counted quantity
matches exactly.

**Movement cutoff** (spec sections 14-15): `NO_FREEZE_WITH_MOVEMENT_TRACKING`
(the default) never blocks a stock-affecting posting — instead,
`adjustedAccountingQuantity = snapshotQuantity + post-snapshot movements
up to the session's cutoff` is computed per (warehouse, location) from
Phase 10's own `InventoryMovement` register, scoped to exactly this
session's own sheets (a warehouse/location outside the count's scope is
never touched — spec section 125's own isolation test). `effectiveDate`
is a DATE column throughout this codebase (business-date granularity, not
wall-clock) — a same-day-later movement compares as "on or before" the
snapshot timestamp; the cutoff/reconciliation windows here inherit that
same day-level granularity rather than introducing a parallel
finer-grained clock Phase 10 does not have.

**Tolerance & auto-accept** (spec section 43): a variance within the
plan's quantity/value/percentage tolerance is auto-decided
`NO_ADJUSTMENT` (approver `"system"`, still audited via
`INVENTORY_VARIANCE_AUTO_ACCEPTED`) rather than left for a human.

**Recount policy** (spec sections 37, 40): `RECOUNT_REQUIRED` on the
variance row (and, transitively, on the session) is driven by the plan's
`recountPolicy` against the *current* difference — a variance recomputes
`recountRequired` after every recount submission, so it clears once the
final count lands within whatever threshold the policy set, exactly
matching the spec's own worked example (accounting 100, first count 90 —
10% over a 5% threshold — recount to 99 — 1%, clears).

## C. Recount (`inventory-recount.service.ts`)

Each attempt is its own `InventoryRecount` row — the original
`InventoryCountEntry` and every prior attempt stay in history untouched
(spec section 38). Final-quantity selection is the simplest of the
spec's own listed options (section 41): the **latest completed recount**
wins. A supervisor-confirmed/consensus variant, and independent-counter
enforcement (spec section 39), are not built — disclosed simplifications.
`maxRecountAttempts` (from the plan) bounds how many attempts are allowed
before the variance stops demanding another one regardless of policy.

## D. Decision & approval (`inventory-variance-decision.service.ts`)

`InventoryVarianceDecision` records **how** a variance will be resolved
before any posting exists — `resolutionType` picks the shape of the fix
(spec section 49), `reasonCode` the catalog reason (spec section 45).
Approval is a separate, explicit step (`INVENTORY_COUNT_APPROVE`) —
segregation-of-duties enforcement beyond "a decision exists" (spec
section 74: counter ≠ approver, warehouse keeper cannot approve their own
count) is not built; the permission gate is the only control here.

## E. Turning a decision into a real posting (`inventory-count-adjustment.service.ts`)

Reuses Phase 10's **existing** document types rather than a fourth,
duplicate posting mechanism (spec section 51):

| `resolutionType`                        | Document posted                                    |
|------------------------------------------|-----------------------------------------------------|
| `ADJUST_STOCK` / `WRITE_OFF` / `SURPLUS_RECOGNITION` / `BATCH_CORRECTION` / `SERIAL_CORRECTION` | `InventoryAdjustment` (`WRITE_OFF` when the accepted difference is negative, `SURPLUS` otherwise) |
| `LOCATION_TRANSFER`                       | `WarehouseTransfer` (`INTERNAL_LOCATION_TRANSFER`)  |
| `STATUS_TRANSFER`                         | `InventoryStatusTransfer`                           |
| `NO_ADJUSTMENT` / `SOURCE_DOCUMENT_CORRECTION` | nothing — the variance is marked resolved with no stock/GL consequence |

`BATCH_CORRECTION`/`SERIAL_CORRECTION` are disclosed simplifications:
they post as an ordinary `InventoryAdjustment` write-off/surplus pair
against the batch dimension the document line already carries, rather
than a bespoke "re-batch"/"re-serialize" document this codebase has no
other use for. A `LOCATION_TRANSFER` is auto-paired against the one other
`LOCATION_MISMATCH` row for the same product when exactly one candidate
exists (the common case, matching the spec's own two-location example);
otherwise the caller must supply `targetLocationId` explicitly. A
`STATUS_TRANSFER` always requires an explicit `targetQualityStatus` — the
engine has no reliable way to infer which quality bucket a shortage
"really" moved to.

Every created document is linked back to the session via
`InventoryCountAdjustmentLink` **before** it posts — `InventoryFreezeService`
recognizes that link and exempts the session's own correction from its
own freeze (spec section 12's "otherwise a HARD_FREEZE could never be
lifted by the very posting that is supposed to end it").

`postAdjustments` is idempotent (a document already `POSTED` is skipped,
not re-posted — spec section 58/test 129) and refuses to run while any
variance still needs a recount (`CountRecountPendingError`, spec test
123's own error wording) or while `assertNotStale` detects that a new,
unrelated movement has landed in scope since a variance was approved
(`CountReconciliationStaleError`, spec section 60/test 130) — skipped
entirely under `HARD_FREEZE`, where such a movement is physically
impossible.

## F. Reconciliation & close (`inventory-count-reconciliation.service.ts`)

`InventoryCountReconciliation` aggregates the session's own variance rows
and adjustment links — `status` is `DIFFERENCES_FOUND` while any
non-MATCH variance is still open, `ADJUSTMENTS_PENDING` while a linked
document hasn't posted yet, else `BALANCED`. `close` refuses unless
reconciliation is `BALANCED` and every sheet is `COMPLETED` (spec section
69); `cancel` refuses once any linked document has posted (spec section
70) — a count session's snapshot/history is never physically deleted
either way.

## G. Reporting (`inventory-count-reporting.service.ts`)

All read-only projections over the rows the operational services already
write — no separate reporting tables. `dashboard` (spec section 88),
`varianceReport`/`surplusShortageReport`/`serialVarianceReport`/
`batchVarianceReport`/`locationReconciliationReport` (sections 89-94), and
a per-product `countHistoryReport` (section 91) across every session in
the organization.

## H. Disclosed simplifications

- **Segregation of duties** (spec section 74) is not enforced beyond the
  permission gate — no "approver ≠ counter" check.
- **Recount** always selects the latest attempt; supervisor-confirmed and
  median/consensus selection (spec section 41) are not built.
- **`BATCH_CORRECTION`/`SERIAL_CORRECTION`** post as ordinary
  `InventoryAdjustment` lines rather than a dedicated re-batch/re-serialize
  document (section D above).
- **Root-cause-before-adjustment** (spec section 46 — offering to post an
  unposted source document instead of an inventory adjustment) is not
  built; the user must do that themselves before recording the count's
  own decision.
- **Printable count sheets, CSV/mobile import, and offline sync**
  (spec sections 72, 80-82) are not built — this build is the engine and
  its HTTP API, not the field-capture UX.
- **Month-close/health-suite integration hooks** (spec sections 106-107,
  Phases 22/30) are left for those phases to call into — the session's
  own `status`/`reconciliationStatus` fields are the interface they need.

## I. API surface

```
GET/POST   /organizations/:orgId/inventory-count/sessions/:id/variances
POST       /organizations/:orgId/inventory-count/sessions/:id/calculate-variances
POST       /organizations/:orgId/inventory-count/sessions/:id/variances/:varianceId/reason
GET/POST   /organizations/:orgId/inventory-count/sessions/:id/recounts
POST       /organizations/:orgId/inventory-count/sessions/:id/variances/:varianceId/recounts
POST       /organizations/:orgId/inventory-count/sessions/:id/recounts/:recountId/submit
POST       /organizations/:orgId/inventory-count/sessions/:id/variances/:varianceId/decide
POST       /organizations/:orgId/inventory-count/sessions/:id/variances/:varianceId/approve
POST       /organizations/:orgId/inventory-count/sessions/:id/variances/:varianceId/reject
POST       /organizations/:orgId/inventory-count/sessions/:id/create-adjustments
POST       /organizations/:orgId/inventory-count/sessions/:id/post-adjustments
GET/POST   /organizations/:orgId/inventory-count/sessions/:id/reconcile[iation]
POST       /organizations/:orgId/inventory-count/sessions/:id/close
POST       /organizations/:orgId/inventory-count/sessions/:id/cancel
GET        /organizations/:orgId/inventory-count/sessions/:id/dashboard
GET        /organizations/:orgId/inventory-count/sessions/:id/reports/*
GET        /organizations/:orgId/inventory-count/reports/count-history?productId=
```

## J. Tests

`test/inventory-count.e2e-spec.ts` covers the spec's own listed scenarios
(sections 115-132): basic zero-variance count, shortage and surplus end
to end (variance → decide → approve → create/post adjustment → stock and
reconciliation), blind count, post-snapshot movement reconciliation under
`NO_FREEZE`, location and batch mismatch (net-zero, never hidden), serial
mismatch, recount (original preserved, final approved count wins), hard
freeze (blocks an unrelated posting into the locked warehouse), uncounted
vs. explicit zero, idempotent adjustment posting, a stale-reconciliation
block under a concurrent post-approval movement, and tenant isolation.
