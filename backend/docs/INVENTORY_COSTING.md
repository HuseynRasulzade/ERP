# Inventory Costing Engine (docx spec Phase 11)

A second, separate subledger sitting on top of Phase 10's quantity register
(`InventoryMovement`). Phase 10 answers *"how many units do we have"*;
this phase answers *"what is that worth"* — the spec's own "fundamental
separation" (section 1). Backend + tests only, matching every phase 7-10
module in this codebase — no frontend UI.

## A. Architecture

- **`InventoryCostingPolicy`** (`src/inventory-costing/costing-policy.service.ts`)
  — effective-dated per organization: `costingMethod` (FIFO |
  WEIGHTED_AVERAGE), `averageMethod` (MOVING_AVERAGE |
  PERIODIC_WEIGHTED_AVERAGE), dimension flags (`costByWarehouse`,
  `costByBatch`), `negativeStockCostPolicy`, rounding precision. A method
  change is a NEW row with a later `effectiveFrom` — historical periods
  keep calculating under whatever policy was active then (spec sections
  99-100), never a silent retroactive reinterpretation.
- **No policy configured for an organization = a complete no-op.** Every
  entry point (`InventoryCostingService.receiveCost`/`consumeCost`/...)
  resolves the policy first and returns `null` immediately when none
  exists — the same "adopt once per tenant/org" convention Accounting
  Core's chart-adopt and the Tax Engine's localization-seed already use
  (`POST /organizations/:id/inventory-costing/policy`). This is what keeps
  every Phase 0-10 e2e test, none of which configures a costing policy,
  completely unaffected by this module's existence.
- **`CostingDimensionService`** resolves a `costingKey` string from the
  policy's dimension flags — NOT assumed to equal Phase 10's own
  warehouse/batch grouping (spec section 5): `costByWarehouse = false`
  pools the same product's cost across every warehouse in the
  organization even though physical stock still tracks per warehouse.
