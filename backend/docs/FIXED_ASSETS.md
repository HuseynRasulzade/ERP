# Fixed Asset Subledger (docx spec Phase 16)

Module: `src/fixed-assets/`. Builds on Phase 0 (numbering, audit, period
control), Phase 1 (department/warehouse-as-location/responsible person),
Phase 4 (chart of accounts, posting engine), and Phase 9 (Purchase
Invoice — as a traceability source only, never modified). Acquisition
Candidate → CIP → Fixed Asset Card → Acceptance/Commissioning →
Depreciation → Transfer/Modernization/Impairment → Disposal, all
traceable back to source documents.

## A. Core architectural separation (spec section 3)

Five concepts kept deliberately distinct, never collapsed into one status
field:

- **Acquisition Candidate** — a cost that MIGHT become a fixed asset.
  Never auto-converted (spec section 5/167).
- **CIP / Capital Investment Project** — an in-progress capital project
  accumulating cost before any asset exists.
- **Fixed Asset Card** — a recognized, registered asset.
- **Acceptance** — legal/accounting recognition into the register.
- **Commissioning** — the asset is actually put into use; depreciation
  eligibility begins only here (spec section 19 — acceptance and
  commissioning are never the same event).

## B. The book value is always live, never a mutable field (spec section 26)

`FixedAssetBalanceService.getBalances(tenantId, assetId, asOfDate)` reads
`RegisterMovement` rows under `FIXED_ASSET_MOVEMENT_REGISTER` and derives
gross cost, accumulated depreciation, accumulated impairment, and Net
Book Value — the fourth reuse of this codebase's Truth Engine principle
(Stock → Cash → Bank → now Fixed Assets). `FixedAsset` has no
`accumulated_depreciation`/`carrying_amount` columns at all;
`initialCost` is a display convenience only, never read back as
authoritative. CIP projects get the same treatment
(`getCipBalance`), dimensioned by `cipProjectId` instead of `assetId` on
the same register.

## C. Acquisition Candidate → classification (spec sections 4-7)

`FixedAssetAcquisitionCandidateService.classify()` is the ONE human
decision point, with four outcomes: `EXPENSE` (tags the candidate, no
asset), `ASSIGN_TO_CIP` (adds a `CapitalInvestmentCost` row + a CIP
register movement), `CAPITALIZE` (creates a brand-new `FixedAsset`
directly), `ASSIGN_TO_ASSET` (adds cost to an existing asset). A
candidate is created purely for traceability via an explicit API call
referencing a source document — never automatically spawned by Purchase
Invoice posting.

**Disclosed simplification**: this build does not extend Phase 9's
`PurchaseInvoicePostingHandler` with a `FIXED_ASSET` line type that would
post straight to CIP/FA-clearing instead of a normal expense/inventory
account (a stable, heavily-tested surface this build deliberately does
not touch). Consequently `CAPITALIZE`/`ASSIGN_TO_CIP` post their own
self-contained GL event (Dr CIP-or-Fixed-Asset-Cost / Cr Supplier
Payable when a supplier is set, else a neutral Other-Operating-Income
wash) rather than reclassifying an already-posted Purchase Invoice line
— a real source document's own payable and this event's own contra both
exist and must be reconciled manually until that Phase 9 extension
lands.

## D. CIP cost formation and capitalization (spec sections 8-13, 88-90)

`CapitalInvestmentProject` accumulates `CapitalInvestmentCost` rows from
however many candidates are assigned to it (one CIP ← many sources, spec
section 12). `capitalize()` reclassifies some or all of the accumulated
balance into a brand-new `FixedAsset` — Dr Fixed Asset Cost / Cr CIP,
repeatable for one-CIP-to-many-assets (spec section 13). Over-capitalizing
past the remaining CIP balance is rejected with the exact error shape the
spec's own example gives (section 145).

**Concurrency-safe capitalization**: `capitalize()` acquires an advisory
lock on `tenantId:cipProjectId` (`FixedAssetBalanceService.lockCip`)
*before* reading the remaining balance, inside the same transaction that
then writes the capitalization — the same advisory-lock-lifecycle lesson
this codebase already learned (and fixed) for bank-statement matching
(Phase 14) and cash-desk negative-balance control (Phase 15). Caught and
fixed during this build's own test writing, before it ever shipped.

## E. Depreciation engine (spec sections 21-38)

