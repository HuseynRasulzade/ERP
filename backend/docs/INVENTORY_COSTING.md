# Inventory Costing Engine (docx spec Phase 11)

The module (`src/inventory-costing/`) already existed in this codebase — this
write-up, and `test/inventory-costing.e2e-spec.ts`, are what was missing. It
is fully wired into every other module that moves stock: Goods Receipt,
Shipment, Sales Invoice (COGS), Sales Return, Purchase Return*, Internal
Consumption, Inventory Adjustment (write-off/surplus), and Warehouse
Transfer. (*See Disclosed gaps — Purchase Return is the one exception.)

## Architecture: a thin facade over two pluggable strategies

```
InventoryCostingService (the only export every posting handler depends on)
  .receiveCost()   — Goods Receipt, Surplus, Sales Return restoration
  .consumeCost()   — Shipment, Internal Consumption, Write-Off
  .transferCost()  — Warehouse Transfer (consume source + receive destination)
  .applyCostDelta() — manual/late-invoice cost corrections
      |
      v
CostingPolicyService.resolve(orgId, date) -> InventoryCostingPolicy | null
      |
      v
strategyFor(policy)  ->  FifoCostingStrategy | WeightedAverageCostingStrategy
```

Every method resolves the organization's active, effective-dated
`InventoryCostingPolicy` first and is a **complete no-op** (returns `null`,
writes nothing) when none is configured — see "The no-policy no-op" below.
`CostingDimensionService.resolveCostingKey` builds the aggregation key
(`organizationId:productId:warehouseId-or-*:batchId-or-*`) from the policy's
own `costByWarehouse`/`costByBatch` flags — the costing pool does not have
to match the physical stock register's own dimensions (e.g. two warehouses
can share one average cost while Phase 10 still tracks their physical stock
separately).

## FIFO vs Weighted Average

- **FIFO** (`FifoCostingStrategy`): every receipt opens an immutable
  `InventoryCostLayer`; every consumption drains the OLDEST open layer
  first, ordered by `(receiptDate, postingSequence)` — `postingSequence` is
  a DB autoincrement, never a timestamp, so same-day receipts still have a
  stable order. A purchase-return-to-supplier can instead target one exact
  layer (`preferSourceLayerId`) rather than blind FIFO order.
- **Weighted Average** (`WeightedAverageCostingStrategy`): holds NO mutable
  "average cost" field anywhere — `quantity`/`totalCost` on
  `InventoryCostMovement` are both signed, so `SUM(totalCost)/SUM(quantity)`
  over a costing key at any point in time IS the average as of that point.
  `MOVING_AVERAGE` recomputes after every movement; `PERIODIC_WEIGHTED_AVERAGE`
  costs every issue during an open month PROVISIONALLY at the
  opening-of-month rate, with the true period average only computed once at
  `CostingPeriodService.finalize`.

Verified end-to-end in the e2e suite: a FIFO shipment spanning two layers
at different unit costs produces the exact non-blended total (never an
averaged cost when the method is FIFO), and a weighted-average shipment
costs at the exact running average.

## Real COGS at Sales Invoice time — the seventh module wired in

`ShipmentPostingHandler` calls `consumeCost` at the physical stock-out
event itself but posts NO GL consequence of its own (this platform's
existing "no GL on Shipment" boundary). `SalesInvoicePostingHandler` reads
the cost back via `CostingService.getCostForShipmentLine` — keyed by
`sourceDocumentType/sourceDocumentId/sourceDocumentLineId`, so it is exact
even when several same-day shipments of the same product post at different
FIFO costs — and posts `Dr COGS / Cr Goods Inventory`, falling back to
`CostingService.getUnitCost` (a naive receipt-price average) only for
movements the costing engine never touched. Both paths return `null`
— never a fabricated cost — when nothing is knowable, and every caller
skips the COGS line entirely rather than posting a guess.

**Correction to this repository's own earlier disclosures**: the root
README's Sales Execution section previously stated "COGS is never
fabricated (Costing doesn't exist yet — every COGS attempt is honestly
skipped)". That was accurate before this module existed; it is now stale
and has been corrected — COGS **is** posted, for real, once an organization
adopts a costing policy.

## Internal Consumption / Inventory Adjustment GL posting