- **Strategy pattern** (`costing-strategy.interface.ts`) — `receive`/
  `consume`/`currentUnitCost`, implemented by `FifoCostingStrategy` and
  `WeightedAverageCostingStrategy`. `InventoryCostingService` is the thin
  dispatcher every posting handler calls (spec section 87: "Monolithic
  calculateEverything() service yaratma") — never a document-type branch
  inside the strategies themselves.
- **`InventoryCostMovement`** — the costing subledger's own immutable
  register, one row per costing event, usually 1:1 with an
  `InventoryMovement` (`sourceInventoryMovementId`). `quantity` and
  `totalCost` are both SIGNED, so `SUM(quantity)`/`SUM(totalCost)` over a
  costing key at any point in time IS the live quantity/value — this is
  what lets Weighted Average hold NO mutable "average cost" field
  anywhere (spec section 2's own rule) while still being fully rebuildable
  (spec section 50).
- **`InventoryCostLayer`/`InventoryCostConsumption`/`InventoryCostComponent`**
  — FIFO-only. A layer per RECEIPT; `postingSequence` (a DB autoincrement,
  never a timestamp) is the deterministic tie-breaker spec section 10
  requires when two receipts share a `receiptDate`. Every outgoing
  movement's consumption is traced per layer (`InventoryCostConsumption`)
  — "Shipment SH-100 consumed 100 from GR-001 + 50 from GR-002" is a
  direct query, not a derived guess.

## B. Costing methods

- **FIFO** — oldest layer first, ordered `(receiptDate, postingSequence)`.
  A purchase-return-to-supplier or sales-return-restore can instead target
  one EXACT layer (`preferSourceLayerId`) — spec section 28's "never a
  random layer when the source receipt is known".
- **Weighted Average** — `MOVING_AVERAGE` recomputes after every movement
  (aggregate up to and including the event's date). `PERIODIC_WEIGHTED_AVERAGE`
  costs every issue during an open month PROVISIONALLY at the
  opening-of-month rate; the true period average (opening + the month's
  own receipts) is computed once, at `CostingPeriodService.finalize`,
  which raises a delta adjustment for every provisional issue in that
  period (spec sections 14-15, 57).

## C. Integration points (per document type)

Every hook is additive to an already-shipped, already-tested handler —
same "retrofit with zero call-site changes" precedent Phase 10 itself set
retrofitting onto Phases 7/9's `InventoryLedgerService`.

| Document | Hook | Effect |
|---|---|---|
| Goods Receipt | `receiveCost` after each RECEIPT movement, at the receipt's own price | Opens a FIFO layer / feeds the average pool |
| Purchase Invoice | *(unchanged)* — price variance still resolved by the existing approval workflow, not this engine |
| Additional Purchase Cost | `applyCostDelta` per allocation | Splits the allocated amount between still-on-hand (raises the layer/pool) and already-consumed quantity (a COGS debit) — spec's "never dump it all on current stock when part is already sold" critical rule |
| Sales Shipment | `consumeCost` after each ISSUE movement | FIFO/weighted-average consumption computed at the physical stock-out event (spec section 24) — no GL posted here, preserving this platform's existing "Shipment has no accounting consequence" boundary |
| Sales Invoice | `CostingService.getShipmentLineCost`/`getUnitCost` (unchanged interface — spec's own "no interface change on the Sales side") | Reads back the Shipment's already-computed consumption for the exact line first (correct even when two same-day shipments cost differently), falls back to a coarse product+warehouse+date lookup |
| Sales Return | `restoreCostFromOriginalConsumption` after the RECEIPT movement | Restores the ORIGINAL shipment's consumed cost when traceable (via the return's linked invoice line → its shipment line), never current pool cost (spec sections 26-27) |
| Purchase Return | `consumeCost` with `preferSourceLayerId` when the return traces to a specific receipt line | Uses that exact layer's cost, not blind FIFO order |
| Warehouse Transfer | `transferCost` (consume source + receive destination) | Preserves value across warehouses; organization total unchanged |
| Internal Consumption | `consumeCost`, then a real `Dr Expense / Cr Inventory` batch when a cost was returned | Finally activates what this handler's own docstring always said was "Phase 11's job" |
| Inventory Adjustment | `consumeCost` (WRITE_OFF) / `receiveCost` at current pool cost (SURPLUS) | Same real GL activation; a manual `costReference` still wins when given, and is fed back into the engine so the subledger and GL never diverge |

## D. Backdated recalculation (spec sections 46-49)

`InventoryCostingService.flagIfBackdated` runs inside every `receiveCost`/
`consumeCost` call: if a movement dated BEFORE the latest one already on
record for that costing key arrives, it queues an
`InventoryCostRecalculationQueue` row (widening `earliestAffectedDate`
rather than duplicating). `InventoryCostRecalculationService.processPendingQueue`
(`POST .../calculations/recalculate`) then performs a FULL REBUILD of each
affected costing key — a disclosed simplification of "start at the
earliest affected date only" (the spec's own performance guidance,
section 105: correctness over performance) — replaying every
`InventoryCostMovement` from scratch in `(effectiveDate, postingSequence)`
order.

For every outgoing movement whose recomputed cost differs from what was
originally recorded, a DRAFT `InventoryCostAdjustment` (reason
`SYSTEM_RECALCULATION`) is created rather than guessing whether the
original GL consequence already posted — spec section 138's "calculation
errors-ı silent ignore etmə" extended to deltas: always surface it, a
human reviews and posts the correction.

## E. Negative stock costing (spec sections 52-54)

`allowNegativeQuantityCosting` + `negativeStockCostPolicy`
(`LAST_KNOWN_COST` | `CURRENT_AVERAGE` | `STANDARD_COST` | `ZERO_PENDING` |
`BLOCK_COSTING`) are a SEPARATE axis from Phase 10's own
`Warehouse.allowNegativeStock` — a warehouse can physically go negative
while the costing policy still refuses to cost it (`BLOCK_COSTING`),
recorded as an `InventoryCostingError` with the physical posting left
intact (spec section 96: "Silent inconsistency olmaz" — record the error,
never crash the business flow over a costing edge case). **Disclosed gap:**
once real stock later arrives, the earlier provisional negative-stock
consumption is not automatically trued up — only a genuinely backdated
event re-triggers recalculation; a same-chronological-order "stock finally
arrived" correction would need its own trigger, not built here.

## F. Period finalization (spec sections 57-60)

`InventoryCostingPeriod` is a second, narrower gate alongside
`AccountingPeriod` (Phase 0) — `CostingPeriodService.finalize` is the
callable `FinalizeInventoryCost(period)` operation the spec asks for. It
blocks while any recalculation for that period (or earlier) is still
pending, or an unresolved BLOCKING costing error exists. Once FINALIZED,
`assertPeriodOpen` blocks the WHOLE document posting (not just the costing
step) for any cost-affecting document dated inside it — an explicit,
audited `reopen` is the only way back in (spec section 111).

## G. Reporting / API (spec sections 76-82, 114)

`GET .../inventory-costing/{valuation,cogs,layers,health}`,
`POST .../calculations/recalculate`, `POST/GET .../periods/...`. Every
report is a live read over the cost register/layers — never a stored,
mutable "current value" field. `health` covers negative-remaining layers,
pending recalculations, provisional movements, unresolved errors, and a
zero-quantity-with-value consistency check (spec sections 65-66).

## H. Permissions (spec section 97)

`inventory_cost.{view, view_layers, view_cogs, view_accounting,
view_errors, manage_policy, recalculate, finalize, reopen, adjust,
manual_override}` — a warehouse operator can see physical quantity without
ever seeing cost.

## I. Disclosed simplifications / boundaries

- **No frontend UI** — same as Phases 7-10.
- **No `InventoryCostBalanceSnapshot`/`CostingAccountingPostingBatch`
  tables** — the live aggregate over `InventoryCostMovement` already
  satisfies "must be rebuildable" without a separate performance
  projection; a `JournalEntry`'s own `sourceDocumentType`/`sourceDocumentId`
  already group its accounting batch, so a redundant batching table would
  buy nothing.
- **Weighted Average has no per-receipt identity to split against** — an
  `AdditionalPurchaseCost`/manual adjustment under Weighted Average always
  capitalizes onto the pool going forward only (`onHandAmount = full
  amount`, `cogsAmount = 0`); only FIFO supports the exact retroactive
  on-hand/already-sold split spec section 19 describes. This is the same
  limitation real weighted-average systems share, not an oversight.
- **`AdditionalPurchaseCostPostingHandler.undoSideEffects` reverses a
  layer's `currentUnitCost`/`currentRemainingValue` using its CURRENT
  remaining quantity**, not the quantity at the moment the cost was
  originally applied — an accepted approximation when further consumption
  happened in between, bounded the same way this codebase already accepts
  rounding-remainder tolerances elsewhere.
- **A system-generated `SYSTEM_RECALCULATION` adjustment is dated at the
  affected movement's own `effectiveDate`, never "today"** — posting it
  "today" could land in a LATER numbering year than history already used,
  and the shared `NumberingService`'s per-year reset counter cannot safely
  rewind from that without risking a duplicate document number for an
  earlier year. A manual adjustment created through the API is dated by
  the caller and has no such constraint.
- **Purchase Return / Sales Return GL amounts are independent of this
  engine** — `PurchaseReturnPostingHandler`/`SalesReturnPostingHandler`
  already compute their own GL entry from the return document's declared
  price (Phase 9/7's own, already-tested behavior); this phase only makes
  sure the COST SUBLEDGER (which exact FIFO layer, what original cost is
  restored) is correct alongside it.
- **Idempotency under duplicate event delivery is not separately tested**
  — this codebase is synchronous request/response with no event bus or
  retry-delivery mechanism, so the spec's "same `InventoryMovementPosted`
  event delivered twice" scenario has no live trigger to test against at
  the API level.

## J. Test coverage

`backend/test/inventory-costing.e2e-spec.ts` — FIFO basic (two receipts,
one shipment spanning both layers, COGS posted at Sales Invoice time) and
partial consumption, Weighted Average (moving), Additional Purchase Cost
after a partial sale (on-hand/COGS split), Sales Return restoring the
original sale's cost even after a much cheaper receipt arrives, Purchase
Return consuming the exact source layer, Warehouse Transfer preserving
cost across warehouses, a backdated cheaper receipt changing which layer
a shipment consumed (recalculation generates and posts a
`SYSTEM_RECALCULATION` adjustment, idempotent on immediate re-run),
negative-stock costing at `LAST_KNOWN_COST`, costing period finalization
(blocked while a recalculation is pending, blocks further posting once
finalized, released by reopen), health reporting, and tenant isolation of
the costing policy. All run against a real PostgreSQL instance, alongside
the full existing phase 0-10 suite with zero regressions.
