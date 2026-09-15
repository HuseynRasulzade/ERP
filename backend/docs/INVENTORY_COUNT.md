# Inventory Count / İnventarizasiya (docx spec Phase 12)

A full reconciliation ENGINE, not one document: Plan -> Scope -> Snapshot
-> Freeze -> Session -> Sheets/Tasks -> Blind Count -> Recount -> Variance
-> Investigation -> Decision -> Costing -> Approval -> Posting ->
Reconciliation -> Close (spec section 5).

## A. Architecture

```
InventoryCountPlan ──has──► InventoryCountScope[] (filters, INCLUDE/EXCLUDE)
      │
      ▼ create session
InventoryCountSession (DRAFT→READY→SNAPSHOT_CREATED→COUNTING→...→CLOSED)
      │
      ▼ InventorySnapshotService.generate — ONE grouped query over
      │   Phase 10 InventoryMovement (never a cached number)
InventoryCountSnapshotLine[] (immutable, versioned)
      │
      ▼ generateSheets
InventoryCountSheet[] ──has──► InventoryCountTask[]
      │
      ▼ InventoryCountEntryService.record (blind, barcode, unit
      │   conversion, duplicate-serial validation, append-only versioning)
InventoryCountEntry[] (current = latest non-superseded per dimension key)
      │
      ▼ InventoryVarianceService.calculate — snapshot + post-snapshot
      │   movement delta vs physical count, per FULL dimension tuple
      │   (never netted across batch/location/serial)
InventoryVariance[] ──1:1──► InventoryVarianceDecision (via
      │                        InventoryVarianceResolutionService.decide)
      ▼
InventoryCountAdjustmentService.postFromDecision
      │  creates + posts a Phase 10 InventoryAdjustment (WRITE_OFF/SURPLUS)
      ▼
Phase 10 quantity + Phase 11 cost (FIFO/WAC) + Phase 4 accounting, all
through the SAME posting pipeline every other document in this codebase uses
      │
      ▼
InventoryCountReconciliationService.reconcile → .close
```

## B. Hard freeze — one choke point, zero new call sites

`inventory-freeze.guard.ts` exports a plain function (NOT an injectable
service) that `InventoryMovementService.recordMovement` — Phase 10's own
single write path for every stock-affecting movement in the platform —
calls before writing any row. This gives HARD_FREEZE blocking for every
document type (GoodsReceipt, Shipment, Returns, Transfers,
InternalConsumption, InventoryAdjustment, InventoryStatusTransfer)
automatically, with **no per-handler wiring**, and — critically — with no
NestJS module cycle: `inventory-count` depends forward on
`warehouse-inventory`'s tables (not vice versa), so `warehouse-inventory`
importing `inventory-count` as a *module* would create a cycle (since
`inventory-count` needs `inventory-costing`, which is a peer of
`warehouse-inventory`); a plain function import sidesteps that entirely.
`SOFT_FREEZE`/`NO_FREEZE_WITH_MOVEMENT_TRACKING` sessions never block —
`InventoryVarianceService` accounts for what happened afterward instead
(spec sections 13-15, 63-66).

## C. Variance calculation

For every dimension key present in EITHER the snapshot OR the current
entries (so an accounting-quantity-0/physical-quantity->0 item shows up
as `SURPLUS`, and an accounting-quantity->0/no-entry item shows up as
`UNCOUNTED_ITEM` — never silently zeroed, spec sections 84-86, 135):

1. `adjustedAccountingQuantity` = snapshot quantity + post-snapshot
   movement delta (skipped entirely for `HARD_FREEZE` sessions, where no
   such movement could have happened).
2. `physicalQuantity` = sum of CURRENT (non-superseded) entry base
   quantities for that exact key, or `null` if no entry exists at all.
3. `varianceType` from comparing the two — `MATCH` rows are not persisted
   (spec test 115).
4. Cost (`unitCost`/`valueDifference`) resolved live from Phase 11's open
   cost layers for that key's costing key — never a stale snapshot-time
   value (spec section 34).
