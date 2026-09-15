# Fixed Assets / Əsas Vəsaitlər (docx spec Phase 16)

```
Acquisition Candidate (never auto-creates an asset)
  --classify--> CAPITALIZABLE|EXPENSE|ASSIGNED_TO_CIP|ASSIGNED_TO_ASSET|CANCELLED

CapitalInvestmentProject (CIP)
  --addCostLine (x N sources)--> CapitalInvestmentCostLine (dimensioned register)
  --markReadyForCapitalization / close (blocked if uncapitalized residual)-->

FixedAssetCapitalizationService.capitalize
  --> FixedAsset (status ACQUISITION) + FixedAssetCapitalization (DRAFT)
  --POST (DocumentPostingService)--> INITIAL_RECOGNITION movement, status ACCEPTED

FixedAssetCommissioningService.commission
  --> status ACTIVE, commissioningDate, usefulLife/method/residual frozen

FixedAssetDepreciationService (month-close entry point, spec section 93)
  .preview / .calculate --> FixedAssetDepreciationRun + one Entry per asset
  .post --> DEPRECIATION movements + one consolidated GL batch
  .reverse --> period reopen path

FixedAssetTransfer / Modernization / Impairment / Revaluation / Disposal
  (each its own DocumentFramework document, posted through the shared
  DocumentPostingService, each writing its own FixedAssetMovement type)

FixedAssetMovement (the ONLY authoritative subledger — spec section 26)
```

## A. FixedAssetMovement is authoritative, FixedAsset's totals are a projection

`FixedAsset.initialCost/accumulatedDepreciation/impairmentBalance/revaluationBalance/carryingAmount`
are maintained by `FixedAssetMovementService.record`/`.reverse` alongside
every movement write — never set directly by any other service (the one
exception, `FixedAssetOpeningBalanceService`, still routes the actual
number through a movement, only defaulting the column to `'0'` at
`create` time). `FixedAssetMovementService.recomputeFromMovements` can
always rebuild the same four numbers purely from movement history — the
same "rebuildable projection" convention as every other subledger in this
codebase (Inventory Costing, Settlement, Treasury, Cash).

## B. Acceptance folded into capitalization (disclosed simplification)

The spec lists Acceptance (`FixedAssetAcceptance`) as its own document
(spec section 17). This build folds it into
`FixedAssetCapitalizationPostingHandler` — posting the capitalization
document both recognizes the cost AND flips the asset to `ACCEPTED` in
one step, rather than a separate acceptance approval document. Acceptance
and Commissioning remain two distinct EVENTS (spec section 19's own
worked example) — commissioning is still its own later call, with its own
depreciation-eligibility consequence — only the acceptance-approval
document itself was not built standalone.

## C. Direct capitalization posts no automatic GL (double-booking risk)

`FixedAssetCapitalizationPostingHandler` only builds a real GL batch when
`cipProjectId` is set (Dr FIXED_ASSET_COST / Cr FIXED_ASSET_CIP — the
CIP's own cost lines were already posted to the CIP account by whichever
module fed them). For direct capitalization (no CIP), the source Purchase
Invoice/Goods Receipt already posted ITS OWN GL treatment for the
acquisition; re-deriving and re-crediting an AP/expense account here
would double-book it. This build posts no automatic GL entry for direct
capitalization — only the FixedAssetMovement (subledger) records
INITIAL_RECOGNITION, so the asset register and reporting are correct
immediately; the GL side needs a manual journal entry today. The exact
same reasoning is applied to `FixedAssetModernizationPostingHandler` —
modernization cost is very often already posted by an incoming invoice
elsewhere, so it never auto-books GL either, only the subledger movement.
Impairment, Revaluation, and Disposal are NOT subject to this — they are
each the sole originating document for their own GL effect, so they post
full, real journal entries.

## D. Only STRAIGHT_LINE is computed; only ACCOUNTING_BOOK is computed

Spec section 21 only requires Straight-Line to be fully working in this
phase; other `depreciationMethod` values are valid enum values on
`FixedAsset` (schema is ready) but `FixedAssetDepreciationService`
produces an `UNSUPPORTED_METHOD` depreciation-error entry instead of a
silently wrong number if one is ever set. Likewise `valuationBook` is a
real column on `FixedAssetMovement`/`FixedAssetDepreciationRun`
(`ACCOUNTING_BOOK`/`TAX_BOOK`/`MANAGEMENT_BOOK`) but only
`ACCOUNTING_BOOK` is ever computed or posted — no `FixedAssetBookValue`
per-book parameter table exists yet (spec section 24's own "schema
multi-book-a mane olmamalıdır", satisfied by the column existing, not by
a second book actually running).

## E. Depreciation start rule and final-period true-up

