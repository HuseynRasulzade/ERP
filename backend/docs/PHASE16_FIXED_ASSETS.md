# Phase 16 — Fixed Assets / Əsas vəsaitlər

Module: `src/fixed-assets/`. Migration: `prisma/migrations/20261016000000_phase16_fixed_assets`.
Tests: `test/phase16-fixed-assets.e2e-spec.ts` (16 scenarios).

## What was built

A fixed-asset subledger, asset lifecycle and depreciation engine. An asset's value is
not stored in one editable field. Every value comes from the append-only `FixedAssetMovement`
register.

```
Purchase Invoice (FIXED_ASSET line) / manual source
  -> FixedAssetAcquisitionCandidate (never an asset by itself)
  -> classify: CAPITALIZE | EXPENSE | SPLIT | ASSIGN_TO_CIP | ASSIGN_TO_ASSET
  -> CapitalInvestmentProject + CapitalInvestmentCost register (CIP)
  -> asset card(s) in ACQUISITION with FixedAssetCostComponent traceability
  -> FA_ACCEPTANCE   (INITIAL_RECOGNITION movement, Dr FA_COST / Cr FA_CIP)
  -> FA_COMMISSIONING (book policy frozen, depreciation eligibility starts)
  -> depreciation runs (Dr expense by department / expense type, Cr accumulated depreciation)
  -> transfer / modernization / repair / impairment / revaluation / status change
  -> FA_DISPOSAL (sale, write-off, scrap, loss, partial, component replacement)
```

### Domain services (spec section 139)

| Service | File |
|---|---|
| FixedAssetAcquisitionService | `fixed-asset-acquisition.service.ts` |
| CapitalInvestmentService | `capital-investment.service.ts` |
| FixedAssetCapitalizationService | `fixed-asset-capitalization.service.ts` |
| FixedAssetService (card, scanner lookup, drill-down) | `fixed-asset.service.ts` |
| FixedAssetAcceptanceService (+ opening balances) | `fixed-asset-acceptance.service.ts` |
| FixedAssetCommissioningService (+ parameter change, suspension / conservation / held for sale) | `fixed-asset-commissioning.service.ts` |
| DepreciationPolicyService | `depreciation-policy.service.ts` |
| FixedAssetDepreciationService | `fixed-asset-depreciation.service.ts` |
| Depreciation strategies (StraightLine, DecliningBalance, DoubleDeclining, SumOfYearsDigits; placeholders for UnitsOfProduction, Manual, TaxMethod) | `depreciation/` |
| FixedAssetComponentService | `fixed-asset-component.service.ts` |
| FixedAssetTransferService | `fixed-asset-transfer.service.ts` |
| FixedAssetModernizationService (+ repair vs capital improvement) | `fixed-asset-modernization.service.ts` |
| FixedAssetImpairmentService | `fixed-asset-impairment.service.ts` |
| FixedAssetRevaluationService | `fixed-asset-revaluation.service.ts` |
| FixedAssetInventoryService | `fixed-asset-inventory.service.ts` |
| FixedAssetDisposalService | `fixed-asset-disposal.service.ts` |
| FixedAssetReconciliationService (`reconcileCostAccounts`, `reconcileAccumulatedDepreciation`, `reconcileCIP`, `reconcileAssetStatus`, `validateDisposals`) | `fixed-asset-reconciliation.service.ts` |
| FixedAssetReportingService (reports 114-123, health) | `fixed-asset-reporting.service.ts` |
| FixedAssetsIntegrationService (internal API for other phases, section 144) | `fixed-assets-integration.service.ts` |
| Shared infrastructure: ledger, history, lifecycle documents and reversal, accounting gateway | `fixed-asset-ledger.service.ts`, `fixed-asset-history.service.ts`, `fixed-asset-document.service.ts`, `fixed-asset-accounting.service.ts` |

### Tables

`fixed_asset_categories`, `fixed_asset_policies`, `fixed_asset_locations`,
`fixed_asset_acquisition_candidates`, `capital_investment_projects`, `capital_investment_costs`,
`fixed_assets`, `fixed_asset_cost_components`, `fixed_asset_book_policies`,
`fixed_asset_assignments`, `fixed_asset_parameter_history`, `fixed_asset_movements`,
`fixed_asset_documents`, `fixed_asset_document_lines`, `fixed_asset_depreciation_runs`,
`fixed_asset_depreciation_lines`, `fixed_asset_depreciation_periods`,
`fixed_asset_inventory_counts`, `fixed_asset_inventory_results`.

Master data (organization, department, responsible person, counterparty, account) is
referenced by plain id columns and checked in the services. No back-relation was added to
any existing model, so this block merges cleanly. There was no generic Location master in
Phase 1, so a small `fixed_asset_locations` catalog was added.

## Key design decisions

1. **The register is the authority (sections 25-27).** `FixedAssetMovement` holds cost,
   depreciation, impairment and revaluation increases and decreases. `FixedAsset.initialCost`,
   `accumulatedDepreciation` and `carryingAmount` are projections that are refreshed after
   every movement. All reports and as-of balances read the register.
