# Sales Documents ⇄ Accounting Core + Tax Engine Reconciliation

Completion report for the final step of the "build Accounting Core, then
Tax Engine, then reconcile Sales docs" plan. This is not a docx spec phase
of its own — it closes the gap the earlier two builds identified:
Sales Orders/Invoices (this repo's own "Phase 4") existed before
[Accounting Core](./ACCOUNTING_CORE.md)/[Tax Engine](./TAX_ENGINE.md) did,
computing tax with placeholder per-line math and never touching the
General Ledger.

## What changed

### 1. `DocumentPostingHandler` gained an optional `buildAccountingBatch` hook

`src/document-framework/document-posting-handler.interface.ts`. A handler
can now return `{ description?, operationType?, lines: AccountingPostingLineInput[] }`
from this method; `DocumentPostingService.post()` calls it (if present)
inside the SAME transaction as everything else, then hands the lines to
`AccountingPostingEngine.postBatch` — so a document's register movements,
its GL consequence, and its `postingStatus = POSTED` flip are all one
atomic write (Accounting Core spec section 44, Tax Engine spec section
67). `DocumentPostingService.unpost()` was extended symmetrically and
generically (no handler cooperation needed, since `JournalEntry`/
`TaxMovement` already carry `sourceDocumentType`/`sourceDocumentId`): it
looks up any `POSTED` Journal Entry for this source and unposts it via
`AccountingPostingEngine.unpost`, and deletes any (non-reversal)
`TaxMovement` rows for the source. A stale `DRAFT` Journal Entry left by
an unpost is deleted before a repost creates a fresh one, so reposting
never accumulates orphaned drafts (Accounting Core spec section 46).

This is a one-way module dependency:
`document-framework` → `accounting-core`. Existing document types
(`FoundationTestDocument`, `SalesOrder`) simply don't implement the new
optional method and are completely unaffected — proven by the full
existing test suite passing unchanged.

### 2. `SalesInvoicePostingHandler` implements it

`src/sales-documents/sales-invoice.posting-handler.ts`. On post, for each
invoice line:

1. Resolve a tax category — `ProductTaxProfile` if one is configured for
   the product/organization/date, else the `STANDARD_VAT` default.
2. Run it through `TaxCalculationService.calculateLine` (the real Tax
   Engine — **not** the line's own `taxRate` field, which the original
   Sales build used for its placeholder math).
3. Register the results via `TaxRegisterService.registerTaxable`, which
   also resolves the VAT account through `AccountingMappingService`.

Then it builds:
```
Dr Customer Receivable (211)     gross total
Cr Sales Revenue (601)           one line per product, net amount
Cr VAT Output Payable (521)      the Tax Engine's resolved output VAT
```
and `DocumentPostingService` posts this as one balanced Journal Entry,
linked back to the invoice via `sourceDocumentType`/`sourceDocumentId`,
with the `TaxMovement` rows backfilled with that Journal Entry's id for
drilldown (Tax Engine spec section 108).

**`SalesOrder` was deliberately left untouched** — no `buildAccountingBatch`.
An order is a customer commitment, not a revenue event; booking GL/VAT
consequences on order creation would misstate revenue recognition. This
matches the spec's own phrasing (Tax Engine spec section 136): Phase 7
(invoicing) generates the accounting instructions, not the order stage.

### 3. Currency fallback

An invoice can be saved without an explicit `currencyId` (existing,
unchanged behavior). At posting time, `buildAccountingBatch` now falls
back to the organization's `baseCurrencyId`, then the tenant's, so the
`CURRENCY` accounting dimension (required on 211 by the AZ chart's
default dimension rules) always has something real to reference.

### 4. `AccountingPostingEngine.postDraft/unpost/reverse` accept an optional external transaction

Previously only `postBatch` did. All four methods now share the same
`tx ? run(tx) : this.prisma.runInTransaction(run)` pattern, which is what
makes the generic unpost hookup above possible without opening a second,
nested transaction.

### 5. `AGREEMENT` dropped from the AZ default dimension rules

`src/accounting-core/az-standard-coa.data.ts`. No `Agreement`/`Contract`
entity exists anywhere in this codebase (Phase 3 stops at
`Counterparty`/`PriceList`). Requiring a dimension with nothing real to
reference it would have forced this integration (and every future one)
to invent a fake value — so it was removed from 171/211/192/243/431/531/
443/543's required-dimension sets rather than faked. `SETTLEMENT_DOCUMENT`
is populated with the invoice's own id, which is a legitimate reference
(the invoice literally is the settlement document in this simple flow).

## Verified end-to-end (test/phase4.e2e-spec.ts)

- Posting a standalone Sales Invoice creates a balanced 3-line Journal
  Entry (Receivable/Revenue/VAT) using the Tax Engine's 18% standard
  rate, and one `TaxMovement` linked to that Journal Entry.
- Unposting removes the GL movements (Journal Entry back to `DRAFT`) and
  deletes the `TaxMovement` rows.
- Reposting creates exactly one new Journal Entry — the stale `DRAFT` is
  cleaned up, never left orphaned.
- The existing Sales Order/Invoice save, price-snapshot, concurrency,
  tenant-isolation, and closed-period tests are all unaffected (they
  don't exercise the new hook at all, or — for the closed-period test —
  the Period Guard still fires before the hook is ever reached).

130/130 tests pass across all seven e2e suites (phase0–4, accounting-core,
tax-engine) plus 3 unit tests.

## Technical debt / deferred

- **Sales Order still has no accounting consequence.** Intentional (see
  above), but also means there is currently no GL/tax event anywhere in
  the order→invoice flow until an invoice exists — a `CreateBasedOn`
  order that's never invoiced produces no financial record at all, which
  is correct accounting but worth stating explicitly.
- **COGS/Inventory (Dr 701 / Cr 205) is not posted.** Requires an
  inventory costing engine (unit cost per product) that doesn't exist in
  this codebase — matches the Accounting Core spec's own Phase 10/11
  boundary, not a shortcut invented here.
- **The invoice's displayed `taxAmount`/`grandTotal` (computed at SAVE
  time via `sales-totals.util.ts`'s ad-hoc per-line `taxRate`) can
  diverge from what actually posts to the GL/Tax Register** (computed at
  POST time via the real Tax Engine, defaulting every line to
  `STANDARD_VAT`) if a line was saved with a custom `taxRate` different
  from 18%. Unifying these — making the Tax Engine the source of truth
  at save time too, with a real per-product `taxCategoryCode` input
  instead of a free-typed rate — is a real, scoped-out follow-up; it
  would touch the DTOs, both Sales services, and a schema migration
  (a `taxCategoryCode` column so a historical document's originally
  resolved category survives a later repost), plus updates to every
  existing phase4 test that hardcodes a custom `taxRate` expectation.
- **`SalesInvoicePostingHandler` doesn't distinguish organization VAT
  registration status** (`TaxRegistration`) before charging output VAT —
  it always resolves `STANDARD_VAT` regardless of whether the
  organization is actually VAT-registered for the invoice's date. Tax
  Engine's own docs already flag that `TaxRuleResolver` doesn't consult
  `TaxRegistration` yet; this is the same gap surfacing at the
  integration point.
- **No `SalesReturn`/credit-note handling.** A posted invoice can be
  reversed via the generic Journal Entry reversal mechanism (Accounting
  Core), but there's no Sales-side "credit note" document type or UI
  concept that drives it — the `AccountingPostingEngine.reverse` /
  `TaxRegisterService.reverseTaxable` primitives exist and are tested at
  the engine level, just not wired to a Sales document command yet.
