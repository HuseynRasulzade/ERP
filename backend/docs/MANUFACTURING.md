# Phase 21 — Manufacturing / Production Engine

Implements docx spec Phase 21: Bill of Materials, Routing, Production
Order, Material Issue (consumption + return), Operation Execution
(labor/machine/scrap), Production Output Receipt, Overhead allocation,
WIP/cost tracking, variance calculation, and production close.

```
BillOfMaterials ─┬─ BOMVersion ── BOMLine (recursive, phantom-explodable)
                  │
Routing ──────────┼─ RoutingVersion ── RoutingOperation (sequence-ordered)
                  │
WorkCenter        │
                  │
ProductionOrder ──┼─ ProductionOrderOutput (MAIN/CO/BY product)
   (Document)     ├─ ProductionMaterialRequirement (from BOM explosion)
                  │
MaterialIssue ────┤  (ISSUE|RETURN, Document)
   (Document)     │       └─ InventoryMovementService + InventoryCostingService (Phase 10/11)
                  │
OperationExecution├─ ProductionLaborInput
                  ├─ MachineTimeInput
                  └─ ScrapRecord

ProductionCostMovement  <— unified WIP + cost-movement register, all of the above post into it

ProductionOutputReceipt ── (Document) transfers WIP → FINISHED_GOODS/MATERIAL_INVENTORY

ProductionOverheadPool ── OverheadService.allocate → ProductionCostMovement (OVERHEAD)

ProductionVariance ── ProductionCloseService.calculateVariances / close
```

## A. BOM unit-of-measure assumption (spec section 1)

`BOMLine.quantity` is expressed in the line's own `unitId`, and
`BOMService.explode` does not perform cross-unit-of-measure conversion —
every quantity involved in an explosion (component and output) is
assumed to already be in compatible/base units. A real UoM-conversion
engine (e.g. component stocked in kg but consumed in g) is out of scope
for this phase; disclosed under section H below.

## B. WorkCenterGroup folded into `WorkCenter.groupCode` (spec section 1)

The spec's separate `WorkCenterGroup` concept is folded into a plain
`groupCode` string column on `WorkCenter` rather than a normalized
master table + FK, consistent with this codebase's "don't duplicate
objects" discipline when the grouping concept has no behavior of its
own beyond a label used by `OverheadService`'s driver aggregation.

## C. Routing precedence is sequence-only (spec section 1)

`RoutingOperation.sequence` is a plain integer ordering; there is no
operation-dependency graph (parallel/alternate routing paths, "operation
B can only start after operation A finishes" constraints). Operations
are assumed to execute in ascending sequence order on a single order.

## D. MaterialIssue reused for RETURN (spec section 2)

Rather than a separate `MaterialReturn` document type, `MaterialIssue`
carries an `issueType: 'ISSUE' | 'RETURN'` discriminator on the same
table/document type (`MATERIAL_ISSUE_TYPE`), mirroring the established
pattern elsewhere in this codebase (e.g. `MaterialIssueLine` reused for
both directions). A RETURN restores stock at the ORIGINAL issue line's
own realized cost (`InventoryCostingService.getRealizedUnitCost`),
falling back to current cost only if the original line is untraceable.

## E. ProductionOutputReceipt reused for semi-finished (spec section 2)

Rather than a separate `SemiFinishedReceipt` document type,
`ProductionOutputReceipt.outputKind: 'FINISHED' | 'SEMI_FINISHED'`
discriminates the posting target (`FINISHED_GOODS` vs
`MATERIAL_INVENTORY`), since the underlying receipt mechanics (transfer
WIP → inventory at a provisional unit cost) are identical.

## F. ProductionCostMovement unifies WIP + cost registers (spec section 3)

The spec describes both a "WIP Movement Register" and a "Production
Cost Movement Register" as conceptually separate ledgers. This
implementation uses one table, `ProductionCostMovement`, with a
`costComponent` discriminator (`DIRECT_MATERIAL` / `DIRECT_LABOR` /
`MACHINE_TIME` / `OVERHEAD` / `OUTPUT_TRANSFER` / `SCRAP_REDUCTION` /
`COST_ADJUSTMENT`) and `costIn`/`costOut` columns — the running
`costIn - costOut` balance per production order IS the WIP balance, so
no second table is needed to answer "what is WIP right now."

## G. Output cost allocation formula (spec section 4)

Each `ProductionOutputReceipt` values its transfer at a **provisional**
unit cost computed as:

```
unitCost = currentOrderWipBalance / remainingPlannedQuantityAcrossAllOutputs
```

i.e. the order's current WIP balance (materials + labor + machine +
overhead posted so far, net of prior transfers) divided by the total
planned-but-not-yet-received quantity across ALL of the order's
outputs (main + co + by-products combined). This is applied uniformly
regardless of `costAllocationMethod` (`BY_QUANTITY`, or any other
configured value) — a genuine multi-output cost-splitting engine (e.g.
weighting co-products by relative sales value, per the spec's own
`allocationWeight` field) is NOT implemented; `allocationWeight` is
stored but currently unused by the formula. This keeps every unit
received at the same moment costed identically and keeps the running
WIP balance converging toward zero as the order completes, but is a
simplification versus a full joint-cost-allocation method.