2. **One lifecycle-document table.** `FixedAssetDocument` and `FixedAssetDocumentLine` hold
   acceptance, commissioning, parameter change, transfer, modernization, repair, status change,
   impairment, impairment reversal, revaluation, disposal and opening balance.
   `documentType` tells them apart. Each line stores typed before and after values: cost,
   depreciation, NBV, useful life, residual, method, status, and from/to
   department / location / responsible person. The 1C-style "recorder" pattern is kept, and
   one table replaces twelve near-identical ones.
3. **Posting does not use the generic DocumentPostingService.** Generic unpost deletes GL
   movements, but the spec forbids physically deleting posted fixed-asset operations
   (sections 132 and 167). FA operations therefore post directly through
   `AccountingPostingEngine.postBatch` inside their own transaction and still use
   `PeriodService.assertDateIsOpen`. They are reversed by one dependency-safe path:
   - check that the period is open;
   - check that the document is still the latest active operation on every asset it touched;
   - run the type-specific undo hook;
   - write compensating movements;
   - post a reversing Journal Entry with `AccountingPostingEngine.reverse`;
   - mark the document CANCELLED and stamp `reversedAt`.

   Example: *"Commissioning FAK-2026-000001 cannot be reversed because depreciation has
   already been posted for April 2026."* Journal entries keep
   `sourceDocumentType` / `sourceDocumentId`, so the existing "accounting entries" viewer works.
4. **Semantic GL mappings only (sections 30, 86).** New mapping keys are `FA_COST` (111),
   `FA_CIP` (113), `FA_ACCUMULATED_DEPRECIATION` and `FA_ACCUMULATED_IMPAIRMENT` (112),
   and `FA_DEPRECIATION_EXPENSE[_SALES|_PRODUCTION|_OTHER]` (721 / 711 / 202 / 731).
   There are also keys for impairment loss and reversal, the revaluation reserve and loss,
   disposal gain, loss and proceeds (217 clearing), non-capitalizable and repair expense,
   and the opening-balance offset (343).
   - A category's `accountingMappingProfile` lets a tenant add `FA_COST:BUILDINGS` and similar
     rows. Resolution falls back to the plain key.
   - Existing tenants get the default rows automatically the first time they use the module
     (`FixedAssetAccountingService.ensureSetup`).
   - The new accounting dimension `FIXED_ASSET` is written on the cost and accumulated lines.
     The expense lines carry `DEPARTMENT`.
5. **Acquisition clearing.** A posted Purchase Invoice `FIXED_ASSET` line without an explicit
   `expenseAccountId` is now debited to `FA_CIP`. Before this phase it went to admin expense.
   It creates exactly one candidate per line, keyed by
   `PURCHASE_INVOICE:<id>:<lineId>` (section 129):
   - the capitalizable amount is the net amount; recoverable VAT is never added;
   - unposting the invoice withdraws unprocessed candidates, and is refused once a candidate
     has been decided on.

   The CIP GL balance is reconciled against three things: unprocessed candidates, the CIP
   register, and formed but not yet accepted cost components.
6. **Effective-dated parameters (sections 35-37, 137).**
   - `FixedAssetBookPolicy` versions store `remainingLifeMonths` as of their effective period,
     so commissioning, useful-life changes, modernization and opening balances all work the
     same way. Past periods are never touched.
   - A change that lands in an already-depreciated period is refused.
   - `FixedAssetAssignment` keeps department, location, responsible person, cost center and
     expense-type history.
   - `FixedAssetParameterHistory` logs every old and new value.
7. **Prospective straight line (sections 22, 55, 98).**
   - Formula: `(carrying amount - residual) / remaining periods`, rounded to the policy
     precision. The final period takes up any rounding difference.
   - Without later changes this equals `(cost - residual) / life`, e.g. 115,000 / 60 = 1,916.67.
   - After an impairment or modernization the new basis is spread over the remaining life
     automatically.
   - The depreciation start rule and the partial-period rule (FULL_MONTH, DAILY_PRORATA using
     actual calendar days, HALF_MONTH, LOCALIZATION_RULE) are configurable per policy or
     category.
8. **Idempotency and concurrency (sections 129-131).**
   - Depreciation lines carry a UNIQUE `postedKey` (`asset:book:period`) while posted, and runs
     are versioned.
   - The period row (`fixed_asset_depreciation_periods`) is locked FOR UPDATE while a run is
     posted or reversed.
   - Re-posting a POSTED run is a no-op.
   - A line whose asset changed after calculation is refused as stale.
   - Candidates, CIP projects and assets are locked FOR UPDATE and their status is re-checked
     inside the transaction.
   - An optional `Idempotency-Key` header (existing `IdempotencyService`) is accepted on the
     create-assets, CIP capitalize, accept, modernize, dispose and opening-balance commands.
9. **Multi-book.** Cost movements are shared (ACCOUNTING_BOOK). Depreciation and impairment are
   book-specific. A TAX_BOOK policy can be given at commissioning, and a TAX_BOOK run writes
   subledger movements only (no GL). The book-tax difference report compares accounting and
   tax NBV.
