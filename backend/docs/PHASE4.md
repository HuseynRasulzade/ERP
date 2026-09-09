# Phase 4 — Sales Documents (Orders + Invoices)

Completion report for Phase 4. First real business documents on the
DocumentFramework — builds entirely on Phase 0/1/2/3, no prior
infrastructure duplicated: numbering, periods, audit, optimistic
concurrency, RBAC/organization access, price resolution, and the
save → post → unpost → cancel engine are all reused as-is.

## A. Entity model

| Entity | Scope | Purpose |
|---|---|---|
| `SalesOrder` | Organization | Customer order header: counterparty, dates, currency, snapshot totals. |
| `SalesOrderLine` | Order header | Product × unit × quantity × snapshotted price + tax math per line. |
| `SalesInvoice` | Organization | Billing header, standalone or drafted from an order. Same shape as order. |
| `SalesInvoiceLine` | Invoice header | Same shape as order line + `sourceOrderLineId` (provenance, future use). |

Header field set mirrors `BaseDocumentFields` (same shape as
FoundationTestDocument) plus `counterpartyId`, `currencyId`,
`exchangeRate`, `subtotal`/`taxTotal`/`grandTotal`, and
`priceIncludesTax`.

## B. Access control

Same two layers as Phase 1/2/3:
1. **RBAC** — `sales_order.{view,create,edit}` ·
   `sales_invoice.{view,create,edit}`. Posting flows through the generic
   `/documents/:type/:id/post|unpost|cancel` commands gated by
   `documents.post|unpost|cancel` (never a per-document post code).
2. **Organization access** — both headers are organization-scoped via
   `OrganizationAccessService.assertAccess`. A missing grant reads as
   "not found," never "forbidden" (Phase 1 pattern).

## C. Price snapshotting (SAVE, never POST)

`SalesOrderService` / `SalesInvoiceService` resolve every line at SAVE:

1. An explicit line `price` is kept as-is (`priceListId` stays null —
   the user overrode the list).
2. An omitted `price` is filled from `PriceListService.resolvePrice(...,
   'SALE', productId, businessDate, qty, counterpartyId)` — counterparty
   specificity → priority → quantity break, same engine Phase 3 documents.
3. No match → `ValidationAppError` ("No sale price found …") — a saved
   line always carries a concrete price.
4. `computeLineTotals(qty, price, taxRate, priceIncludesTax)` snapshots
   `lineTotal`/`taxAmount`/`lineTotalWithTax` (2-decimal currency
   precision); `sumDocumentTotals` snapshots header totals.

Posting handlers (`SalesOrderPostingHandler`,
`SalesInvoicePostingHandler`) only read the snapshot — they never call
`resolvePrice`. Changing a price list after SAVE cannot change an
already-saved document, and the invoice drafted from an order agrees
with the order because lines are copied from the order snapshot.

`priceIncludesTax=false` (default): price is net, tax added on top.
`true`: price is gross, net derived by dividing out tax. Flipping only
the flag recomputes stored lines under the new flag instead of keeping
stale totals.

## D. Validation

- Counterparty must belong to the same organization, be active, and be
  `CUSTOMER` or `BOTH` (suppliers rejected at SAVE and at posting).
- Product must belong to the same organization and be active; unit must
  exist in the tenant; quantity > 0; taxRate ≥ 0; explicit price ≥ 0.
- Order SAVE requires ≥ 1 line; invoice SAVE requires ≥ 1 line; invoice
  posting additionally requires `grandTotal > 0`.
- Posted documents cannot be edited (`Unpost … before editing it`);
  cancelled documents cannot be edited.
- Line edits replace the set wholesale (delete + re-insert in the same
  transaction) with the version guard (`updateMany where
  version=expectedVersion`, 0 rows → `CONCURRENCY_CONFLICT`).

## E. Database

New tables: `sales_orders`, `sales_order_lines`, `sales_invoices`,
`sales_invoice_lines` (migration
`20260908160000_phase4_sales_documents`).

Key constraints:
| Table | Unique |
|---|---|
| `sales_orders` | `(tenantId, number)` |
| `sales_invoices` | `(tenantId, number)` |

Indexes mirror the document-table convention: `(tenantId,
documentDate)`, `(tenantId, status)`, `(organizationId,
counterpartyId)` on headers; `(headerId, position)`, `(tenantId,
productId)` on lines. FKs: RESTRICT to tenants/orgs/counterparties/
products/units, SET NULL for nullable currency, CASCADE lines →
header. `priceListId`/`productPriceId`/`sourceOrderLineId` are plain
provenance columns (no FK — the snapshot must survive list edits).

Numbers come from `NumberingService.allocateNumber` inside the save
transaction (`SO-`/`SI-` prefix, YEARLY reset, `SELECT … FOR UPDATE`
row lock — never `MAX+1`).

## F. Permissions (6 new, 83 total)

`sales_order.{view,create,edit}` · `sales_invoice.{view,create,edit}`

All granted to the seeded `TENANT_ADMIN` automatically via
`SEED_PERMISSIONS = ALL_PERMISSION_CODES` (re-run `prisma:seed` after
migrating). Posting still uses the Phase 0 `documents.post|unpost|
cancel` codes.

## G. API endpoints

- `GET/POST /organizations/:orgId/sales-orders`, `GET/PATCH
  .../sales-orders/:id`
- `GET/POST /organizations/:orgId/sales-invoices`, `GET/PATCH
  .../sales-invoices/:id`
- `POST /documents/SALES_ORDER/:id/post|unpost|cancel` (`{expectedVersion}`)
- `POST /documents/SALES_INVOICE/:id/post|unpost|cancel` (`{expectedVersion}`)
- `GET /documents/SALES_ORDER/:id/create-based-on/targets` →
  `["SALES_INVOICE"]`
- `POST /documents/SALES_ORDER/:id/create-based-on/SALES_INVOICE` →
  header-only invoice draft + `CREATED_BASED_ON` link (lines added via
  invoice `PATCH` before posting)

Posting movements: one `SALES_ORDER_REGISTER` / `SALES_ORDER_LINE`
movement per order line; one `SALES_SETTLEMENT_REGISTER` /
`RECEIVABLE_ACCRUAL` movement per invoice line.

## H. Out of scope (Phase 5+)

No stock reservation/shipment on order posting, no payments/settlement
against invoices, no purchase documents, no line-level copying with
provenance in CreateBasedOn (header-only + manual line add for now),
no multi-currency revaluation (`exchangeRate` column reserved).

## I. Phase 5 readiness

Purchase documents can mirror this vertical slice exactly: same
repository/adapter + handler + service shape, `resolvePrice` with
`PURCHASE` type and `SUPPLIER`/`BOTH` counterparties, and a
`PURCHASE_*` mapper registered the same way. `sourceOrderLineId` on
invoice lines is reserved for order→invoice line linkage when partial
fulfilment lands.