`InternalConsumptionPostingHandler` and `InventoryAdjustmentPostingHandler`
(WRITE_OFF/SURPLUS) both call `consumeCost`/`receiveCost` per line and post
`Dr Expense / Cr Inventory` or `Dr Inventory / Cr Other Income`
respectively — never a fabricated value when no costing policy is
configured (the line is silently excluded from that document's GL batch,
exactly as before this module existed). A manual `costReference` on a line
always wins over the engine's own computed cost when supplied.

**Bug found and fixed while writing tests for this phase**: both
handlers' inventory-account GL lines (the WRITE_OFF credit line and the
SURPLUS debit line, both against account `205`/`GOODS_INVENTORY`) were
missing the `PRODUCT` dimension that account 205 requires
(`AZ_DEFAULT_DIMENSION_RULES['205'] = ['PRODUCT', 'WAREHOUSE']`). This was
never caught before because no earlier test both adopted a costing policy
AND wrote off/surplussed inventory — with no policy configured, `consumeCost`/
`receiveCost` return `null`, `lineTotal` stays `null`, and the handler skips
building any GL line at all, so the missing dimension was never reached.
Fixed by giving both lines the same `{ WAREHOUSE, PRODUCT }` dimension set
the write-off/surplus counter-account line already had.

## Warehouse Transfer

`WarehouseTransferPostingHandler` calls `InventoryCostingService.transferCost`
— internally a `consumeCost` at the source costing key followed by a
`receiveCost` at the destination, at the exact unit cost that came out,
never re-derived. Total value is unchanged; this is a pure reclassification.

## Manual Inventory Cost Adjustment: on-hand vs. COGS split

`InventoryCostAdjustmentService.create()` calls
`InventoryCostingService.applyCostDelta` at CREATE time (not at post time) —
the subledger mutation (raising a FIFO layer's `currentUnitCost`, or a
value-only movement for weighted average, which has no per-receipt layer to
split against) happens immediately; posting only turns the already-computed
`onHandAmount`/`cogsAmount` split into a balanced GL entry. For FIFO with a
known source receipt line, the split is proportional to the layer's
still-on-hand quantity vs. already-consumed quantity — the critical rule
"never dump a late cost correction entirely onto current stock when part of
that receipt was already sold" (verified in the e2e suite: a $100 late
correction against a 100-unit layer with 40 already shipped splits $60 to
inventory / $40 to COGS, exactly).

## Backdated-movement recalculation