5. Serial variance (`SERIAL_MISSING`/`SERIAL_UNEXPECTED`) is a SEPARATE
   pass comparing expected vs found serial SETS per product/warehouse —
   independent of the quantity-only comparison, so a net-zero quantity
   swap still surfaces (spec sections 24, 33, 122).
6. Recount requirement and severity are policy-driven from the plan's
   `recountPolicy`/thresholds (spec sections 37, 42).

## D. Posting

`InventoryVarianceResolutionService.decide` records an
`InventoryVarianceDecision`, then (unless `NO_ADJUSTMENT`/
`SOURCE_DOCUMENT_CORRECTION`) `InventoryCountAdjustmentService.postFromDecision`
creates a Phase 10 `InventoryAdjustment` (WRITE_OFF for a net shortage,
SURPLUS for a net surplus, tagged `sourceInventoryCountSessionId`) and
posts it through the standard `DocumentPostingService.post` pipeline —
the same permission/period/concurrency checks, and the same real Phase 11
FIFO/weighted-average costing (see `docs/INVENTORY_COSTING.md`), every
other document in this codebase gets for free.

## E. Disclosed simplifications (this build)

- **`LOCATION_TRANSFER`/`STATUS_TRANSFER` resolution types** post as a
  WRITE_OFF/SURPLUS `InventoryAdjustment` (reasonCode-tagged) rather than
  pairing two variance rows into a true `WarehouseTransfer`
  (`INTERNAL_LOCATION_TRANSFER`) or `InventoryStatusTransfer` — financial
  correctness (spec sections 52-53) is unaffected since transfers/status
  changes have no accounting consequence either way; only the
  non-financial "which document type recorded it" detail differs.
- **No `InventoryCountEntryVersion`/`InventoryCountTeam` tables** — entry
  correction history is a same-shaped new `InventoryCountEntry` row
  chained via `supersedesEntryId` (never overwritten in place, spec
  sections 29/79's real requirement, just without a second parallel
  table); a count team is the session's own free-text `teamMembersJson`.
- **No location-subtree traversal** — `InventoryCountScope.locationId`
  matches exactly; `includeSubtree` is stored but not yet expanded against
  `WarehouseLocation`'s own hierarchy.
- **Approval thresholds** (spec section 48) are not yet enforced as a
  dedicated `InventoryCountApprovalService` gate on `decide` — permission
  (`INVENTORY_COUNT_APPROVE`) is the control today; a value-tiered
  approval chain is Phase 26's own workflow engine boundary (spec section
  134).
- Cross-module references inside this phase's own tables (`productId`,
  `warehouseId`, `locationId`, `batchId`, `serialId`, `characteristicId`)
  are soft string references, not hard Prisma relations — this module's
  bulk snapshot/variance queries never need a database-level join through
  them (same convention as `CounterpartyDocument.ownerId`/`ownerType`).

## F. Permissions

`INVENTORY_COUNT_VIEW`, `_CREATE`, `_START`, `_CREATE_SNAPSHOT`,
`_FREEZE`, `_ENTER`, `_RECOUNT`, `_REVIEW`, `_APPROVE`,
`_POST_ADJUSTMENT`, `_CANCEL`, `_VIEW_ACCOUNTING_QTY`, `_VIEW_COST`,
`_OVERRIDE_VARIANCE`, `_CLOSE` — see `rbac/permission-codes.ts`. Cost
confidentiality (spec section 77) is enforced by callers gating
`unitCost`/`stockValue`/`valueDifference` fields behind
`INVENTORY_COUNT_VIEW_COST` before returning variance/snapshot rows to a
counter-only role — the service layer always computes and stores them;
what a given API response includes is a controller-layer decision.

## G. Integration points for later phases (spec section 106-107)

`InventoryCountReconciliationService.hasOpenInventoryCounts(tenantId,
organizationId, period?)` is the query Phase 22's Month Close is meant to
call before allowing a period to close.