## H. Overhead driver limitations (spec section 5)

`OverheadService.allocate` supports exactly four driver types
(`DIRECT_LABOR_HOURS`, `MACHINE_HOURS`, `DIRECT_MATERIAL_COST`,
`UNITS_PRODUCED`), each computed by summing the relevant
`ProductionCostMovement`/input rows across open orders in the pool's
scope and allocating proportionally. There is no support for a
custom/formula-based driver, and a pool's `costCenterId`/
`workCenterGroupCode` scoping is a simple equality filter, not a
hierarchical rollup.

## I. Variance coverage (spec section 6)

`ProductionCloseService.calculateVariances` computes only
`MATERIAL_USAGE` (actual vs. BOM-standard component consumption) and
`LABOR_EFFICIENCY` (actual vs. routing-standard labor hours) variances.
`MATERIAL_PRICE`, `LABOR_RATE`, `OVERHEAD`, and `YIELD` are valid
`ProductionVariance.varianceType` enum values (schema-ready for a
future phase) but are not computed by this service.

## J. Disclosed simplifications (summary)

- No cross-unit-of-measure conversion in BOM explosion (section A).
- `WorkCenterGroup` is a plain string column, not a master table (B).
- Routing operation precedence is sequence-only; no dependency graph (C).
- `MaterialIssue` serves both ISSUE and RETURN via `issueType` (D).
- `ProductionOutputReceipt` serves both FINISHED and SEMI_FINISHED via
  `outputKind` (E).
- One `ProductionCostMovement` table serves as both the WIP register
  and the cost-movement register (F).
- Output cost allocation is a uniform WIP-balance-over-remaining-
  quantity formula; `allocationWeight`/joint-cost methods are not
  implemented (G).
- Overhead driver types are limited to four fixed formulas; no custom
  driver or hierarchical cost-center rollup (H).
- Only MATERIAL_USAGE and LABOR_EFFICIENCY variances are computed;
  MATERIAL_PRICE/LABOR_RATE/OVERHEAD/YIELD are schema-only (I).
- Labor/machine-time WIP postings use provisional GL accounts
  (`ADMIN_EXPENSE` for labor, `OTHER_OPERATING_EXPENSE` for machine
  time as the credit side) rather than a dedicated payroll-cost-
  absorption or machine-cost-absorption account — consistent with this
  being a cost-tracking simplification, not a full standard-costing
  variance-absorption model.
- `ProductionOrderPostingHandler` reserves stock by writing directly to
  the shared/generic `stock_reservations` table (the same model Sales
  uses) rather than through the sales-specific `ReservationService`,
  since that service's API is scoped to sales documents while the
  underlying schema is polymorphic; best-effort only (a shortage does
  not block release).
- No subcontracting workflow (`RoutingOperation.subcontracted` is
  stored but not acted upon).
- No backflush costing automation (`RoutingOperation.backflushMaterials`
  is stored but not acted upon — all material issues in this phase are
  explicit documents).
- Production order release posts no GL entry itself; GL activity begins
  with the first material issue / labor / machine / overhead posting.

## Permissions

`PRODUCTION_ENGINEERING_EDIT` (BOM/Routing/WorkCenter master data),
`PRODUCTION_ORDER_CREATE`, `PRODUCTION_ORDER_RELEASE`,
`PRODUCTION_MATERIAL_ISSUE`, `PRODUCTION_EXECUTION_RECORD`
(labor/machine/scrap), `PRODUCTION_OUTPUT_RECEIVE`,
`PRODUCTION_OVERHEAD_MANAGE`, `PRODUCTION_ORDER_CLOSE`,
`PRODUCTION_VARIANCE_VIEW`, `PRODUCTION_VIEW`.
