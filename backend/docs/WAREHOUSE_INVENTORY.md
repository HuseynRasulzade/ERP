# Warehouse / Stock Engine (docx spec Phase 10)

Introduces the **Stock Truth Engine**: physical stock is never a mutable
field on `Product`/`Warehouse` — it is always computed *live* from an
immutable movement register, `InventoryMovement`. Every module in this
platform that needs to know "how much stock is there" (Sales Execution's
shipments, Purchase Execution's receipts/returns, and this phase's own
four new document types) reads through one shared query surface,
`StockAvailabilityService`, and writes through one shared writer,
`InventoryMovementService`. Nothing else in the codebase is allowed to
touch the `InventoryMovement` table directly.

Phase 10 deliberately keeps the **quantity register** (this phase) and
the **cost register** (Phase 11, Inventory Costing) permanently separate
concerns — `InventoryMovement.provisionalCost`/`costingStatus` are
reserved columns for Phase 11 to fill in, never authoritative here.

## A. Architecture

```
GoodsReceipt/Shipment/SalesReturn/PurchaseReturn (Phase 7/9)
   │  InventoryLedgerService (unchanged call surface)
   ▼
InventoryMovementService.recordMovement ──► InventoryMovement (signed qty)
   ▲
   │  same writer
WarehouseTransfer / InternalConsumption /
InventoryAdjustment / InventoryStatusTransfer (this phase)

StockAvailabilityService  ◄── every module's read path
   physical  = Σ movements where stockStatus ∈ physical statuses
   reserved  = Σ active StockReservation.quantity
   available = physical(AVAILABLE) − reserved
   blocked   = physical(BLOCKED)
   inTransit = physical(IN_TRANSIT)
   expected  = confirmed Supplier Order qty − received − cancelled
   projected = available + expected + inTransit
```

`InventoryMovement.quantity` is **signed** (+ = IN, − = OUT) — chosen
over a direction+unsigned-quantity pair per the spec's own "pick one
convention, don't mix" allowance. Every write acquires a Postgres
advisory transaction lock
(`pg_advisory_xact_lock(hashtext(tenant:warehouse:product:batch))`) via
`InventoryMovementService.lockStockKey` before re-checking availability,
so two concurrent posts against the same stock key can never both pass
the check before either commits (spec section 71's sanctioned
concurrency mechanism).

`stockStatus` (`AVAILABLE | QUARANTINE | QUALITY_CONTROL | REJECTED |
DAMAGED | BLOCKED | IN_TRANSIT | EXPIRED`) folds the spec's separate
"quality status" and "inventory status" axes into one column —
`InventoryStatusTransfer` re-tags it. `IN_TRANSIT` is how a two-step
`WarehouseTransfer` models goods that have left the source but not yet
arrived: it is a status at the **destination warehouse**, not a separate
pseudo-warehouse entity.

## B. Retrofit onto Phase 7/9 (zero regressions)

`InventoryLedgerService` (Sales Execution's own call surface, used by
`ShipmentPostingHandler`/`SalesReturnPostingHandler`/
`GoodsReceiptPostingHandler`/`PurchaseReturnPostingHandler`) kept its
public method signatures byte-for-byte identical
(`recordMovement`/`availableQuantity`) while its internals were swapped
to delegate to `InventoryMovementService`/`StockAvailabilityService`.
Only each handler's `undoSideEffects` — which bypassed the service and
queried the old generic `RegisterMovement` table directly — needed a
one-line change to the new `deleteMovementsFor`. The full pre-existing
173-test e2e suite passes unchanged after the retrofit; see the
Phase 10 commit history for the verification run.

## C. This phase's own document types

The spec implies roughly six-seven distinct document types; four cover
the same ground via a discriminator field (disclosed simplification, D):

| Document | Purpose | Discriminator |
|---|---|---|
| `WarehouseTransfer` | warehouse-to-warehouse AND location-to-location moves | `transferType`: `INSTANT` \| `TWO_STEP` \| `INTERNAL_LOCATION_TRANSFER` |
| `InternalConsumption` | non-sale stock use (office/marketing/maintenance/project) | `operationType` |
| `InventoryAdjustment` | write-off, surplus, and opening balance | `adjustmentType`: `WRITE_OFF` \| `SURPLUS` \| `OPENING_BALANCE` |
| `InventoryStatusTransfer` | re-tag stock's quality/inventory status in place | `fromStatus`/`toStatus` on each line |

All four are full `document-framework` participants (repository +
posting handler, registered with `DocumentFrameworkRegistry`) using the
same generic `/documents/<TYPE>/:id/post|unpost|cancel` commands as
every other document type in this codebase.

### WarehouseTransfer

- `INSTANT`: posting writes a `TRANSFER_OUT` (source, AVAILABLE) and a
  `TRANSFER_IN` (destination, AVAILABLE) movement pair in the same
  transaction — stock never exists nowhere.
