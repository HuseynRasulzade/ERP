# Tax Engine — Version-Aware, Effective-Dated Tax Rules Engine

Completion report for the Tax Engine build (docx spec **"Phase 5 — Tax
Engine & Azerbaijan Localization Engine"**). Module: `src/tax-engine/`.
Builds on [Accounting Core](./ACCOUNTING_CORE.md) for semantic account
mapping and the double-entry posting engine, and on Phase 0 for the
Period Guard, audit, and tenant isolation.

## A. Tax Architecture

```
TaxContext -> TaxRuleResolver -> TaxCalculationResult -> TaxRegisterService
  -> caller merges the returned AccountingPostingLine[] into its own
     AccountingPostingEngine.postBatch call (same transaction)
```

`TaxCalculationService` never writes anything — it is pure computation,
usable identically for a `/tax/calculate` preview and for real posting.
`TaxRegisterService` writes only `TaxMovement` rows (the Tax Register);
it never touches `AccountingMovement` directly (spec section 5/114). The
`accountingLines` it returns (with real, mapping-resolved `accountId`s)
are meant to be merged by the caller into one `AccountingPostingEngine.
postBatch` call passed the *same* Prisma transaction, so Tax Register and
General Ledger post atomically together (spec section 67) — proven in
`test/tax-engine.e2e-spec.ts` "Atomic Tax Register + GL posting".

## B. Legal Sources

Primary source: **Tax Code of the Republic of Azerbaijan (consolidated)**,
https://e-qanun.az/framework/46948 — seeded as a `TaxLegalSource` row.

**Provenance disclosure**: that page is JavaScript-rendered and could not
be fetched as text in this build session. The article references used
below (160 for the standard VAT rate, 165–166 for zero-rate/exemption,
175 for input VAT offset) were sourced from secondary tax-guide summaries
(PwC Tax Summaries, Grant Thornton's Indirect Tax guide, VATupdate's 2026
Azerbaijan VAT guide) that consistently agree on an 18% standard rate.
**This has not been verified against the primary legal text directly** —
a qualified reviewer should confirm exact article/paragraph wording
against e-qanun.az before this configuration is relied on for actual
filings. This matches the spec's own intended workflow (section 74):
legal source detected → proposed rule → human/legal review → activation.
The rules are seeded `ACTIVE` (the 18% rate is uncontroversial, stable
since 2001) but this disclosure stands as the "human review" checkpoint
the spec requires before treating it as fully verified.

## C. Rule Version Matrix

| Rule | Category | Effective From | Effective To | Status | Legal Basis |
|---|---|---|---|---|---|
| `AZ_VAT_STANDARD_RULE` | STANDARD | 2001-01-01 | — | ACTIVE | Art. 160 |
| `AZ_VAT_ZERO_RATE_RULE` | ZERO_RATE | 2001-01-01 | — | ACTIVE | Art. 165 |
| `AZ_VAT_EXEMPT_RULE` | EXEMPT | 2001-01-01 | — | ACTIVE | Art. 166 |
| `AZ_VAT_OUT_OF_SCOPE_RULE` | OUT_OF_SCOPE | 2001-01-01 | — | ACTIVE | — |

All seeded with `tenantId = null` (shared system rules). A tenant can add
its own higher-priority `TaxRule` rows (demonstrated in the versioning
test) without ever editing these — never a destructive update to an
existing rule's dates/treatment (spec section 8).

## D. VAT Configuration

- **Standard** (`STANDARD_RATE`): 18% on the taxable base, `AZ_VAT_STANDARD` rate.
- **Zero-rated** (`ZERO_RATED`): rate 0%, but the taxable base and legal
  rule are still recorded — never silently discarded (spec section 48).
- **Exempt** (`EXEMPT`): tax = 0, carries an explicit `taxCode` (exemption
  code `AZ_VAT_EXEMPT_GENERAL`) — deliberately distinguishable from
  zero-rated at the API/data level, not just by convention.
- **Out of scope** (`OUT_OF_SCOPE`): a third, separate treatment.

Tax-exclusive and tax-inclusive amounts both go through the same
`TaxCalculationService.calculateLine` — the formula lives in exactly one
place, never duplicated between "add tax" and "extract tax" call sites.

## E. Tax Categories

`STANDARD_VAT`, `ZERO_RATED_EXPORT`, `VAT_EXEMPT`, `OUT_OF_SCOPE` —
assignable to a Product via `ProductTaxProfile` (effective-dated, spec
section 19). No UI/endpoint for managing `ProductTaxProfile` yet in this
build — see Technical Debt.

## F. Registration Model

`TaxRegistration` is effective-dated per organization
(`organizations/:organizationId/tax-registrations`, spec sections 21-23)
— never a single boolean flag. `TaxRegistrationService.resolveActive`
answers "was this organization registered for this tax type on this
date" for a future caller that needs to gate calculation on registration
status (not yet wired into `TaxRuleResolver` itself — see Technical Debt).

## G. Input VAT

`operationType: 'PURCHASE'` produces `recoverableAmount` +
`nonrecoverableAmount` that sum to the total tax (tested). Recoverability
is a caller-supplied percentage (`recoverablePercent`, default 100%)
rather than resolved from a dedicated `TaxRecoverabilityRule` table — see
Technical Debt for why that's deferred.

## H. Output VAT

`operationType: 'SALE'` on a standard/special-rate treatment produces a
`VAT_OUTPUT_PAYABLE`-mapped accounting line. Sales/Purchase modules never
decide the account themselves — always through
`AccountingMappingService.resolve`.

## I. Accounting Mappings

Reuses Accounting Core's `AccountingMapping` (no separate tax-mapping
table — see architecture note in `prisma/schema.prisma`). New mapping
keys: `VAT_INPUT_RECOVERABLE` (→ 241), `VAT_INPUT_PENDING` (→ 226),
`VAT_INPUT_NONRECOVERABLE` (→ 241), `VAT_OUTPUT_PAYABLE` (→ 521),
`VAT_DEPOSIT_ACCOUNT` (→ 226), `VAT_SETTLEMENT` (→ 226), `VAT_ROUNDING`
(→ 731), `VAT_ADJUSTMENT` (→ 731) — all overridable per-organization like
any other mapping, seeded as part of chart adoption
(`ChartOfAccountsService.ensureAdopted`).