`depreciationStartRule` (`FROM_COMMISSIONING_DATE`/`NEXT_DAY`/`NEXT_MONTH`/
`FIRST_DAY_NEXT_MONTH`) gates whether an asset is eligible for a given
calendar period (spec section 20) — never a hardcoded "always next
month". The last month of an asset's useful life absorbs whatever
remainder is left between the opening NBV and the residual value (spec
section 98's "final-period true-up") rather than posting one more full
monthly instalment and drifting past residual value.

## F. Depreciation errors block posting, never silently skip

`FixedAssetDepreciationService.calculate` tags every ineligible asset
with an `errorCode` (`MISSING_USEFUL_LIFE`, `MISSING_COMMISSIONING_DATE`,
`INVALID_RESIDUAL_VALUE`, `UNSUPPORTED_METHOD`,
`DISPOSED_ASSET_STILL_DEPRECIATING`, `NEGATIVE_NBV`) rather than omitting
the asset from the run. `.post` refuses to post the WHOLE run while ANY
entry still carries an error (spec section 93's "Month Close cannot
finalize if blocking depreciation errors exist") — the caller must fix
the asset and recalculate, not partially post around the error.

## G. Disposal: proportional partial disposal, gain/loss, never a duplicate sales engine

`FixedAssetDisposal.disposalShare` (1 = full, <1 = a PROPORTIONAL_COST
partial disposal, spec section 72) scales gross cost/accumulated
depreciation/impairment/revaluation removed pro-rata. `proceeds` is
recognized directly on the disposal document — `salesInvoiceId` is only a
traceability link (spec section 68's "don't duplicate the sales invoice
engine"), never a second posting of that invoice's own amount.

## H. Disclosed simplifications / Phase 16 boundaries

- No `FixedAssetAcceptance` standalone document (folded into
  capitalization, see section B).
- No automatic GL for direct capitalization or modernization cost (see
  section C) — a manual journal entry is expected alongside them today.
- Only STRAIGHT_LINE depreciation and only ACCOUNTING_BOOK are computed
  (see section D); DECLINING_BALANCE/DOUBLE_DECLINING/
  SUM_OF_YEARS_DIGITS/UNITS_OF_PRODUCTION/MANUAL/TAX_METHOD are valid
  enum values with no calculation implementation yet.
- No separate effective-dated parameter-history table (spec section 137)
  — useful life/residual value/method/department/location/responsible
  changes are prospective mutations of `FixedAsset`'s own columns, with
  the change itself audited (old/new values in the audit log) but not
  queryable as its own "history as of date X" table.
- Impairment reversal (spec section 56) is capped at "never exceed the
  current impairment balance" — the fuller "never exceed what carrying
  amount would have been without the original impairment" ceiling is not
  computed (would require tracking a hypothetical depreciation schedule).
- Revaluation posting always uses a simplified COST_MODEL-compatible
  Dr/Cr Fixed-Asset/Revaluation-Surplus treatment regardless of
  `FixedAssetCategory.revaluationModel` — full OCI/equity-reserve
  mechanics for `REVALUATION_MODEL` categories are not built (schema
  field exists for a future pass).
- `FixedAssetInventoryService` never auto-resolves MISSING/
  UNREGISTERED_ASSET results (spec sections 63-64's own explicit
  prohibitions) — resolution is a separate, human-triggered
  `FixedAssetTransfer`/`FixedAssetDisposal`/manual asset creation, not
  wired as an automatic follow-up action from the count line itself.
- `locationId` throughout (CIP, FixedAsset, transfers, inventory lines)
  is a soft string reference — no dedicated Location master-data model
  exists in this codebase yet (Warehouse/WarehouseLocation are
  structurally different concepts from a Phase-16 "physical site").
- `FixedAssetReconciliationService`'s GL-account cross-check (spec
  section 124's "FA Cost Subledger vs FA Cost GL Accounts") only compares
  the subledger's own movement aggregate against `FixedAsset`'s stored
  projection — a real trial-balance-vs-subledger check against
  `AccountingPostingEngine`'s ledger is left to Phase 30's general health
  engine, per the spec's own note at section 124.
- Segregation-of-duties (spec section 127) is not enforced structurally
  (no separate reviewer-vs-approver role split) — left to RBAC
  configuration outside this build.

## I. Permissions

`FIXED_ASSET_VIEW`, `_VIEW_COST`, `_CREATE`, `_ACCEPT`, `_COMMISSION`,
`_TRANSFER`, `_MODERNIZE`, `_CHANGE_USEFUL_LIFE`,
`_DEPRECIATION_CALCULATE`, `_DEPRECIATION_POST`, `_IMPAIR`, `_REVALUE`,
`_INVENTORY`, `_DISPOSE`, `_WRITE_OFF`, `_MANUAL_ADJUSTMENT`,
`_VIEW_ACCOUNTING`, `_PERIOD_OVERRIDE` — see `rbac/permission-codes.ts`.
