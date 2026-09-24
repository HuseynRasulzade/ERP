# Inventory Costing Engine (docx spec Phase 11)

Module `src/inventory-costing/`. A cost subledger on top of the Phase 10
quantity register — never a mutable "average cost" on a product.

## Model
- `InventoryCostingPolicy` — effective-dated, per organization (method
  `FIFO`/`WEIGHTED_AVERAGE`, `MOVING_AVERAGE`/`PERIODIC_WEIGHTED_AVERAGE`,
  cost-by-warehouse/batch, financial ownership types, negative-stock cost
  policy, sales-return fallback, unpost dependency policy, deferred vs
  immediate backdated recalculation). **Costing is opt-in**: without a policy
  every document behaves exactly as before.
- `InventoryCostMovement` (one per financial inventory movement, unique by
  source movement = idempotency), `InventoryCostLayer` (FIFO),
  `InventoryCostConsumption` (issue → layer, incl. negative-stock deficit
  settlement), `InventoryCostComponent` (base price, invoice difference,
  freight/customs/…, manual adjustments), `InventoryCostAdjustment(+Line)`,
  `InventoryCostCalculationRun`, `InventoryCostingPeriod`,
  `InventoryCostingError`, `InventoryCostBalanceSnapshot`,
  `InventoryCostRecalculationRequest`, `CostingAccountingBatch`.
- `InventoryMovement.sequenceNo` — deterministic ordering
  (effective date → sequence).

## Engine
`InventoryCostEngine.recalculateKey(key, from)` replays one costing key
deterministically from the earliest affected date (pulled earlier only when a
receipt settled an older negative-stock issue): opening state from persisted
layers/values strictly before the date, then every movement through the
policy's strategy (`FifoCostingStrategy`, `WeightedAverageCostingStrategy`).
Derived rows of the replayed range are rebuilt, so re-running never
duplicates; only value changes are reported. Cross-key dependents
(transfer receipts, sales returns) are queued.

GL ownership per movement type: receipts are valued by their source
documents (GR / invoice difference / additional cost / manual adjustment
book their own GL); shipments, returns, write-offs, consumption and surplus
are engine-valued — the document books its cost at posting and every later
change is booked as a delta `InventoryCostAdjustment` (one JE per date,
Debit = Credit via `AccountingPostingEngine`, accounts via mapping keys).

## Integration (inside each posting transaction)
`InventoryCostingService.onDocumentPosted/onDocumentUnposted` from the
Shipment, Sales Return, Goods Receipt, Purchase Return, Warehouse Transfer,
Inventory Adjustment and Internal Consumption handlers;
`onIncomingValueChanged` from Purchase Invoice (price difference) and
Additional Purchase Cost. Finalized costing periods reject any cost-affecting
posting dated inside them.

## API (`/organizations/:id/inventory-costing/…`)
`policies`, `valuation`, `layers`, `layers/:id`, `trace`, `cogs`, `health`,
`reconciliation`, `preview/issue-cost`, `calculations`,
`calculations/provisional|recalculate|finalize|finalize-preview`, `periods`,
`periods/:YYYY-MM/reopen`, `errors`, `errors/:id/resolve`, `adjustments`,
`adjustments/:id/post`. Permissions `inventory_cost.*` (11 codes).

## Deferred
FX conversion of purchase documents, non-recoverable tax capitalization,
characteristic dimension, specific identification / standard cost, separate
transit GL account, outbox events, frontend screens, purchase cost analysis
report. See `AUDIT_PHASES_06_11.md`.