Straight-line only (spec section 21's own minimum); `depreciationMethod`
is a free string, not an enum, so `DECLINING_BALANCE`/`UNITS_OF_PRODUCTION`
etc. are schema-ready but not implemented. A single `ACCOUNTING_BOOK`
valuation book; `TAX_BOOK`/`MANAGEMENT_BOOK` are schema-ready
(`FixedAssetDepreciationRun.valuationBook` is a free string) but not
built (spec sections 23-24, 101-102 — full localization tax depreciation
is later-phase scope).

The rate is recomputed **fresh every period** from the asset's live NBV
— never cached — which is what makes impairment/useful-life-change
prospective recalculation and final-period true-up all fall out of the
SAME formula rather than needing separate special-case code:

```
checkpoint      = latest FixedAssetPolicyChange.effectiveDate, else depreciationStartDate
remainingMonths = usefulLifeMonths (current) - (POSTED periods already run since checkpoint's month)
openingNbv      = live NBV as of (period start - 1 day)
depreciableNow  = openingNbv - residualValue (current)
periodAmount    = min(depreciableNow / remainingMonths, depreciableNow), clamped >= 0
```

`remainingMonths <= 0` or `depreciableNow <= 0` yields zero — the asset
stays `ACTIVE`, never auto-disposed (spec sections 96-97, tested).
Idempotent per `(organization, period, valuationBook)` — a unique DB
constraint on `FixedAssetDepreciationRun` plus
`AccountingPostingEngine.postBatch`'s own per-`sourceDocumentId`
duplicate guard both block a double-post (spec section 33, tested).

## F. Effective-dated parameter history (spec sections 35-37, 41-44)

Two append-only tables, never overwriting history:

- `FixedAssetTransfer` — department/location/responsible-person changes.
- `FixedAssetPolicyChange` — useful life / residual value / method
  changes, always prospective (spec section 35: past periods are never
  rewritten).

`FixedAsset`'s own department/location/responsible/usefulLifeMonths/
residualValue fields are kept as **current-state projections** the same
way `CashDeskTransfer.transferState` etc. are — the history tables are
authoritative for "what was true as of a given date," the live fields
are authoritative for "what's true now."

## G. Modernization, Impairment, Disposal — document-framework participants

All three are full `DocumentPostingHandler` participants (post/unpost,
period locking, audit), same as every other GL-posting document in this
codebase:

- **Modernization** (spec sections 45-49): Dr Fixed Asset Cost / Cr a
  neutral Other-Operating-Income wash — disclosed simplification: this
  build does not link modernization funding to a supplier payable; use
  the acquisition-candidate `ASSIGN_TO_ASSET` path instead when a real
  supplier invoice funds the work. Useful-life/residual changes are kept
  OUT of this document (call `changeUsefulLife` separately) so unposting
  a modernization never has to also unwind a prospective policy
  checkpoint.
- **Impairment** (spec sections 52-56): Dr Impairment Loss (731) / Cr
  Accumulated Depreciation (112 — the AZ chart's own combined
  depreciation+impairment line). `REVERSAL` posts the opposite direction,
  capped at the asset's live accumulated-impairment balance (spec section
  56: "never exceed"). Future depreciation recalculates automatically
  next run since the engine always reads live NBV — no separate hook
  needed.
- **Disposal** (spec sections 65-74): removes gross cost + accumulated
  depreciation + impairment from the register and recognizes gain/loss.
  `SALE` with `proceeds > 0` requires a `buyerId`, posted as a
  `CUSTOMER_RECEIVABLE` (211, with `PARTNER`/`COUNTERPARTY`/
  `SETTLEMENT_DOCUMENT`/`CURRENCY` dimensions) — this build does not
  model where proceeds physically land (cash/bank); record a separate
  `CashTransaction`/`IncomingBankPayment` for the actual settlement.
  `sourceSalesInvoiceId` is stored for traceability only, not verified
  against or reconciled with that invoice's own GL (spec section 68:
  "link, don't duplicate"). Partial disposal/component replacement (spec
  sections 71-72, 38-40) are **not built** — only full disposal.