`flagIfBackdated` (called from every `receiveCost`/`consumeCost`) detects a
movement dated earlier than the latest one already on record for that
costing key and queues an `InventoryCostRecalculationQueue` entry.
`InventoryCostRecalculationService.processPendingQueue` performs a FULL
REBUILD of the affected costing key — deletes and recreates every
`InventoryCostLayer`/`InventoryCostConsumption`/`InventoryCostComponent`,
replaying every `InventoryCostMovement` in `effectiveDate` order — a
disclosed simplification of "start at the earliest affected date only"
(the spec's own performance guidance), chosen for correctness over
performance. Every outgoing movement whose recomputed cost differs from
what was originally recorded gets a DRAFT `InventoryCostAdjustment` line
(`reason: SYSTEM_RECALCULATION`) — a human decides whether/how to post the
correction; nothing is silently rewritten.

## Costing Periods

`CostingPeriodService` is a costing-specific period gate alongside Phase
0's `AccountingPeriod`. `finalize(year, month)` blocks while any pending
recalculation for that period (or earlier) exists, or an unresolved
BLOCKING `InventoryCostingError` remains. Once finalized,
`assertPeriodOpen` (called from every `receiveCost`/`consumeCost`) refuses
any further cost-affecting posting into that period until `reopen()`.

## Negative-stock costing — never blocks the physical posting

When a Shipment/Internal Consumption/Write-off tries to consume more than
is available in the cost register (FIFO ran out of eligible layers, or a
weighted-average pool has none), the strategy either falls back to a
provisional cost (per `negativeStockCostPolicy`: `LAST_KNOWN_COST` |
`CURRENT_AVERAGE` | `STANDARD_COST` | `ZERO_PENDING`) or, if the policy sets
`allowNegativeQuantityCosting: false` (or `BLOCK_COSTING`), raises
`NoEligibleCostLayerError` — which `InventoryCostingService.consumeCost`
catches, records as an `InventoryCostingError`, flags the movement's
`costingStatus: 'ERROR'`, and returns `null`. The physical (quantity)
posting this always runs alongside is **never** blocked by a costing
failure — this codebase's own explicit "silent inconsistency olmaz" rule:
the error is recorded, never swallowed, but the document still posts.

## Reporting and Health

`InventoryCostingReportingService` provides `valuation`/`valuationAsOf`
(live aggregates over `InventoryCostMovement`, never a stored mutable
"current value"), `cogsReport`, `layerReport` (FIFO drill-down with
consumption/adjustment history per layer), and `health` — negative
remaining layers, pending recalculations, unresolved errors, provisional
movements, and a quantity/value reconciliation check (a costing key with
~zero cumulative quantity but non-zero remaining value).

**Added while writing tests for this phase**: `health` now also reports
`uncostedMovementsBeforeAnyPolicy` and `uncostedMovementsWithActivePolicy`
— see "The no-policy no-op" below, this is the health signal that gap
needed and never had.

## The no-policy no-op — and its one real, disclosed gap

`InventoryCostingService.receiveCost`/`consumeCost` resolve the org's
active policy first and return `null`, writing nothing, when none is
configured for that date — this is what keeps every Phase 0-10 e2e test
(none of which ever adopts a costing policy) completely unaffected by this
module's existence, the same "opt in per organization" convention as
Accounting Core's chart-adopt and the Tax Engine's localization-seed.

The gap: **a movement that predates the organization's first-ever costing
policy is never retroactively costed, even after a policy is later
adopted.** `InventoryCostRecalculationService` only rebuilds costing keys
from `InventoryCostMovement` rows that already exist — a movement the
engine skipped at the time (because no policy existed yet) never wrote one,
so there is nothing for the recalculation engine to replay. This is
distinct from, and was previously indistinguishable from, a genuinely
backdated movement landing inside an already-costed window (which DOES get
queued and rebuilt correctly).

This was flagged during this phase's own gap audit as "receipts posted
before a costing policy exists get no cost" with no way to tell that state
apart from a healthy one. It is now surfaced, not fixed outright — building
a retroactive backfill/initialization feature into an already-mature,
tested module carried more risk than this pass's scope justified. Instead,
`InventoryCostingReportingService.health()` now splits the count in two:
`uncostedMovementsBeforeAnyPolicy` (the expected, disclosed state — does
NOT fail `healthy`) vs. `uncostedMovementsWithActivePolicy` (a movement
dated on/after the earliest policy that should have been costed and, for
some other reason, was not — DOES fail `healthy`). An organization that
needs its pre-policy history costed retroactively has no automated path
today; the practical workaround is a manual `InventoryCostAdjustment` per
affected receipt.

## Disclosed gaps

- **Purchase Return-to-supplier is not wired into this module at all** —
  `PurchaseReturnPostingHandler` has no `InventoryCostingService`
  dependency, even though `FifoCostingStrategy.consume`'s
  `preferSourceLayerId` parameter exists specifically for this case (spec
  section 28: "consume the ONE layer the return traces back to, never
  blind FIFO order"). A purchase return today decreases physical stock
  with no cost-register consequence and no COGS reversal. Sales Return, by
  contrast, IS wired (`restoreCostFromOriginalConsumption`). This is the
  clearest remaining integration gap and the natural next step for this
  module.
- **The pre-policy uncosted-movement gap** above has no automated backfill.
- **AllocationDriverValue rounding**, cross-batch costing, and
  `costByCharacteristic` (a third dimension flag exists on the policy but
  no caller resolves a characteristic value) are unimplemented — same
  disclosed-but-not-built status as when the module was first written.

## Test coverage

`test/inventory-costing.e2e-spec.ts` (11 tests, all passing against real
PostgreSQL) covers: the no-policy no-op and its health-check signal, a
FIFO policy opening layers on receipt and consuming strictly oldest-first
across two differently-priced layers with exact math (verified again at
real COGS-GL-posting time via a Sales Invoice, reading back the exact
per-line cost), FIFO layer reopening on unpost, a MOVING_AVERAGE policy
receiving/consuming at the exact running average with no per-receipt
layers, Internal Consumption and Inventory Adjustment (WRITE_OFF/SURPLUS)
balanced GL posting at the real cost, a manual cost adjustment's on-hand/
COGS split by remaining-vs-consumed layer quantity with a balanced GL
entry, backdated-movement recalculation queueing and correct-order layer
rebuilding, costing-period finalize blocking a cost-affecting posting and
reopen un-blocking it, the negative-stock policy never blocking the
physical posting, and the COGS/health report endpoints.
