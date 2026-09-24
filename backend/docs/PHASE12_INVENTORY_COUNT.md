# Phase 12 — Inventory Count / İnventarizasiya / Stocktaking

An **inventory reconciliation engine** built on top of the Phase 10 movement
register (`backend/src/inventory-count/`). A count is a governed process, not
a "type the actual quantity" form:

```
Plan (policies + scope) → start Session → immutable Snapshot → (Freeze) →
Sheets / Tasks → Entries (blind, barcode, import, unit conversion) →
complete-count → Variance engine → Recounts → Investigation / decisions →
Approval (approvals foundation) → Adjustment documents → Post (Phase 10
movements + cost + Phase 4 GL) → Reconciliation → Close
```

## Data model (migration `20261012000000_phase12_inventory_count`)

| Table | Purpose |
|---|---|
| `inventory_count_plans` | header, count type, all policies (freeze, cutoff, blind, recount, tolerance, costing, stale, approval tiers, year-end flags) |
| `inventory_count_scopes` | INCLUDE/EXCLUDE rules per dimension (warehouse, branch, location, location subtree, product, product category, batch, serial, ownership, quality/inventory status); revisioned |
| `inventory_count_teams` | team lead / counters / observers / finance / warehouse reps |
| `inventory_count_sessions` | execution attempt of a plan, full status machine (spec §7) |
| `inventory_count_snapshots` | immutable, versioned authoritative snapshot lines (+ unit cost / stock value) |
| `inventory_count_freeze_locks` | active HARD/SOFT freeze slices |
| `inventory_count_sheets` / `_tasks` | counting work units |
| `inventory_count_entries` / `_entry_versions` | physical counts, never deleted; every change versioned |
| `inventory_variances` / `inventory_variance_matches` / `inventory_variance_decisions` | per-dimension variances, cross-dimension offsets, append-only decisions |
| `inventory_recounts` | recount history (never overwrites the original count) |
| `inventory_count_adjustments` / `_lines` | new document type `INVENTORY_COUNT_ADJUSTMENT` |
| `inventory_count_reconciliations` | quantity / value / GL reconciliation summary |
| `inventory_count_reason_codes`, `inventory_count_attachments`, `inventory_count_events` | reason catalog, attachment metadata, transactional event outbox |

External master data (tenant, org, warehouse, location, product, batch, serial,
user) is referenced by plain indexed id columns — no back-relations were added
to models other phases edit in parallel.

## Key design decisions

- **Snapshot source of truth** — one set-based `GROUP BY` over
  `InventoryMovement` (`InventorySnapshotService.getInventoryBalance`), never a
  cached figure. **Cutoff time axis = the movement's recorded timestamp
  (`createdAt`)**: `effectiveDate` is a date without time, so it cannot order an
  intraday snapshot against an intraday receipt. Back-dated documents posted
  after the snapshot are therefore post-snapshot movements.
- **Adjusted accounting quantity** = live balance recorded up to `snapshot_at`
  + in-scope movements recorded after it and up to the key's cutoff
  (`GLOBAL_SNAPSHOT_CUTOFF` = count completion, `TASK_COMPLETION_CUTOFF`,
  `LOCATION_COUNT_TIMESTAMP`), excluding the count's own adjustments. The
  original snapshot quantity is kept separately.
- **Variance key** = warehouse × location × product × characteristic × batch ×
  serial × ownership × quality status. Never netted per product; offsets
  (location / status / batch / ownership / serial swap) are stored as matches
  so the mismatch stays visible *and* the right document type is chosen.
- **Adjustment type selection** — matched offsets become
  `LOCATION_CORRECTION` / `STATUS_CORRECTION` / `BATCH_CORRECTION` /
  `SERIAL_CORRECTION` (value neutral, no GL); only the real residual becomes
  `INVENTORY_SURPLUS` (IN) / `INVENTORY_SHORTAGE` (OUT).
- **Freeze** — an `InventoryMovementGuard` hook was added to Phase 10's single
  writer `InventoryMovementService` (additive: `registerGuard`, called in
  `recordMovement` and `deleteMovementsFor`). HARD blocks every in-scope write
  (receipts, shipments, transfers, write-offs, consumption, status transfers,
  adjustments and unposts) with *"Warehouse X is locked for inventory count
  session IC-…"*; SOFT allows and audits `INVENTORY_COUNT_FREEZE_OVERRIDDEN`;
  NO_FREEZE relies on movement-aware reconciliation.
- **Costing** — no Phase 11 engine exists in this codebase yet.
  `InventoryCountCostingService` first asks the platform costing seam
  (`CostingService.getUnitCost`, currently always `null`), then derives a
  *reference* cost from receipt cost layers (posted Goods Receipt lines ×
  exchange rate + inbound movements carrying `provisionalCost`): weighted
  average, latest purchase, or FIFO over the layers still on hand. Surplus may
  also use MANUAL_APPROVED (permissioned, audited) or ZERO_PENDING_VALUATION.
  Shortage never uses a manual price. STRICT costing blocks posting when a cost
  is unresolved (no silent zero-cost entries). The line unit cost is written to
  the movement's `provisionalCost` (value handoff for Phase 11).
- **Accounting** — semantic mappings only: `INVENTORY_SURPLUS_INCOME` →
  fallback `OTHER_OPERATING_INCOME`; `INVENTORY_SHORTAGE_EXPENSE` → fallback
  `OTHER_OPERATING_EXPENSE`; `INVENTORY_SHORTAGE_RECOVERABLE` for a responsible
  person's recoverable part; `GOODS_INVENTORY` for the stock side. Posted
  through the generic document framework (period lock, audit, JE in the same
  transaction).
