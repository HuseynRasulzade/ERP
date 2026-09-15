# Inventory Costing / Maya Dəyəri Engine (docx spec Phase 11)

Introduces a **cost subledger** that sits alongside Phase 10's own
quantity register without ever touching it. Phase 10's `InventoryMovement`
answers "how many units do we have"; this phase answers "what is the
financial value of those units" — the two are architecturally separate
tables, separate services, and separate modules on purpose (spec section
1's own "fundamental separation" rule).

## A. Architecture

```
GoodsReceipt (Phase 9)                    Shipment / SalesReturn (Phase 7)
PurchaseReturn (Phase 9)                  PurchaseReturn issue leg
WarehouseTransfer (Phase 10)              WarehouseTransfer both legs
   │ InventoryLedgerService.recordMovement    │ same
   ▼ (Phase 10, unchanged)                    ▼
InventoryMovement (signed qty, quantity truth)
   │                                          │
   │ InventoryCostingService                  │ InventoryCostingService
   │  .processIncomingMovement                │  .calculateOutgoingCost
   ▼                                          ▼
InventoryCostLayer (FIFO) / WAC bucket ──consume──► InventoryCostConsumption
   │                                                       │
   ▼                                                       ▼
InventoryCostMovement (register: one row per priced Phase 10 movement)
   │
   ▼
InventoryValuationService / CostingReportingService / CostingReconciliationService
```

`InventoryCostingPolicyService.resolve(tenantId, organizationId, date)`
picks the effective-dated `InventoryCostingPolicy` row for that date —
never "the current setting" — so a historical recalculation always
re-applies the method that was actually in force then (spec sections
99-100). `CostingDimensionService.resolveKey` turns that policy plus a
movement's own product/warehouse/batch into the single `costingKey`
string every costing table partitions on; it can differ from Phase 10's
own physical dimensions (e.g. one average cost across two warehouses,
spec section 5's Baku/Ganja example).

## B. Strategy pattern (spec section 88)

`FIFOEngine` and `WeightedAverageEngine` both expose
`createLayer/receive`, `consume`, `reverseConsumption`,
`reverseLayer/reverseReceipt`, and `adjustLayerCost/applyAdditionalCost` —
`InventoryCostingService` picks between them per the resolved policy and
never branches on costing method anywhere else. Both share the same
`InventoryCostLayer` table: FIFO opens one row per receipt; weighted
average keeps exactly one continuously-updated row per costing key
(`sourceDocumentType = 'WAC_BUCKET'`), so valuation/reporting code reads
one shape regardless of method.

## C. FIFO layers and traceability

Every receipt becomes an `InventoryCostLayer` (immutable
`originalQuantity`/`originalUnitCost`; only `remainingQuantity`/
`currentUnitCost`/`currentRemainingValue` change). Every shipment/issue
records one `InventoryCostConsumption` row per layer it drew from,
ordered by `receiptDate` then the layer's own auto-increment
`postingSequence` tie-breaker (spec section 10) — never insertion order
alone. `InventoryCostComponent` rows record what built up a layer's cost
(purchase price, then each capitalized additional cost, then any manual
adjustment) for the drill-down UI spec section 75 describes.

## D. Additional cost capitalization (spec sections 19-20, 45, 72, 141)

`AdditionalCostCapitalizationService.applyAllocations` reads the
`PurchaseCostAllocation` rows `AdditionalPurchaseCostPostingHandler`
already writes (Phase 9) and folds each allocated amount into the target
receipt line's FIFO layer via `FIFOEngine.adjustLayerCost`, which splits
the amount **proportionally** between `remainingQuantity` (stays
capitalized to on-hand inventory) and the already-consumed portion
(reclassified to COGS) — never dumping a late cost entirely onto current
stock when part of the receipt already shipped. The posting handler's
existing `Dr Inventory (total) / Cr Payable` batch is extended with extra
`Dr COGS / Cr Inventory` lines for the consumed share only; the total
still balances.

For `WEIGHTED_AVERAGE`, the same amount is applied **prospectively**
only (`WeightedAverageEngine.applyAdditionalCost`) — a pooled average has
no per-receipt identity left to split retroactively; a full period
revaluation at `CostingPeriodService.finalize` is what corrects this in
practice (see section G).

## E. COGS at Shipment posting (spec sections 24-25)

`ShipmentPostingHandler` calls `calculateOutgoingCost` right after its
own Phase 10 ISSUE movement — the "Immediate provisional COGS" model
(section 25): cost is realized at physical issue, not deferred to
invoicing. `sales-execution/costing.service.ts` (`CostingService`, the
interface `SalesInvoicePostingHandler` already depended on) now reads
that realized cost back via `InventoryCostingService.getRealizedUnitCost`
using the invoice line's `sourceShipmentLineId` — it never recomputes a
cost at invoice time, so an invoice posted long after its shipment still
gets that shipment's own historical cost.

## F. Returns

- **Sales return** (spec section 26): `InventoryCostingService.receiveReturnMovement`
  looks up the original shipment line's `InventoryCostMovement` and
  reopens a layer at THAT realized unit cost — never today's average.
  With no traceable source (section 27), it falls back to the negative-
  stock policy's cost and logs a `BROKEN_SOURCE_LINK` costing error for
  manual review.
- **Purchase return** (spec section 28): when linked to a specific
  original receipt line, `calculateOutgoingCostFromSpecificReceipt`
  bypasses FIFO's normal oldest-first order and consumes SPECIFICALLY
  that receipt's layer (`FIFOEngine.consumeSpecificLayer`) — the spec's
  own "return from Receipt B, not the older Receipt A" example.

## G. Warehouse transfer cost preservation (spec sections 30-32)

`InventoryCostingService.transferCost` consumes the source costing key at
its current cost and opens a new layer/folds into the WAC bucket at the
destination using that SAME unit cost — organization-wide value never
moves, only which costing key holds it. A no-op when the policy doesn't
cost by warehouse (both warehouses already share one costing key).
Disclosed simplification: IN_TRANSIT vs AVAILABLE is a Phase 10
quantity-status concept only here — cost moves immediately rather than
sitting in a separate transit cost pool for `TWO_STEP` transfers.

## H. Backdated recalculation (spec sections 46-49, 92, 109, 127, 131)

`InventoryCostRecalculationService.flagIfBackdated` runs after every
incoming layer: if any ISSUE was already priced with an effective date
AFTER this receipt's own date, that shipment's FIFO order assumption is
stale, and an `InventoryCostRecalculationQueueEntry` is enqueued.
`processQueue` runs a full replay for the affected costing key inside one
`InventoryCostCalculationRun` — resets FIFO layers to pristine (or the
WAC bucket to zero) and replays every `InventoryCostMovement` for that
key in chronological order, comparing old vs new cost per movement and
producing an `InventoryCostAdjustment` DRAFT document (never auto-posted,
spec section 116) summarizing only the deltas. Re-running with no
intervening source change produces zero deltas (spec test 131) — nothing
here depends on run count.

Disclosed simplification vs spec section 108: no period-opening-state
snapshot — a run always replays the full history for one costing key
(bounded scope, not the whole tenant), not just from the affected date
forward. Correct, not yet optimized for very long-lived keys.

## I. Negative stock costing (spec sections 52-54)

When FIFO/WAC can't fully cover a shipment's quantity and
`allowNegativeQuantityCosting` is on, the shortfall is priced under
`negativeStockCostPolicy` (`LAST_KNOWN_COST`/`CURRENT_AVERAGE`/
`STANDARD_COST` all resolve to "the last movement's own unit cost" in
this build — a real standard-cost table is out of Phase 11's scope;
`ZERO_PENDING` prices it at zero; `BLOCK_COSTING` raises a BLOCKING
`InventoryCostingError` instead of guessing). Always logged, never
silent (spec section 138).

## J. Period finalization (spec sections 57-60, 111, 116-118, 133-134)

`CostingPeriodService.preview` runs every check `finalize` would
(pending recalculation, blocking/error health findings, quantity-vs-
layer reconciliation) without mutating anything. `finalize` processes any
pending recalculation, re-checks, then marks `InventoryCostingPeriod`
FINALIZED. `assertPeriodOpenForCosting` is checked on every
`processIncomingMovement`/`calculateOutgoingCost` call — posting a
cost-affecting document into an already-finalized period fails loudly
until `reopen` is called explicitly (never silently reinterpreted).

## K. Reporting and health (spec sections 63-66, 76-82, 132)

- `InventoryValuationService` — current valuation (from open layers) and
  historical "as of date" valuation (replays `InventoryCostMovement`
  balances up to a date — never today's cost times a historical quantity).
- `CostingReportingService` — COGS report, FIFO layer report, cost
  adjustment report.
- `CostingReconciliationService` — quantity-vs-layer reconciliation per
  costing key, and a health report (unresolved errors, pending
  recalculation, uncosted/provisional movements, zero-quantity-with-value
  and nonzero-quantity-zero-value anomalies).

## L. Disclosed simplifications / Phase 11 boundaries (spec section 137)

- **Purchase Invoice price difference** (spec section 18) — a receipt
  line's own price is this build's initial cost source (section 17); a
  Purchase Invoice posted afterward at a DIFFERENT price does not yet
  correct the FIFO layer/WAC bucket. Only `AdditionalPurchaseCost` is
  wired as a real, retroactive layer-adjusting cost input right now (see
  section D). Purchase Execution's own GRNI-clearing GL entries already
  have a pre-existing, separately-disclosed simplification here (the GRNI
  debit uses the invoice's own price, not the receipt's — see
  `docs/PURCHASE_EXECUTION.md`); this build does not compound that by also
  silently drifting the cost subledger away from it. Treat a material
  invoice/receipt price difference as a case for a manual
  `InventoryCostAdjustment` (reason `SUPPLIER_PRICE_CORRECTION`) until a
  future pass wires this path directly.
- **InternalConsumption / InventoryAdjustment (write-off, surplus)** are
  now wired into `InventoryCostingService` (real FIFO/weighted-average
  cost, not a manual `costReference` requirement) — see those handlers'
  own docstrings.
- **`AdditionalPurchaseCostPostingHandler.undoSideEffects`** does not
  reverse the FIFO layer cost bump `applyAllocations` made on post — see
  that method's own docstring. A manual `InventoryCostAdjustment` is the
  recommended correction path instead of relying on unpost/repost.
- No `InventoryCostBalanceSnapshot`/period-opening-state acceleration, no
  `SPECIFIC_IDENTIFICATION`/`STANDARD_COST`/`MOVING_AVERAGE`-as-a-third-
  method, no consignment ownership-transfer costing event, no free-goods
  special allocation, no `InventoryOpeningCostBalance` migration path, no
  `CostingAccountingPostingBatch` wrapper (the existing
  `AccountingPostingEngine` batch + `JournalEntry` already gives a
  traceable Dr=Cr record) — all named in spec section 137 as
  interface/data-readiness obligations rather than full builds here.

## M. Permissions (spec section 97)

`INVENTORY_COST_VIEW`, `_VIEW_LAYERS`, `_RECALCULATE`, `_FINALIZE`,
`_REOPEN`, `_ADJUST`, `_MANUAL_OVERRIDE`, `_VIEW_ERRORS`, `_VIEW_COGS`,
`_VIEW_ACCOUNTING`, `_POLICY_MANAGE` — see `rbac/permission-codes.ts`.
Cost data is sensitive: a warehouse operator can see physical quantity
(Phase 10's `INVENTORY_VIEW`) without necessarily holding any
`INVENTORY_COST_*` permission.

## N. Tests

`test/phase11.e2e-spec.ts` exercises the engine directly (no document of
its own to post through HTTP except `InventoryCostAdjustment` — everything
else triggers from inside another document's posting transaction),
against a real Postgres instance, covering the spec's own worked
examples: FIFO basic/partial consumption, weighted average, additional
cost capitalization split, rounding exactness, warehouse transfer value
preservation, backdated recalculation + idempotent re-run, quantity/layer
reconciliation drift detection, and COGS/layer reporting.