10. **Events (section 138).** Domain events are recorded as audit events with the spec's names:
    `FixedAssetCandidateCreated`, `CapitalInvestmentCostAdded`, `FixedAssetAccepted`,
    `FixedAssetCommissioned`, `FixedAssetDepreciationCalculated`, `FixedAssetDepreciationPosted`,
    `FixedAssetTransferred`, `FixedAssetModernized`, `FixedAssetImpaired`, `FixedAssetRevalued`,
    `FixedAssetInventoryDifferenceDetected`, `FixedAssetDisposed`, `FixedAssetWrittenOff`.
    They are written in the same transaction as the operation. There is no separate event bus
    in the platform yet.

## API (all under `organizations/:organizationId/`)

- `fixed-assets`: GET (list), POST (manual card), GET `lookup?code=` (scanner), GET/PATCH `:id`,
  and POST `:id/{accept, commission, change-parameters, status, transfer, modernization/start,
  modernize, repairs, impair, impairment-reversal, revalue, disposal-preview, dispose,
  withdraw-capitalization, components/replace}`. Also POST `transfer` (bulk) and
  POST `opening-balances`.
- `fixed-assets/acquisition-candidates`: GET, POST (manual, with offset account),
  GET `:id`, POST `:id/classify`, POST `create-assets`.
- `fixed-assets/cip`: GET, POST, GET `:id`, and POST `:id/{status, capitalize, expense, close}`.
- `fixed-assets/depreciation`: GET `preview`, `status`, `runs`, `runs/:id`, `close-validation`;
  POST `calculate`, `post`, `runs/:id/reverse`, `finalize`, `reopen`.
- `fixed-assets/inventory-counts`: GET, POST, GET `:id`, and POST `:id/{scan, complete}`
  and `results/:id/resolve`.
- `fixed-assets/documents`: GET, GET `:id`, POST `:id/reverse`.
- `fixed-assets/reports/`: `register`, `depreciation-schedule`, `movements`, `cip`,
  `fully-depreciated`, `not-commissioned`, `inventory-differences`, `modernizations`,
  `disposals`, `book-tax-difference`, `reconciliation`, `health`.
- Tenant level: `fixed-asset-settings/{categories, policies, methods}`.
  Organization level: `organizations/:organizationId/fixed-asset-locations`.

**Permissions:** all 18 spec codes plus `fixed_asset.settings.manage`, following the
`fixed_asset.*` pattern. They are seeded to TENANT_ADMIN and to the ACCOUNTING_USER demo role.
Money fields are removed from card and list responses for callers without
`fixed_asset.view_cost`. Write-off, scrap, loss and theft need `fixed_asset.write_off`;
the other disposal types need `fixed_asset.dispose`.

## Deferred / simplified (documented)

- **Frontend:** not delivered in this phase (time budget). The backend API above is complete;
  pages still to build are the asset list and card tabs, the acquisition workbench, CIP,
  the depreciation workbench, inventory scanning and reports.
- **Sales integration:** a sale disposal links a Sales Invoice by id and posts proceeds to the
  `FA_DISPOSAL_PROCEEDS` clearing account (217). The sales invoice for the asset has to credit
  that same clearing account so the two net out. Automatic wiring of Sales Invoice lines is
  deferred.
- **Disposal costs** are reported (gain/loss after costs) but recognized by their own source
  documents, never netted silently.
- **Scrap value** requires a source document reference and is not posted by the FA module
  (Phase 10 receipt).
- **Impairment reversal cap:** "carrying amount without impairment" is approximated as
  cost + revaluation − recorded accumulated depreciation.
- **Revaluation** is a foundation only: it covers the delta against the reserve or loss. There
  is no proportional restatement of accumulated depreciation and no transfer of the reserve on
  disposal.
- **Missing assets:** the resolutions employee receivable, loss expense and legal investigation
  only record the decision. Financial settlement belongs to Phase 17-19 or to an explicit
  disposal.
- **Surplus assets:** an unregistered asset becomes an UNDER_REVIEW candidate with
  `glRecognized=false`. Recognizing it needs a manual capitalization candidate with an offset
  account.
- **Other deferrals:**
  - department, cost-center and project-level GL mapping (Phase 20); cost center and project
    are carried as ids only;
  - a controlled override for locked periods (`fixed_asset.period_override` is used only to
    reopen a finalized depreciation period; accounting periods still use the platform reopen
    flow);
  - approvals and segregation of duties (Phase 26 hooks: `approvalReference` field);
  - the units-of-production, manual and tax-method strategies, which are registered
    placeholders that produce a depreciation-run error;
  - automatic candidates from Goods Receipt and Additional Purchase Cost (the internal API
    `createAcquisitionCandidate` and the manual endpoint exist).
- **Month close:** each run depreciates one period and does no catch-up for skipped months.
  Month close uses `validateFixedAssetClose`, which reports commissioned assets without posted
  depreciation.