**A real bug this build's own tests caught, fixed before it ever
shipped**: `FixedAssetDisposalPostingHandler.buildAccountingBatch()`
originally re-read live balances via `getBalances()` *after*
`buildMovements()` had already written this same document's own
cost-removal movement to the register (same transaction, movements
written first per the document-framework's own step order) — so the
"current" balance it saw was the *post*-decrease value, and the GL credit
for cost removal was skipped almost entirely. Fixed by adding an
`excludeRecorder` parameter to `getBalances()` that filters out a
document's own not-yet-finalized movements, so `buildAccountingBatch`
sees the same pre-posting state `buildMovements` did.

## H. Physical inventory (spec sections 59-64)

`FixedAssetInventoryCount` mirrors Phase 15's `CashPhysicalCount` session
pattern exactly. `WRONG_LOCATION`/`WRONG_RESPONSIBLE_PERSON` results
auto-create a `FixedAssetTransfer` correction on `submitResults` (spec
section 62: "create transfer correction instead of write-off") since
that carries no financial consequence. `MISSING`/`DAMAGED`/
`UNREGISTERED_ASSET` are deliberately **not** auto-resolved (spec
sections 63-64: no automatic write-off, no automatic asset-card
creation) — they stay `OPEN` until a human creates the follow-up
`FixedAssetDisposal`/`FixedAsset` document explicitly.

## I. Opening balances / migration (spec sections 76-77)

`FixedAssetService.createOpeningBalance()` creates an asset already
`ACTIVE` with `commissioningDate`/`depreciationStartDate` = the opening
date, seeds the register with an `OPENING_BALANCE` movement (cost +
accumulated depreciation + impairment in one shot), but deliberately does
**not** post GL — a migrated opening balance is assumed to already be
part of the tenant's own opening trial balance (the same convention
Accounting Core's own opening-balance docs use).

## J. Reconciliation and health

`FixedAssetReconciliationService.reconcileAll()` — FA Subledger (the
register-derived org-wide total) vs FA GL Accounts for the three accounts
the spec explicitly calls out (Gross Cost, Accumulated Depreciation +
Impairment, CIP), the same book-vs-GL principle every other
`*HealthService` in this codebase already uses, aggregated per
organization instead of per document.

`FixedAssetHealthService.check()` — stale unclassified candidates, stale
CIP projects, CIP residual after closure, accepted-but-not-commissioned
too long, missing responsible person/location on an active asset,
negative NBV, disposed asset with a residual subledger balance, and
unresolved inventory-count results. A practical subset of the spec's own
15-item checklist (section 123) — full coverage (including a dedicated
componentization/revaluation health surface) is a later Phase 30 health
engine's job.

## K. Disclosed simplifications

- **No Purchase Invoice → Acquisition Candidate auto-wiring** — see
  section C.
- **No cost/receivable link into a real Sales Invoice for a disposal
  sale** — see section G.
- **Straight-line depreciation only** — schema-ready for other methods,
  not implemented (spec section 21's own minimum).
- **Single valuation book** — `TAX_BOOK`/`MANAGEMENT_BOOK` schema-ready,
  not built (spec sections 23-24).
- **No componentization** (spec sections 38-40) — `FixedAsset.parentAssetId`
  exists in the schema for a future build, but component-level separate
  depreciation schedules and component replacement are not implemented.
- **No revaluation model** (spec sections 57-58) — `FixedAssetCategory.
  revaluationModel` is schema-ready (`COST_MODEL` default), no
  revaluation document/flow built.
- **No partial disposal / component replacement** — only full disposal
  (`SALE`/`WRITE_OFF`/`SCRAP`/`DONATION`/`LOSS`/`THEFT`).
- **No suspension/conservation document** (spec section 51) — asset
  status includes `SUSPENDED`/`CONSERVED` in the enum but no dedicated
  document transitions into/out of it yet.
- **No segregation-of-duties enforcement** (spec section 127) — same
  disclosed gap every other module in this codebase has; permission
  gating exists, creator≠approver is not enforced.
- **Health/reconciliation cover a practical subset**, not the spec's
  full checklist — see sections I/J.

## L. API surface

```
GET/POST   /fixed-asset-categories[/:id/deactivate]
GET/POST   /organizations/:orgId/fixed-assets/acquisition-candidates[/:id/classify]
GET/POST   /organizations/:orgId/fixed-assets/cip[/:id/activate|/:id/suspend|/:id/mark-ready|/:id/capitalize|/:id/balance]
GET/POST   /organizations/:orgId/fixed-assets[/:id/accept|/:id/commission|/:id/transfer|/:id/change-useful-life]
POST       /organizations/:orgId/fixed-assets/opening-balances
GET/POST   /organizations/:orgId/fixed-assets/depreciation-runs[/calculate|/:id/post]
GET/POST   /organizations/:orgId/fixed-assets/modernizations
GET/POST   /organizations/:orgId/fixed-assets/impairments
GET/POST   /organizations/:orgId/fixed-assets/disposals
GET/POST   /organizations/:orgId/fixed-assets/inventory-counts[/:id/submit|/:id/approve]
GET        /organizations/:orgId/fixed-assets/reconciliation
GET        /organizations/:orgId/fixed-assets/health
GET        /organizations/:orgId/fixed-assets/reports/{register|depreciation-schedule|fully-depreciated-active|not-commissioned}
POST       /documents/FIXED_ASSET_MODERNIZATION|FIXED_ASSET_IMPAIRMENT|FIXED_ASSET_DISPOSAL/:id/{post|unpost|cancel}  (generic)
```

## M. Tests

`test/fixed-assets.e2e-spec.ts` (new, 17 tests): acquisition-candidate
classification (`CAPITALIZE` creates an asset, `EXPENSE` never does), CIP
cost formation across multiple sources with one expensed exclusion +
capitalization into one asset, over-capitalization rejection, CIP
capitalization concurrency safety, acceptance-without-commissioning
staying depreciation-free, straight-line depreciation (zero residual,
non-zero residual, idempotency), modernization increasing gross cost,
impairment reducing NBV to the recoverable amount, transfer leaving
cost/NBV unchanged, disposal (SALE with gain/loss + receivable, WRITE_OFF
with a full loss and no further depreciation), physical inventory
(wrong-location auto-correction, missing-asset staying unresolved), and
GL reconciliation reporting every tracked account healthy after a full
mixed flow (the single most valuable test in the suite — it's what
caught the disposal double-read bug in section G above).