## J. Tax Register

`TaxMovement` — immutable once created, one row per taxable line per
posting. `journalEntryId` links each movement to the Journal Entry it was
posted alongside (`TaxRegisterService.linkJournalEntry`, called with the
same transaction as the GL post) — the mandatory summary → TaxMovement →
Journal Entry drilldown (spec section 108) is proven in the atomic
posting test.

## K. Rounding

`TaxRoundingService.round` — `ROUND_HALF_UP` to the given currency
precision (2dp default), the single place every tax amount is rounded.
`reconcile()` exists for document-vs-sum-of-lines reconciliation but the
line-level `roundingAdjustment` field is currently always `0` — no caller
yet exercises a scenario where document-level and summed-line totals
diverge. See Technical Debt.

## L. Reversal / Adjustments

`TaxRegisterService.reverseTaxable` creates a new row per original with
`reversalOfMovementId` set — the original is never deleted or edited.
`taxBalance()` nets a reversal against its original by subtracting it
rather than the schema carrying a signed amount (tested: net-zero after
reversal). A dedicated `TaxAdjustment` model (partial corrections,
discounts-after-invoice, spec sections 45-47) is not implemented — see
Technical Debt.

## M. Permissions

`tax.config.view`, `tax.rule.{view,create,edit,approve,activate}`,
`tax.rate.{view,manage}`, `tax.category.{view,manage}`,
`tax.registration.{view,manage}`, `tax.mapping.{view,manage}`,
`tax.legal_source.{view,manage}`, `tax.calculation.view`,
`tax.register.view`, `tax.override`, `tax.period.{view,manage}` — added
to `permission-codes.ts`, granted to the seeded `TENANT_ADMIN` role.
Several of these (rule create/edit/approve/activate, rate/category
manage, legal source manage, override, period manage) have no backing
endpoint in this build — the permission codes exist per spec section 97,
ready for the endpoints once that admin surface is built.

## N. Audit

`AuditService.record` called for `TAX_CALCULATED` (on every
`registerTaxable`) and `TAX_REVERSED`. Not yet emitted: `TAX_RULE_*`,
`TAX_RATE_*`, `TAX_EXEMPTION_CHANGED`, `TAX_CATEGORY_CHANGED`,
`TAX_MAPPING_CHANGED`, `TAX_POSTED` (folded into `TAX_CALCULATED` since
this build registers and the caller posts GL in the same call),
`TAX_ADJUSTED`, `TAX_OVERRIDE_APPLIED`, `TAX_POSTING_FAILED` — most of
these depend on admin CRUD endpoints or the override feature that don't
exist yet (see Technical Debt). `TAX_REGISTRATION_CHANGED` is emitted by
`TaxRegistrationService.create`.

