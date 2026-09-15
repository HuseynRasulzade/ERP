# Phase 23 — Financial Reporting Semantic Layer / Report Mapping Engine / Financial Statement Engine

Implements docx spec Phase 23: a versioned, deterministic transformation
of Phase 4's General Ledger into Trial Balance / Balance Sheet / P&L /
Cash Flow / Statement of Changes in Equity, with account-to-report
mapping, comparative periods, cross-statement validation, drill-down,
translation, and an immutable final/signed report lifecycle — never a
second accounting balance source.

```
Layer 1 — Accounting Source: GL (Phase 4), Phase 22 Close Snapshot/Result
                       │
Layer 2 — Semantic Layer
  FinancialReportingFrameworkService / FinancialStatementDefinitionService
  FinancialReportMappingService ── EXACT_ACCOUNT/ACCOUNT_TREE/
                                    ACCOUNT_RANGE/ACCOUNT_TAG/
                                    DIMENSION_FILTER/FORMULA/EXCLUSION
                       │
Layer 3 — Calculation
  RowAmountResolverService ── shared engine: TrialBalance/BalanceSheet/
                               ProfitLoss/Equity all delegate to it
  FinancialReportFormulaService ── row-code dependency graph, cycle-checked
  CashFlowService ── bespoke direct + indirect method
  ComparativeReportingService / FinancialTranslationService
                       │
Layer 4 — Presentation
  FinancialReportVersionService ── run lifecycle, FinancialReportCell
  FinancialReportDrilldownService / SupportingScheduleService
  FinancialReportExportService / FinancialReportingHealthService
```

## A. Mapping versioning without a separate MappingVersion table

Spec section 14 requires a 2027 chart-of-accounts remap to leave a 2026
final report unaffected. This build achieves that through each
`FinancialReportMapping` row's own `effectiveFrom`/`effectiveTo` plus its
`frameworkVersionId`/`statementVersionId` foreign keys — both of which
are themselves immutable once ACTIVE (correcting either always means
creating a NEW version, never editing the old one). A historical report
always resolves mappings as of ITS OWN reporting date against the
frameworkVersion/statementVersion it was generated under, so the 2026
report keeps resolving 2026-dated mappings even after 2027 mappings are
added. No separate `FinancialReportMappingVersion` table exists.

## B. SUBTOTAL row aggregation authoring convention

`RowAmountResolverService` sums a SUBTOTAL row's direct children in
ascending `sequence` order, relying on the natural authoring convention
that a subtotal's own sequence number is higher than its children's
(detail rows listed first, the total beneath them) — this is not an
enforced constraint, just the assumed row-authoring order. A statement
version whose rows violate this ordering would compute an incomplete
subtotal; this is disclosed rather than solved with a full topological
pass over the SUBTOTAL/parent hierarchy (which the FORMULA-row pass
already does for genuine formula dependencies).

## C. Period-average FX translation is a two-point average

`FinancialTranslationService`'s `PERIOD_AVERAGE_RATE` method averages
the closing rate at period start and period end rather than a true
daily-weighted average over every day in the period (spec section 79) —
a documented simplification given this build's `ExchangeRate` table is
keyed by date, not by a running daily series guaranteed for every day.

## D. Reporting reuses Phase 22's "orchestration principal" membership pattern

`FinancialReportVersionService.resolveMembership` and Phase 22's
`PeriodCloseStepExecutor.systemMembership` are two independent, small
implementations of the same idea (resolve any membership with
organization access rather than requiring the report-run initiator to
personally hold one) rather than a shared module dependency, to avoid a
cross-module coupling between Financial Reporting and Month Close
beyond what's already needed for close-version awareness.

## E. Export produces frozen JSON/CSV; no binary PDF/XLSX renderer