- `TWO_STEP`: posting IS shipping — `postingStatus = POSTED` reuses the
  same "confirmed" convention Phase 6/8 already established, while a
  separate `transferStatus` (`DRAFT → SHIPPED → PARTIALLY_RECEIVED →
  RECEIVED`) tracks the finer progression. Shipping writes `TRANSFER_OUT`
  at the source and `TRANSFER_IN` with `stockStatus = IN_TRANSIT` at the
  destination. A bespoke `POST .../warehouse-transfers/:id/receive`
  command (not the generic `unpost`) later moves some or all of that
  in-transit quantity to `AVAILABLE`, server-re-validated against the
  remaining shipped-not-yet-received quantity per line. Unposting a
  transfer that has already had any receive applied is blocked
  (`TransferUnpostBlockedError`) — the destination has already consumed
  part of what unposting would try to delete.
- `INTERNAL_LOCATION_TRANSFER`: source warehouse = destination warehouse;
  the movement pair differs only by `locationId`.

### InternalConsumption / InventoryAdjustment

Both always post a real, immediate `InventoryMovement` (OUT for
consumption/write-off, IN for surplus/opening balance). Their financial
consequence (`Dr Expense / Cr Inventory` for consumption, `Dr/Cr Inventory`
against an other-operating account for write-off/surplus) is now priced
by the real Phase 11 `InventoryCostingService` — actual FIFO/weighted-
average cost for consumption/write-off (an OUT), the configured
surplus/negative-stock fallback ladder for surplus (an IN); see
`docs/INVENTORY_COSTING.md`. `costReference` on a line, when set, still
overrides the GL posting amount as an explicit manual value (the Phase 11
subledger itself is always kept in sync regardless). `OPENING_BALANCE`
never posts accounting at all — it only establishes this register's own
starting point and is unrelated to Accounting Core's own separate
opening-balance concept from Phase 4. The quantity movement — the only
thing THIS phase can vouch for — always posts regardless of costing
outcome.

### InventoryStatusTransfer

Writes a `STATUS_CHANGE_OUT`/`STATUS_CHANGE_IN` pair at the same
warehouse/location; quantity never changes, only `stockStatus`. Never an
accounting consequence.

## D. Disclosed simplifications