## O. Tests

`test/tax-engine.e2e-spec.ts` — 18 tests: idempotent localization seed,
standard VAT exclusive/inclusive calculation against configured (not
hardcoded) rates, zero-rated vs exempt vs out-of-scope distinction,
missing-rule and ambiguous-rule detection, legal rule versioning (old
rule wins for an old date, new rule for a new date, changing "now" never
matters), REPEALED-rule exclusion even within its historical window,
partial recoverability, atomic Tax Register + GL posting in one
transaction with drilldown linkage, duplicate-posting rejection,
reversal with net-zero balance, the shared Period Guard blocking a
tax-adjacent posting into a closed period, tax registration effective
dating, and tenant isolation (both rule resolution and Tax Register
visibility). All passing alongside the pre-existing 112 tests (130 total).

## P. Phase 6 readiness

A future Sales module can call `TaxCalculationService.calculateLine` (or
a document-level wrapper around it) purely for preview — it computes and
explains without writing anything, so a Sales Order draft can show "why
this tax" before the user ever saves. Posting only happens when a caller
explicitly invokes `TaxRegisterService.registerTaxable` inside the same
transaction as its `AccountingPostingEngine.postBatch` call — never as a
side effect of calculation.

## Q. Deferred tax functionality

- Only VAT is implemented with real calculation logic. `TaxType` supports
  `CORPORATE_INCOME_TAX`, `WITHHOLDING_TAX`, `SIMPLIFIED_TAX`, `EXCISE`,
  etc. as a concept, but nothing calculates them (spec explicitly scopes
  Phase 5 to "establish the common engine and implement VAT deeply").
- Import/export customs context (spec sections 53-54) — no customs-value
  or declaration fields; export eligibility today is just the
  `ZERO_RATED_EXPORT` category, not a full legal-eligibility check.
- Reverse-charge/self-assessment calculation logic (spec section 55) —
  `taxpayerSide` exists as a context field and a rule condition, but no
  rule actually implements self-assessment behavior yet.
- Tax period locking/filing workflow (spec sections 70-71) — no
  `TaxPeriod` model exists; only the accounting period (Phase 0) gates
  posting.
- E-invoice / government submission integration — explicitly out of
  scope (spec section 141, belongs to Phase 28).

## R. Technical debt

- **Tax rule admin CRUD** (create/edit/approve/activate a custom
  `TaxRule`, manage `TaxRate`/`TaxCategory`/`TaxExemption`/
  `TaxLegalSource`) has no endpoint — the versioning/ambiguity/repealed-
  rule tests write rows directly via Prisma to prove the engine's
  *resolution* logic is correct, but there's no admin surface yet to do
  this through the API.
- **Tax override** (spec sections 76-77) — no endpoint, no `TaxOverride`
  audit trail; `tax.override` permission exists but is unused.
- **Recoverability rules** — `TaxRecoverabilityRule` (effective-dated,
  legally-driven percentage) doesn't exist; recoverability is a
  caller-supplied percentage on each calculation call instead.
- **`ProductTaxProfile`/`CounterpartyTaxProfile` have no endpoints** —
  the schema exists (spec sections 19-20) but nothing creates or reads
  them yet; a future Sales integration would need to resolve a product's
  `taxCategoryCode` from here rather than the caller passing it directly
  (as the test suite does).
- **`TaxRegistration` isn't consulted by `TaxRuleResolver`** — spec
  section 22 implies registration status should be able to affect rule
  applicability; today the resolver only looks at
  `taxCategoryCode`/`operationType`/`taxpayerSide`.
- **Rounding reconciliation** — `TaxRoundingService.reconcile()` exists
  but nothing calls it yet; `roundingAdjustment` on `TaxLineResult` is
  always zero in this build.
- **Concurrent duplicate-posting race test** (mirrors the same deferred
  item in Accounting Core) — the duplicate check exists, no test forces
  two simultaneous calls.
- **Sales/Purchase integration** — this build does not touch
  `sales-documents`; wiring real Sales Orders/Invoices through
  `TaxCalculationService` + `TaxRegisterService` + `AccountingPostingEngine`
  is the next, separate step.
