# Purchase Execution (docx spec Phase 9)

Executes against a confirmed `PurchaseOrder` (Phase 8's "Supplier Order")
the way Sales Execution (Phase 7) executes against a confirmed
`SalesOrder`: `GoodsReceipt` is the physical event (real inventory
movement), `PurchaseInvoice` is the commercial/legal/tax event (real
input VAT + Accounts Payable), kept structurally distinct.
`PurchaseReturn` and `AdditionalPurchaseCost` round out the flow. All four
are full `document-framework` participants — real transactional posting,
optimistic concurrency, period control, idempotency, audit — through the
same generic `/documents/<TYPE>/:id/post|unpost|cancel` commands every
prior phase's documents use.

## A. Procurement architecture

```
Supplier Order (Phase 8)
   │  create-based-on
   ▼
GoodsReceipt ──────────────► PURCHASE_ORDER_REGISTER-style movement
   │  Dr Inventory / Cr GRNI clearing (538)        (Model A — see D)
   │  real INVENTORY_REGISTER RECEIPT movement
   │  create-based-on
   ▼
PurchaseInvoice ───────────► real input VAT (TaxRegisterService)
   │  Dr GRNI clearing (538) [receipt-linked line]  or
   │  Dr Inventory (205)     [order-only line, no receipt]
   │  Dr Recoverable/Non-recoverable Input VAT
   │  Cr Accounts Payable (531)
   │  → creates SupplierPayable
   │  create-based-on
   ▼
PurchaseReturn ─────────────► reverses the above (post- or pre-invoice
                               shape, see E), real INVENTORY_REGISTER
                               ISSUE movement

AdditionalPurchaseCost ─────► allocates a third-party cost (freight,
                               customs, ...) across GoodsReceiptLines,
                               Dr Inventory (per product) / Cr AP
```

All the alternative flows the spec calls out (section 1) are supported
because every source reference (`supplierOrderId`, `goodsReceiptId`,
`supplierOrderLineId`, `goodsReceiptLineId`) is OPTIONAL, never a
required chain:
- **Supplier Order → Goods Receipt → Purchase Invoice** — the fully
  chained path (test-covered).
- **Supplier Order → Purchase Invoice (no receipt)** — `PurchaseInvoice`
  posts a direct `Dr Inventory` instead of clearing GRNI (test-covered).
- **Goods Receipt without a Supplier Order** — `GoodsReceiptService.create`
  accepts `supplierOrderId: undefined`; lines simply carry no
  `supplierOrderLineId`.
- **Purchase Invoice without a Supplier Order** — same, at the invoice
  level.
- **Supplier Order → Partial Receipt #1 → Partial Receipt #2 → Invoice**
  — `PurchaseFulfillmentService.remainingToReceive` recomputes live after
  each posted receipt (test-covered: 60 then 40 of a 100-unit order).
- **Goods Receipt → Invoice → Purchase Return** — test-covered.

## B. Dependencies (never duplicated)

Reuses, by reference (foreign key or type-string import), never a
duplicate table:
- Phase 0: numbering, periods, Create Based On engine, audit, document
  framework, `RegisterMovement`, `DocumentLineLink`.
- Phase 1: organization, warehouse, currency.
- Phase 2/3: product, unit of measure, counterparty (supplier =
  `counterpartyType` `SUPPLIER`/`BOTH`).
- Phase 4/5: Chart of Accounts, `AccountingPostingEngine`,
  `TaxCalculationService`, `TaxRegisterService`.
- Phase 7 (Sales Execution): `InventoryLedgerService` — the SAME
  quantity-only `INVENTORY_REGISTER` a `Shipment` RECEIPT/ISSUE writes to
  on the sales side; Purchase Execution is just another writer, not a
  parallel stock ledger.
- Phase 8 (Procurement): `PurchaseOrder`/`PurchaseOrderLine` — this
  phase's "Supplier Order". `PurchaseFulfillmentService` reads
  `PurchaseOrderLine` directly; no new order table.

## C. Domain objects (spec section 3, 43)

`GoodsReceipt`/`GoodsReceiptLine`, `PurchaseInvoice`/`PurchaseInvoiceLine`,
`SupplierPayable`, `PurchaseReturn`/`PurchaseReturnLine`,
`AdditionalPurchaseCost`/`AdditionalPurchaseCostLine`/
`PurchaseCostAllocation`, `PurchaseMatchingResult` — 11 tables, header/line
separated throughout (spec section 43). `PurchaseInvoiceLine.lineType`
(`INVENTORY`/`SERVICE`/`EXPENSE`/`FIXED_ASSET`/`PREPAYMENT`/`OTHER`)
drives both validation (only `INVENTORY`/`SERVICE` require a product) and
posting (expense-like lines debit `expenseAccountId` or `ADMIN_EXPENSE`,
never inventory/GRNI).

## D. Goods Receipt accounting model

**Model A only** (spec section 5) — a disclosed simplification of the
spec's own configurable choice:

```
Dr Inventory (GOODS_INVENTORY, 205)          lineTotal
Cr Goods Received Not Invoiced (538, GRNI)   lineTotal
```

`PurchaseInvoicePostingHandler` later clears the GRNI liability for any
receipt-linked line (`Dr GRNI / ... / Cr Accounts Payable`) — it never
debits Inventory a second time for that quantity, since the physical
receipt already did. Model B ("Receipt is inventory-only, Invoice posts
everything") is NOT implemented; there is no `AccountingPolicy` toggle
for it. See Technical Debt.

No input VAT is posted at receipt time (spec section 6) — VAT is a
legal/tax event that belongs to the Purchase Invoice.

`GoodsReceiptPostingHandler.validateForPosting` re-checks
`remainingToReceive` against the database inside the SAME posting
transaction (spec section 22: "do not blindly trust a UI-computed
remaining") — the over-receipt test posts a request for 50 when only 40
remains and gets rejected with the true remaining quantity in the error.

## E. Purchase Invoice — VAT, AP, and the two Dr shapes

`PurchaseInvoicePostingHandler` calls `TaxCalculationService` fresh at
POSTING time (never trusts `PurchaseInvoiceService`'s save-time preview —
same split `SalesInvoicePostingHandler` uses) and
`TaxRegisterService.registerTaxable` with `operationType: 'PURCHASE'`,
which the Tax Engine already resolves into DEBIT
recoverable/non-recoverable Input VAT lines. Per line:

- **Receipt-linked** (`goodsReceiptLineId` set): `Dr GRNI clearing (538)`
  — this quantity's inventory value was already recognized at receipt
  time.
- **Order-only or manual** (no `goodsReceiptLineId`): `Dr Inventory (205)`
  directly — no receipt ever happened in this system for that quantity
  (the spec's "Invoice without Goods Receipt" flow; a real physical
  receipt document should still be created separately for quantity
  tracking — this build does not auto-generate one).
- **Expense-like** (`SERVICE`/`EXPENSE`/`FIXED_ASSET`/`PREPAYMENT`/
  `OTHER`): `Dr expenseAccountId` if given, else `ADMIN_EXPENSE`.

Always: `Cr Accounts Payable (531)` for the gross total, and a
`SupplierPayable` row is created (see G).

Duplicate supplier invoice control (spec section 36): checked explicitly
in `PurchaseInvoiceService` (`organizationId + counterpartyId +
supplierInvoiceNumber`, clear `DUPLICATE_SUPPLIER_INVOICE` error) AND
enforced by a database `@@unique` constraint — the explicit check gives a
readable message, the constraint is the actual race-safe guarantee.
Postgres treats NULLs as distinct, so invoices without a
`supplierInvoiceNumber` never collide.

## F. Purchase Return — two accounting shapes

Mirrors `SalesReturnPostingHandler` (prorate tax from the ORIGINAL posted
`TaxMovement`, never re-resolve against today's rule) but branches on how
far the goods got:

- **Post-invoice** (`sourceInvoiceLineId` set): `Dr Accounts Payable
  (531)` / `Cr contra Input VAT` / `Cr Inventory (205)`.
- **Pre-invoice** (`sourceReceiptLineId` only — received, never invoiced):
  `Dr GRNI clearing (538)` / `Cr Inventory (205)` — no VAT, none was ever
  posted.

A physical `INVENTORY_REGISTER` ISSUE movement is always written (a
warehouse is required to post — spec section 16's "DECREASE stock").
Maximum returnable quantity (spec section 15) is
`received/invoiced − already-returned`, computed live by
`PurchaseFulfillmentService.maxReturnable`.

## G. Supplier Payable — an honest AP contract

`SupplierPayable` mirrors `SettlementObligation` (Phase 7's AR contract)
but kept as its own table so AP and AR reporting never need a
`sourceDocumentType` filter to stay apart. `paidAmount` stays 0 and
`status` stays `OPEN` forever in THIS BUILD — there is no Payment/Advance
engine (Phase 13/14 boundary, spec section 56). `OVERDUE` is computed
LIVE by `SupplierSettlementService` from `dueDate` vs "now", never
persisted, so it can never drift stale — the same "never fabricate
PARTIALLY_PAID/PAID" discipline `SettlementObligation` established.

## H. Additional Purchase Cost — allocation

`AdditionalPurchaseCostPostingHandler` allocates `totalCost` across its
`targetLines` (each a `GoodsReceiptLine`) by the chosen method
(`BY_QUANTITY`/`BY_VALUE`/`BY_WEIGHT`/`BY_VOLUME`/`EQUALLY`/`MANUAL`),
writing one `PurchaseCostAllocation` row per target — the exact handoff
row Phase 11 Costing is meant to read (spec section 12). Rounding: every
allocation except the last is `round(totalCost × weight / Σweight, 2)`;
the last absorbs the remainder so allocations always sum to exactly
`totalCost`. **Capitalized-to-inventory model only** (disclosed
simplification, mirrors the Goods Receipt Model-A-only choice): always
`Dr Inventory (per product) / Cr Accounts Payable`, never the
expense-recognition alternative the spec also allows.

## I. Three-Way Matching

`PurchaseMatchingService.compute` compares, per invoice line: ordered
quantity/price (from `PurchaseOrderLine`), received quantity (from the
linked `GoodsReceiptLine`), and invoiced quantity/price — live, never a
posting gate. `checkAndPersist` snapshots the result into
`PurchaseMatchingResult` (spec's own `purchase_matching_results` table),
explicitly, on demand (`POST .../check-matching`) — NEVER automatically
on every posting, since this build has no configurable tolerance/approval
workflow to decide what "requires review" even means (spec sections
372-376). Tolerance is 0 (any non-rounding difference is a mismatch).

## J. Permissions

`purchase_execution.{view,create,edit,return,view_accounting}`. Confirm/
unpost/cancel on all four document types reuse the generic
`documents.{post,unpost,cancel}` permissions on
`/documents/<TYPE>/:id/...`, exactly like every prior phase's documents
(`SalesOrder`, `PurchaseOrder`, `Shipment`, ...) — no
`PURCHASE_POST`/`PURCHASE_UNPOST`/`PURCHASE_CANCEL` duplicate codes. The
spec's `PURCHASE_APPROVE`/`PURCHASE_DELETE_DRAFT`/`PURCHASE_VIEW_COST`/
`PURCHASE_OVERRIDE_PRICE`/`PURCHASE_OVERRIDE_TAX`/`PURCHASE_OVER_RECEIPT`/
`PURCHASE_OVER_INVOICE`/`PURCHASE_PERIOD_OVERRIDE` codes are NOT
implemented — there is no approval workflow, draft-delete endpoint, or
override mechanism for any of them to gate. See Technical Debt.

## K. Audit

`GOODS_RECEIPT_CREATED/UPDATED`, `PURCHASE_INVOICE_CREATED/UPDATED`,
`PURCHASE_RETURN_CREATED`, `ADDITIONAL_COST_CREATED`,
`PURCHASE_MATCHING_CHECKED`, `PURCHASE_MATCHING_FAILED` (when the
computed status isn't `MATCHED`). Posting lifecycle
(`DOCUMENT_POSTED`/`DOCUMENT_UNPOSTED`/`DOCUMENT_CANCELLED`) is audited
generically by `DocumentPostingService`, same as every other document
type — no separate posting-history table (spec section 38's "POSTED/
UNPOSTED/REPOSTED/REVERSED/CANCELLED" trail lives in the generic audit
log's event stream, not a bespoke one).

## L. Database

New tables: `goods_receipts`, `goods_receipt_lines`, `purchase_invoices`,
`purchase_invoice_lines`, `supplier_payables`, `purchase_returns`,
`purchase_return_lines`, `additional_purchase_costs`,
`additional_purchase_cost_lines`, `purchase_cost_allocations`,
`purchase_matching_results` (11 new tables, one manual migration, no
drops). Key constraints:
- `purchase_invoices`: `@@unique([organizationId, counterpartyId,
  supplierInvoiceNumber])` (spec section 36's duplicate control).
- Indexes on `(organizationId, status)`, `(organizationId,
  supplierOrderId)`, `(organizationId, goodsReceiptId)`, `(organizationId,
  dueDate)`, `(tenantId, productId)` and the FK columns spec section 44
  calls out.
- Cross-document execution links reuse the existing `document_line_links`
  table (`SUPPLIER_ORDER_TO_RECEIPT`, `RECEIPT_TO_INVOICE`,
  `SUPPLIER_ORDER_TO_INVOICE`, `RECEIPT_TO_RETURN`, `INVOICE_TO_RETURN`)
  rather than new join tables.

New accounting mapping key: `GOODS_RECEIVED_NOT_INVOICED` → account `538`
("Digər qısamüddətli kreditor borcları" — Other short-term payables),
distinct from `SUPPLIER_PAYABLE` (`531`) so GRNI and real AP never net
against each other in the same account.

## M. Tests

`test/purchase-execution.e2e-spec.ts` (8 tests, all passing):
1. Partial receipt twice (60 then 40 of a 100-unit order), live
   received/remaining recomputation, over-receipt rejected with the true
   remaining quantity, real GRNI clearing GL entry (balanced) + physical
   `INVENTORY_REGISTER` RECEIPT movement.
2. Goods Receipt ⇒ Purchase Invoice: GRNI cleared (not double-debited),
   real input VAT `TaxMovement`, `SupplierPayable` created, only ONE
   inventory movement exists for the whole chain.
3. Duplicate supplier invoice number rejected (409).
4. Invoice-without-receipt flow (direct from Supplier Order) debits
   Inventory directly; balanced GL.
5. Purchase Return against a posted invoice: prorated tax, balanced
   contra GL, physical ISSUE movement, excessive return (beyond
   received-minus-already-returned) rejected.
6. Additional Purchase Cost BY_VALUE allocation (single target ⇒ 100% of
   cost), balanced GL.
7. Three-way matching: MATCHED when order/receipt/invoice agree;
   QUANTITY_MISMATCH when the invoice differs from the receipt; result
   persisted via `check-matching` and readable via matching-history.
8. Tenant isolation (404 on cross-tenant read; 400 on cross-tenant
   create referencing another tenant's supplier).

Run: `cd backend && npx jest --config test/jest-e2e.json purchase-execution.e2e-spec.ts`

## N. Phase 10/11/13/14 readiness (spec section 56)

- **Phase 10 (Inventory)**: `InventoryLedgerService`'s quantity-only
  register already carries every RECEIPT/ISSUE this phase writes; a real
  warehouse-bin/lot module can layer on top without touching this phase's
  posting handlers.
- **Phase 11 (Costing)**: `PurchaseCostAllocation` is the exact handoff
  row (product + goods receipt line + allocated amount) a real costing
  engine needs; `PurchaseOrderLine.price`/`GoodsReceiptLine.price` are
  explicitly documented as commercial reference, never final valuation.
- **Phase 13 (AR/AP settlement)**: `SupplierPayable` already carries every
  dimension a real settlement engine needs (supplier, currency, due date,
  source document) — only `paidAmount` tracking and payment allocation
  are missing, by design.
- **Phase 14 (Treasury)**: `SupplierPayable.dueDate` is ready for a
  Payment Calendar to read; no Bank Payment is ever created here.

## O. Technical debt / deferred functionality

Disclosed deliberately, matching every prior phase's documentation:

- **No batch/serial tracking.** The spec's `batch_id`/serial-tracking
  fields on `GoodsReceiptLine` are not implemented — no `Batch`/`Serial`
  master data exists anywhere in this codebase yet (would be Phase 2/10
  schema work). Every quantity in this phase is a plain aggregate.
- **No approval workflow.** `DRAFT`/`PENDING_APPROVAL`/`APPROVED`/
  `REJECTED` (spec section 19) are not implemented — every document uses
  the existing `DocumentStatus`/`PostingStatus` pair
  (`DRAFT`/`ACTIVE`/`CANCELLED` × `NOT_POSTED`/`POSTED`), same as every
  prior phase's documents. `PURCHASE_APPROVE` has no code and no
  enforcement point.
- **Model B (inventory-only receipt) not implemented.** Only Model A
  (GRNI clearing) exists; there is no `AccountingPolicy` toggle to
  switch.
- **No posting preview / dry-run engine** (spec section 50). Nothing
  computes "what would this posting produce" without actually posting.
- **No domain events / outbox** (spec section 53). `GoodsReceiptPosted`,
  `PurchaseInvoicePosted`, etc. are not published anywhere — no event bus
  or outbox table exists in this codebase.
- **No attachments** (spec section 35). No file storage infrastructure
  exists anywhere in this codebase yet.
- **No import-purchase customs/Incoterm structure** (spec section 34)
  beyond the plain `countryOfOrigin`/`customsDeclaration` string columns
  on `GoodsReceiptLine` — no customs accounting, no foreign-currency
  freight cost breakdown.
- **No Payment/Advance/PaymentAllocation** (spec sections 17-18) — the
  Phase 13/14 boundary the spec itself draws (section 56). `SupplierPayable
  .paidAmount` is always 0.
- **No configurable matching tolerance or approval gate** (spec section
  8) — tolerance is hardcoded to 0; a mismatch never blocks posting, only
  reports.
- **`FIXED_ASSET`/`PREPAYMENT` invoice lines never create a
  `FixedAssetAcquisitionCandidate`/deferred-expense record** — posted
  exactly like an `EXPENSE` line (spec explicitly allows this: "Birbaşa
  Fixed Asset object yaratmaq məcburi deyil").
- **`AdditionalPurchaseCost` is not part of any Create Based On chain** —
  the target-lines/supplier/totalCost combination has no sensible 1:1
  header mapping from a single source document (the spec's own "Goods
  Receipt → Additional Purchase Cost" chain is the one Create Based On
  chain from section 25 NOT implemented here).
- **Supplier Purchase Analysis report and dashboard metrics** (spec
  sections 39-40, the parts not listed in section M) are not implemented
  — straightforward extensions of the existing reporting queries, left
  for whichever phase actually builds a reporting UI.
- **No true concurrency test** — optimistic locking is implemented
  (inherited from the document framework) but not exercised under genuine
  parallel load in the e2e suite, same disclosed gap as every prior
  phase.