- **Single `stockStatus` column** folds the spec's separate quality-
  status and inventory-status axes into one dimension. A tenant that
  genuinely needs both to vary independently (e.g. "quarantined AND
  reserved for a specific order") is not representable — documented here
  rather than silently handled.
- **In-transit-as-destination-status** instead of a dedicated transit
  pseudo-warehouse: simpler to query (`StockAvailabilityService` needs no
  special-case warehouse type) at the cost of not being able to report
  "goods in transit between A and B" as a location of their own outside
  of the owning `WarehouseTransfer` row.
- **Four document types instead of ~six-seven** — see table above. Each
  fold is behaviorally complete (nothing the spec describes is
  unreachable), just reached via a discriminator field instead of a
  dedicated table.
- **Boolean `Warehouse.allowNegativeStock`** (pre-existing since
  Phase 1/2, already used this way by Phase 7's `ShipmentPostingHandler`)
  is the sole negative-stock policy authority, not the spec's three-state
  `NEVER | WITH_PERMISSION | ALLOWED` enum. `Product.allowNegativeStock`
  (also pre-existing) is reserved but unused.
- **Batch/serial capture is wired** into `GoodsReceiptService`/
  `ShipmentService`/`SalesReturnService`/`PurchaseReturnService` via one
  shared `BatchSerialService` (see section H below) rather than four
  copies of the same logic.
- **No snapshot/partitioning optimization** on `InventoryMovement` — every
  read is a live aggregate over the full table, same tradeoff every other
  register in this codebase already makes.
- **No WarehouseReceipt/WarehouseIssue physical-vs-commercial-acceptance
  split** — `GoodsReceipt`/`Shipment` (Phase 7/9) already play that role.
- **No barcode scanning UI**, **no domain-events/outbox** — out of scope
  for a backend-only phase.
- **Unpost deletes rows** (same convention as `RegisterMovement`
  everywhere else in this codebase) rather than writing a reversal row —
  the spec's stated alternative (section 39). Consistency with the rest
  of the platform's posting engine won over that option.

## E. Reporting (spec sections 58-63, 86)

All read through `StockAvailabilityService`/`WarehouseInventoryReportingService`
under `GET /organizations/:id/inventory-reports/*` and
`GET /organizations/:id/warehouses/:whId/products/:pId/stock`:

- **Stock snapshot** — physical/reserved/available/expected/inTransit/blocked/projected for one warehouse+product.
- **Stock Balance** — the same, rolled up across every warehouse+product with a nonzero physical balance.
- **Stock Card** — the full ordered `InventoryMovement` history (drill-down) for one warehouse+product(+batch).
- **Batch report** / **Serial report** (+ full per-serial history).
- **Negative Stock report** — every warehouse/product whose live available balance has gone negative.
- **Min/Max report** — products at/below `reorderPoint`/`minimumStock`.

## F. Permissions (spec section 65)

18 new `inventory.*` codes (`INVENTORY_VIEW`, `INVENTORY_VIEW_ALL_WAREHOUSES`,
`INVENTORY_TRANSFER_CREATE/POST/RECEIVE`, `INVENTORY_INTERNAL_MOVE`,
`INVENTORY_CONSUME`, `INVENTORY_WRITE_OFF(_APPROVE)`,
`INVENTORY_STATUS_CHANGE`, `INVENTORY_RESERVE`/`_RELEASE_RESERVATION`,
`INVENTORY_OVERRIDE_NEGATIVE`, `INVENTORY_VIEW_SERIAL_HISTORY`,
`INVENTORY_VIEW_MOVEMENTS`, `INVENTORY_UNPOST`, `INVENTORY_PERIOD_OVERRIDE`,
`INVENTORY_MANUAL_ADJUSTMENT`) — see `src/rbac/permission-codes.ts`. Like
every other document type in this codebase, posting/unposting/cancelling
itself goes through the generic `documents.post`/`documents.unpost`/
`documents.cancel` permissions on `DocumentCommandsController`, not the
per-domain `INVENTORY_TRANSFER_POST`/`INVENTORY_UNPOST` codes — those are
declared for RBAC configurability (spec section 65's own list) but not
yet wired to a distinct enforcement point, matching how e.g.
`PURCHASE_RETURN` already coexists with the generic posting permissions.

## G. Batch/serial capture (spec sections 19-23)

`BatchSerialService` (`src/warehouse-inventory/batch-serial.service.ts`)
is the one implementation shared by `GoodsReceiptService`/
`ShipmentService`/`SalesReturnService`/`PurchaseReturnService` and their
posting handlers — no per-document duplication.

- **Batches are metadata, resolved at document CREATE time** (find-or-
  create by `(organizationId, productId, batchNumber)`) — creating one
  touches no stock, so it is safe before posting. A line's `batchId`
  then flows straight into `InventoryMovement.batchId` when the line
  eventually posts.
- **Serial numbers are captured as raw strings at CREATE time**, via the
  new `DocumentLineSerial` table (one reusable capture table for all four
  document types, keyed by `(documentType, lineId)` — same soft-reference
  convention as `ShipmentLine.sourceOrderLineId`), and only resolved into
  real `SerialNumber` rows at **POSTING** time:
  - `receiveSerials` (Goods Receipt, physical return): creates (or
    reactivates) one `SerialNumber` row per captured string, `AVAILABLE`
    at the receiving warehouse; a serial already active elsewhere is
    rejected (`SerialDuplicateError`).
  - `issueSerials` (Shipment, Purchase Return): every captured serial
    must already exist, be `AVAILABLE`, and sit in the issuing warehouse
    — never trusts the draft's own capture (`SerialNotAvailableError`/
    `SerialWrongLocationError`).
  - `returnSerials` (Sales Return): symmetric to receive, at the return's
    warehouse.
- **One `InventoryMovement` row per serial unit** (qty = 1 each) — the
  posting handlers loop over resolved serial ids instead of writing one
  aggregated line-quantity movement, satisfying "full history per serial"
  via a plain ordered query on `InventoryMovement.serialId` (exposed as
  `GET .../inventory-reports/serials/:serialId/history`).
- **Unpost is asymmetric by design**: a receipt's unpost deletes the
  `SerialNumber` rows it created (`undoReceivedSerials` — same delete-on-
  unpost convention `InventoryMovement` itself uses, safe because nothing
  else could yet reference a brand-new serial); an issue's unpost
  restores the serial to `AVAILABLE` at the issuing warehouse
  (`undoIssuedSerials`); a return's unpost cannot simply delete the row
  either (it usually already had movement history from the shipment it
  is reversing) — it reverts the serial to `CONSUMED` instead
  (`undoReturnedSerials`).
- `Product.batchTrackingMode`/`serialTrackingMode` (`NONE | OPTIONAL |
  REQUIRED`) are now exposed on `POST/PATCH /organizations/:id/products`
  and enforced by `BatchSerialService.validateCapture` (`BatchRequiredError`/
  `SerialRequiredError`/`SerialCountMismatchError`) before any document is
  created.
- Not yet built: a `WarehouseLocation`-level pick (serials/batches
  capture a warehouse but not yet a specific bin location on issue),
  and `InternalConsumption`/`InventoryAdjustment`/`InventoryStatusTransfer`
  still only accept an existing `batchId` (no serial capture wired into
  those three — they are lower-volume, non-commercial document types
  where the spec's own examples focus on Goods Receipt/Shipment/Returns).

## H. Phase 11 readiness

`InventoryMovement.provisionalCost`/`costingStatus`/`journalEntryId` are
reserved, unused columns — Phase 11 (Inventory Costing) is expected to
populate them per movement and use them to finally post the
`InternalConsumption`/`InventoryAdjustment` accounting batches this phase
deliberately leaves unposted (section C above).