- **Approval** reuses the approvals foundation (`ApprovalPlanProvider` for
  `INVENTORY_COUNT_SESSION`, visible in the pending-approvals inbox). Default
  tiers: total |value| < 100 → WAREHOUSE_SUPERVISOR, < 5,000 → FINANCE, else
  DIRECTOR; `criticalShortageValue` adds FINANCE. SoD: submitter ≠ approver,
  counters cannot approve, a warehouse's responsible keeper cannot approve it.
- **Idempotency** — entries/import/scan via `clientEntryId`; adjustment
  documents via unique `postingKey`; posting via the framework's
  already-posted check (`post-adjustments` is resumable and a no-op when done).
- **Stale protection** — pre-post refresh blocks on pending recounts, on any
  in-scope movement recorded after approval (`stalePolicy=BLOCK`), and always
  when a recomputation changes any approved adjusted/physical quantity.
- **Blind count** — accounting quantities are never serialized while a blind
  count is counting (not even to holders of `VIEW_ACCOUNTING_QTY`);
  full-blind hides the expected list; blind recount hides the original count.
  Costs require `INVENTORY_COUNT_VIEW_COST`.
- **Serial count** — once a serial product is counted in a warehouse, the
  recorded serial list is the count: unrecorded expected serials are
  `SERIAL_MISSING`, found unknown serials `SERIAL_UNEXPECTED` (master row is
  created only when the approved adjustment is generated).
- **Errors** use module-local codes (`INVENTORY_COUNT_*`, see
  `inventory-count.errors.ts`) with the exact spec §114 messages.

## API (`/organizations/:orgId/inventory-counts`)

`GET /`, `POST /`, `GET|PUT /:id`, `GET /:id/scope/preview`, `POST /:id/start`,
`POST|GET /:id/snapshot`, `POST /:id/freeze|unfreeze`, `GET /:id/movements`,
`POST /:id/sheets/generate`, `GET /:id/sheets[/:sheetId[/print]]`,
`POST /:id/sheets/:sheetId/tasks|complete`, `POST /:id/tasks/:taskId/complete`,
`POST /:id/entries`, `POST /:id/entries/scan|import`, `GET /:id/entries`,
`PATCH /:id/entries/:entryId`, `POST /:id/entries/:entryId/void|review`,
`POST /:id/complete-count`, `POST /:id/calculate-variances`,
`GET|PATCH /:id/variances[/:varianceId]`, `POST|GET /:id/recounts`,
`POST /:id/recounts/:recountId/complete`, `POST /:id/submit|approve|reject`,
`GET /:id/approval-steps`, `POST /:id/create-adjustments|post-adjustments`,
`GET /:id/adjustments`, `POST /:id/reconcile`, `GET /:id/reconciliation`,
`POST /:id/close|cancel|reopen`, `GET /:id/progress|audit|events`,
`GET /:id/reports/serials|batches|locations`, `POST|GET /:id/attachments`.

Cross-count: `/organizations/:orgId/inventory-count-reports/dashboard|variances|surplus-shortage|count-history/:productId|close-readiness|health`,
reason catalog `/inventory-count-reason-codes`.

Integration for later phases: `InventoryCountReportingService.hasOpenInventoryCounts(tenant, org, from, to)`
(Phase 22; year-end / `mandatoryCloseDependency` counts block close) and
`health()` (Phase 30: open counts, approved-but-unposted, unreconciled,
high shortages, repeated serial variance). Events are in the
`inventory_count_events` outbox.

## Permissions

15 codes `inventory_count.*` (spec §75) in `src/rbac/permission-codes.ts`;
seed roles WAREHOUSE_USER / WAREHOUSE_SUPERVISOR / FINANCE_USER received the
relevant ones.

## Tests

`test/phase12-inventory-count.e2e-spec.ts` — 23 scenarios: basic, shortage
(+GL, idempotency, SoD), surplus, blind count, warehouse access, post-snapshot
movements, location / batch / serial mismatch, recount, hard & soft freeze +
scope isolation + lock conflict, uncounted vs explicit zero, costing failure,
stale concurrent movement, period lock, unit conversion + barcode + idempotent
entries, CSV import, scope immutability + reopen, tenant isolation + cost
confidentiality, month-close integration, and the spec §138 end-to-end
scenario (1,000 → +100 −50 → 1,042 counted → independent recount → 1,043,
reconciled and closed).

## Deferred / simplifications

- **Frontend pages** (count plan, session, counter entry, variance review,
  recount, reconciliation summary) — not built in this increment; the API
  is complete.
- **Characteristics**: the platform has no characteristic dimension on the
  movement register; `characteristicId` is carried on every Phase 12 row and
  in the variance key, ready for when it exists.
- **Real Phase 11 cost layers** — reference costing described above until
  the costing engine lands; layer *consumption* on shortage is recorded only as
  the movement's `provisionalCost`.
- **Packaging barcodes** (a barcode that implies a pack quantity) — there is no
  packaging master; scan resolves product/SKU/serial/batch; pack counting uses
  unit conversions.
- **Multi-document atomicity** — each adjustment document posts atomically;
  the session-level post pre-validates everything and is resumable/idempotent
  rather than one giant transaction (the framework opens one transaction per
  document).
- **Employee receivable workflow** — only the reference
  (`responsibleEmployeeId`, `recoverableAmount`, `recoveryStatus`) and the GL
  split are stored.
- **Attachment binaries** — metadata + storage key only.
- **Event dispatcher** — outbox rows are written; publishing (`publishedAt`) is
  left to a future dispatcher.
- Pre-existing schema drift on `settings.valid_from` default (not from this
  phase) was left untouched.
