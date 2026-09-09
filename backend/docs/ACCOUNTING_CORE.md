# Accounting Core — Chart of Accounts & Double-Entry Posting Engine

Completion report for the Accounting Core build (docx spec **"Phase 4 —
Accounting Core & Azerbaijan Chart of Accounts"**). Named by content rather
than a phase number in this codebase: this repo's own Phase 4 already means
[Sales Documents](./PHASE4.md) (orders + invoices), built before this engine
existed — see the Technical Debt section below for how that will be
reconciled.

Module: `src/accounting-core/`. Builds entirely on Phase 0/1: reuses
`PeriodService.assertDateIsOpen` (the Period Guard), `AuditService`,
`NumberingService`, `OrganizationAccessService`, and the tenant-isolation/
optimistic-concurrency/AppError conventions already established — no
duplicate infrastructure.

## A. Architecture

```
Business Document -> Posting Handler -> AccountingPostingBatch
  -> AccountingPostingEngine -> JournalEntry -> AccountingMovement -> GL
```

`AccountingMovement` is the only source of truth for balances — there is no
cached `account.balance` column anywhere. `AccountingPostingEngine` is the
single gateway that creates it; every other service (Manual Operations,
future Sales/Purchase/Tax integrations) goes through it rather than writing
ledger rows directly.

Two entry points, both funnelling into the same validate → movements →
audit path:
- **Manual Operation flow** (`createDraft` → `postDraft` → `unpost` /
  `reverse`) — an accountant enters lines, saves a DRAFT, posts it
  separately.
- **`postBatch`** — atomic create-and-post in one call, `tx`-injectable so
  a future system document (Sales, Purchase, ...) can post inside its own
  transaction (spec section 44). Not yet called by any document handler in
  this build — see Technical Debt.

## B. Azerbaijan Chart

Seeded once as a shared system template (`ChartOfAccounts.tenantId = null`,
`code = AZ_STANDARD`), then cloned per-tenant on first use
(`ChartOfAccountsService.ensureAdopted`, idempotent). 9 Financial Statement
Sections, ~30 Groups, and every account code the spec lists (101–193,
201–245, 301–344, 401–445, 501–545, 601–641, 701–761, 801, 811, 901, 902),
including the three explicit subaccounts (414-1, 501-1, 515-1) with real
`parentAccountId` hierarchy — never inferred from code length. Account
codes are `String`, never numeric.

Groups (10, 20, 30, ...) themselves are **not** modeled as `Account` rows —
they exist only as `FinancialStatementGroup` reporting metadata, which
already structurally prevents posting to them (an `Account.code` never
equals a bare group code). A handful of the spec's own leaf codes are
non-postable structural placeholders instead (341, 411, 414, 501, 515,
801) — seeded with `postingAllowed = false`.

## C. Account classifications

Every account has explicit `accountClass` (ASSET / CONTRA_ASSET /
LIABILITY / CONTRA_LIABILITY / EQUITY / CONTRA_EQUITY / REVENUE /
CONTRA_REVENUE / EXPENSE / PROFIT_LOSS / TAX_EXPENSE) and `normalBalance`
(DEBIT / CREDIT / BOTH), assigned per-account in
`az-standard-coa.data.ts` — never derived from the numeric code at
runtime. `currencyTracking`/`quantityTracking` flags follow the spec's
guidance (211/223/531/etc. currency-tracked; 201/204/205/207
quantity-tracked).

## D. Subconto matrix (default dimension rules)

Seeded via `AZ_DEFAULT_DIMENSION_RULES`, backdated to the epoch so they
apply to every historical business date, not just dates after adoption:

| Account | Required dimensions |
|---|---|
| 171, 211 | Partner, Counterparty, Agreement, Settlement Document, Currency |
| 192, 243 | Partner, Counterparty, Agreement, Currency |
| 201, 204, 205, 207 | Product, Warehouse |
| 221 | Cashbox, Currency |
| 223, 224 | Bank Account, Currency |
| 431, 531 | Partner, Counterparty, Agreement, Settlement Document, Currency |
| 443, 543 | Partner, Counterparty, Agreement, Currency |
| 601 | Product |
| 701 | Product, Warehouse |

Posting rejects with `ACCOUNT_DIMENSION_REQUIRED` if any of these is
missing, and rejects an unknown dimension code with a validation error.
Dimension values are stored twice by design: `JournalLineDimension` (still
mutable pre-posting) and `AccountingMovementDimension` (frozen onto the
posted, immutable movement) — so unpost/repost of the draft never risks
rewriting posted history.

## E. Accounting Mappings

`AccountingMappingService.resolve(tenantId, organizationId, mappingKey,
businessDate)` — organization-specific mapping beats a tenant-wide default;
an exact-priority tie between two candidates throws
`ACCOUNT_MAPPING_AMBIGUOUS` rather than picking one silently. Default AZ
mappings seeded per tenant on adoption: `CASH→221`, `BANK→223`,
`MATERIAL_INVENTORY→201`, `FINISHED_GOODS→204`, `GOODS_INVENTORY→205`,
`CUSTOMER_RECEIVABLE→211`, `SUPPLIER_ADVANCE→243`, `CUSTOMER_ADVANCE→543`,
`SUPPLIER_PAYABLE→531`, `SALES_REVENUE→601`, `SALES_RETURN→602`,
`SALES_DISCOUNT→603`, `COGS→701`, `COMMERCIAL_EXPENSE→711`,
`ADMIN_EXPENSE→721`, `OTHER_OPERATING_INCOME→611`,
`OTHER_OPERATING_EXPENSE→731`, `CURRENT_INCOME_TAX_EXPENSE→901`.
`VAT_RECOVERABLE`/`VAT_PAYABLE` keys are reserved but deliberately left
unmapped — the Tax Engine build owns seeding those two.

## F. Journal model

`JournalEntry` (header, status DRAFT/POSTED/REVERSED, never edited
directly by API — only via post/unpost/reverse commands) → multiple
`JournalEntryLine` (one `side` + one positive `amountBase`, never separate
debit/credit columns) → each line's `JournalLineDimension` rows.

## G. Register

`AccountingMovement` is written only by `AccountingPostingEngine`, never
updated once created. Corrections are either **unpost** (only while the
period is still open — deletes the movements and returns the entry to
DRAFT, used for manual-operation mistakes caught immediately) or
**reversal** (a brand-new JournalEntry with flipped debit/credit sides;
the original is marked `REVERSED` but its movements are never deleted —
full history stays visible, and each reversal movement carries
`reversalOfMovementId` back to the original it neutralizes).

## H. Multi-currency

`transactionCurrencyId` / `amountTransaction` / `exchangeRate` are carried
on both the line and the frozen movement so a historical foreign-currency
entry never has to be reconstructed from today's `ExchangeRate` table.
**Not strictly enforced yet**: an account with `currencyTracking = true`
does not currently *require* a transaction currency on its lines — see
Technical Debt.

## I. Opening balances

Schema/engine support exists (`JournalEntry.isOpeningBalance`,
`operationType = OPENING_BALANCE`, `AccountingPostingBatch.isOpeningBalance`
flag on `postBatch`), but there is **no dedicated Opening Balance
endpoint/UI** yet — a caller would construct a `postBatch` call with
`isOpeningBalance: true` today. Deferred; see Technical Debt.

## J. Reversal / unposting / reposting

Reversal and unposting are both implemented and tested (see below).
**Reposting** (spec section 46 — a full generation-N+1 replace-in-place
cycle with `PostingRun` bookkeeping) is **not** implemented as its own
operation; `unpost` then `postDraft` again achieves the same practical
effect for manual operations today. The `PostingRun` and
`JournalEntry.generation` columns exist in the schema for this but nothing
writes to `PostingRun` yet.

## K. Reports

`AccountingQueryService`: Trial Balance (opening/turnover/closing debit
and credit per account, with `accountId` + `includeSubaccounts`-style
hierarchy rollup via `descendantIdsIncludingSelf`), General Ledger
(chronological movements with journal/account joins, paginated), Account
Card (opening balance, chronological movements with a running balance,
closing balance). Dimension-filtered drilldown (spec section 70/110) is
**not** implemented — the spec itself defers the polished version of this
to Phase 23; the `AccountingMovementDimension` table this will query
against already exists.

## L. Permissions

`accounting.chart.{view,manage}`, `accounting.account.{view,create,edit,
deactivate}`, `accounting.dimension.{view,manage}`,
`accounting.mapping.{view,manage}`, `accounting.journal.{view,post,
unpost,reverse}`, `accounting.manual_operation.{view,create,edit,post,
unpost}`, `accounting.opening_balance.{view,manage}`,
`accounting.posting_history.view`, `accounting.trial_balance.view`,
`accounting.general_ledger.view` — added to `permission-codes.ts`, granted
to the seeded `TENANT_ADMIN` role automatically (`prisma/seed.ts` re-run
required after this change to pick up the new codes on an existing
database — done for local dev; a production deploy needs the same).

## M. Audit

`AuditService.record` called for: `ACCOUNT_CREATED`, `ACCOUNT_UPDATED`,
`ACCOUNT_DEACTIVATED`, `ACCOUNT_MAPPING_CHANGED`, `JOURNAL_ENTRY_CREATED`,
`JOURNAL_ENTRY_POSTED`, `JOURNAL_ENTRY_UNPOSTED`, `JOURNAL_ENTRY_REVERSED`.
Not yet emitted: `SUBACCOUNT_CREATED` (covered by the generic
`ACCOUNT_CREATED` today), `ACCOUNT_DIMENSION_CHANGED`,
`MANUAL_OPERATION_POSTED` (covered by `JOURNAL_ENTRY_POSTED` since manual
operations post through the same path), `OPENING_BALANCE_POSTED`,
`ACCOUNTING_PERIOD_REJECTED_POSTING`, `POSTING_FAILED`, `POSTING_REPOSTED`
(the last three depend on the deferred reposting/PostingRun work above).

## N. Tests

`test/accounting-core.e2e-spec.ts` — 18 tests: idempotent chart adoption
(single- and cross-tenant), account hierarchy (414→414-1, 501→501-1,
515→515-1), reporting-node non-postability, coverage spot-checks across
every required account series, default mapping resolution + organization
override precedence, unbalanced-journal rejection (no movements persist),
required-dimension rejection, save→post→duplicate-post-rejected→unpost→
repost→reverse lifecycle (verifying movement counts and that reversal
never deletes the original), closed-period blocking, Trial
Balance/General Ledger/Account Card correctness, and tenant isolation.
All passing alongside the pre-existing 94 Phase 0–4 tests (112 total).

## O. Phase 5 (Tax Engine) readiness

The Tax Engine build should: resolve `VAT_RECOVERABLE`/`VAT_PAYABLE`
through `AccountingMappingService` against 241/226/521 (left unmapped
here on purpose); call `AccountingPostingEngine.postBatch` for its own
tax-consequence postings rather than writing movements directly; and use
`PeriodService.assertDateIsOpen` the same way this engine does — no new
period-guard logic needed.

## P. Technical debt / deferred (disclosed per spec section 156.P)

- **Reposting** as a first-class generation-tracked operation (unpost+
  post covers the practical case for manual operations today).
- **Opening Balance** dedicated endpoint/UI (the engine supports the flag;
  nothing calls it yet).
- **Currency/quantity requiredness** is not enforced — an account with
  `currencyTracking=true` doesn't yet *require* `transactionCurrencyId` on
  its lines, and `quantityTracking=false` doesn't yet *reject* an
  unexpected quantity.
- **Dimension-filtered Trial Balance drilldown** (by Partner/Agreement/
  etc.) — the spec itself defers the polished version to Phase 23; only
  account-level (with hierarchy rollup) is implemented.
- **Concurrent duplicate-posting** race test (spec section 133) — the
  `sourceDocumentType`/`sourceDocumentId` duplicate check in `postBatch`
  exists, but there's no test forcing two simultaneous posts to prove only
  one wins.
- **Sales/Purchase reconciliation** — this build does not touch
  `sales-documents`; its Sales Order/Invoice totals still use the
  placeholder tax math from before this engine existed. That reconciliation
  (wiring Sales posting through `AccountingPostingEngine.postBatch`,
  replacing ad-hoc tax math with the Tax Engine once built) is explicitly a
  separate, later step.