`FinancialReportExportService.toJson`/`toCsv` produce the exact frozen,
machine-readable contract spec section 139 asks for (organization,
period, currency, framework, version, generated-at, PRELIMINARY/FINAL
status) — a real PDF/XLSX binary renderer is presentation-layer tooling
this build does not implement (disclosed simplification). Any renderer
consuming `toJson`'s output would be reading the same frozen source a
PDF export legitimately requires (spec section 178's own "PDF/XLSX
generation should use frozen report result").

## F. Cross-statement validation is a curated set, not a generic rule engine

`FinancialReportValidationService` implements the specific checks spec
section 108 names (BS equation, TB debit=credit, P&L vs. Phase 22
financial result, equity roll-forward, equity vs. BS, cash flow vs. BS
cash) as typed methods rather than a fully generic
`FinancialReportValidationRule.formula` expression evaluator — the
`FinancialReportValidationRule` table exists and stores results, but a
tenant cannot yet author an arbitrary custom validation formula through
it (disclosed simplification; the formula engine built for report ROWS
in `FinancialReportFormulaService` is reused if this is extended later).

## G. Cash Flow classification depends on `CashFlowMappingRule` seed data

`CashFlowService.directMethod` classifies every `BankCashMovement`/
`CashMovement` row strictly by matching `sourceDocumentType` against a
seeded `CashFlowMappingRule.sourceOperationType` — an unmatched movement
falls into an `UNCLASSIFIED` bucket (still counted in the external net
cash flow, just not attributed to Operating/Investing/Financing) rather
than blocking the report. Internal-transfer elimination (spec sections
44-45) only works for `sourceDocumentType`s a tenant has explicitly
flagged `isInternalTransfer: true`.

## H. Group/consolidation foundation is intentionally thin

Per spec section 85's own "Foundation only," no consolidation entities
beyond what's implied by `FinancialReportRun.organizationId` (one run
per organization) are implemented — no `ReportingChart`, ownership
percentage, or intercompany elimination engine. A multi-entity combined
view (spec section 137) can be built by running the same statement
version against several organizations and summing client-side; this
build does not label that "consolidated" anywhere, and no code path
does so.

## I. Other acknowledged gaps

- `FinancialReportLayout` (columns/labels/print metadata) is stored as
  a JSON blob with no rendering engine consuming it — presentation
  layouts are a frontend concern.
- Segregation of duties (preparer ≠ approver) is not enforced —
  anyone holding the relevant permission may perform any lifecycle step.
- `FinancialStatementNote`/supporting-schedule reconciliation (spec
  section 123 — "Notes should reconcile to main statement row") is not
  automatically checked; notes are freeform.
- Historical as-of reporting (spec section 133) works because every
  query is parameterized by the run's own `asOfDate`/`periodEnd` against
  the immutable `AccountingMovement` register — there is no separate
  point-in-time snapshot cache; a large tenant's report generation cost
  scales with GL size rather than being pre-aggregated (spec section
  130's caching guidance is not implemented).
- Dimensional (branch/cost-center/project) P&L (spec section 134) is
  supported at the mapping level via `DIMENSION_FILTER`, but
  `RowAmountResolverService` does not yet apply the dimension filter
  itself when aggregating — the mapping strategy exists; the filter
  application is a follow-up.

## Permissions

`FIN_REPORT_VIEW`, `FIN_REPORT_VIEW_PRELIMINARY`, `FIN_REPORT_VIEW_FINAL`,
`FIN_REPORT_TRIAL_BALANCE`, `FIN_REPORT_BALANCE_SHEET`, `FIN_REPORT_PNL`,
`FIN_REPORT_CASH_FLOW`, `FIN_REPORT_EQUITY`, `FIN_REPORT_DRILLDOWN`,
`FIN_REPORT_SENSITIVE_DRILLDOWN`, `FIN_REPORT_MAPPING_VIEW`,
`FIN_REPORT_MAPPING_EDIT`, `FIN_REPORT_MAPPING_APPROVE`,
`FIN_REPORT_LAYOUT_EDIT`, `FIN_REPORT_GENERATE`, `FIN_REPORT_APPROVE`,
`FIN_REPORT_FINALIZE`, `FIN_REPORT_SIGN`, `FIN_REPORT_RESTATE`,
`FIN_REPORT_EXPORT`, `FIN_REPORT_GROUP_VIEW`.
