# Phase 24 — Management Reporting / KPI Engine / Profitability Engine / Budget-Forecast-Scenario / Dashboard Platform

Implements docx spec Phase 24: a governed semantic layer over canonical
operational facts (Sales, Inventory Costing, Settlement, Payroll,
Production, GL) producing KPIs, customer/product profitability, cost
center/project P&L, working-capital/treasury/production/workforce
analytics, and a budget/forecast/scenario foundation with drill-through
and immutable snapshots — never a duplicated "management truth" table.

```
Canonical Business Facts (Sales/Purchase/Inventory/Settlement/Payroll/
                           Production/GL — read live, no fact-mart copy)
                       │
ManagementMeasureService ── canonical measure dispatch (GROSS_REVENUE,
                             COGS, AR_BALANCE, LABOR_COST, HEADCOUNT, ...)
                       │
ManagementSemanticModelService ── governs measure codes, evaluates
                                   FORMULA measures via Phase 23's own
                                   formula engine (reused, not duplicated)
                       │
KPIService ── numerator/denominator + directionality/thresholds
ProfitabilityService ── by-customer / by-product (shared calculator)
CostCenterProjectService ── Cost Center P&L / Project P&L
ManagementPnLService ── configurable management P&L + financial bridge
WorkingCapitalAnalyticsService / TreasuryKPIService / ProductionKPIService
  / WorkforceAnalyticsService / SalesProcurementKPIService
ManagementAllocationService ── management-only cost-pool allocation
                       │
BudgetService / ForecastService / ScenarioService ── versioned, never
                                                       overwritten
VarianceAnalysisService ── Actual vs Budget/Forecast/Prior
                       │
ManagementSnapshotService ── frozen board-pack payload + source lineage
DashboardService / ManagementDrillthroughService / ManagementAlertService
ManagementReportingHealthService
```

## A. No separate analytical fact/projection tables

Spec section 13 allows canonical facts to be "projections/data marts."
This build computes every measure LIVE against the same operational
tables every prior phase already established (`SalesInvoiceLine`,
`InventoryCostLayer`, `SettlementObligation`/`SupplierPayable`,
`PayrollResultLine`, `ProductionCostMovement`, `AccountingMovement`) —
there is no `SalesFact`/`PurchaseFact`/`InventoryFact`/... materialized
table. This keeps the "canonical facts, never duplicated" principle
absolute, at the cost of the incremental-refresh/OLAP performance
architecture spec section 135 describes (disclosed — large-tenant
dashboard performance is not addressed by this build).

## B. Formula engine reuse across Phase 23 and Phase 24

`ManagementSemanticModelService.resolveMeasure` and
`ManagementPnLService.calculate` both reuse Phase 23's
`FinancialReportFormulaService` (topological order + cycle detection +
`+`/`-` evaluation) for FORMULA-type measures and P&L rows, rather than
building a second formula engine. Division (for ratio measures like
`GROSS_MARGIN_PCT`) is handled as a dedicated canonical measure in
`ManagementMeasureService`, not through the generic formula string
grammar.

## C. AR/AP balance is "as of now," not historically snapshotted

`ManagementMeasureService`'s `AR_BALANCE`/`AP_BALANCE` measures accept a
`mode` parameter for interface consistency with every other measure but
do not actually vary by date — the settlement subledger keeps no daily
historical balance table. A true "AR as of 31 December" query would
need a new capability in Phase 13, out of this phase's scope.

## D. Channel and Project have no dedicated master data

`ProfitabilityService.byChannel` returns an empty result set — no
`channel` field exists on `SalesInvoice` yet, so channel profitability
(spec sections 36-38) has no source data to group by in this build.
`projectId` (used by `CostCenterProjectService.projectPnL`) is a soft
reference string everywhere in this codebase (established in Phase
17/20) — there is no `Project` master table to join against for a
project's name/attributes.

## E. Project P&L pools direct cost; Cost Center allocation traces both directions

`CostCenterProjectService.projectPnL` reads `AccountingMovement` rows
dimensioned to the project and separates REVENUE from EXPENSE account
classes, but cannot split EXPENSE further into material/labor/external
service (spec section 41) — this codebase's `AccountingMovementDimension`
carries no cost-component tag, so `directMaterial`/`directLabor` are
always zero and everything pools into `otherDirectCost` (disclosed).
Cost Center "Allocated In" reads Phase 20's own `CostAllocationRunLine`
directly; "Allocated Out" is derived by finding `CostAllocationRun`s
whose `AllocationRule.sourceCostCenterId` matches.

## F. Management-to-Financial bridge reports the gap, not its causes

`ManagementPnLService.reconcileToFinancial` compares the Management
P&L's bottom line against Phase 22's own `FinancialResultService` net
result for the same organization/period and reports whether they
reconcile and by how much (spec section 47) — it does NOT automatically
decompose the difference into "managerial reallocations / provisional
cost / scope exclusions" (spec section 48); that explanation is left to
the caller/analyst.

## G. Slow-moving inventory is a single fixed-days policy

`WorkingCapitalAnalyticsService.slowMovingInventory` uses one
`slowMoveDays` parameter against a cost layer's `receiptDate` — no
category-specific policy overrides, no "days since LAST SALE" tracking
(only days since the layer was opened), and no Dead Stock/Stockout/Fill
Rate/Excess Stock KPIs are implemented (spec sections 58, 60; disclosed
gap).

## H. Treasury KPIs delegate entirely to Phase 14; forecast accuracy is not implemented

`TreasuryKPIService` is a thin wrapper over `LiquidityForecastService`/
`TreasuryHealthService` — genuinely no new calculation. Cash Forecast
Accuracy (spec section 69, comparing a stored forecast to actual by
date/category/counterparty/currency) has no dedicated comparison table
in this build; the generic `ForecastFact`/measure-actual comparison in
`VarianceAnalysisService` could be extended to cover it later.

## I. Scrap-quantity% and scrap-cost% are not both implemented

`ProductionKPIService.orderKPIs` computes `scrapQtyPct` (scrap quantity
÷ total processed quantity) only — the cost-based scrap KPI (scrap cost
÷ production cost, spec section 77's own second definition) is not
implemented as a separate measure.

## J. Scenario assumption "dependency" is a simple compounding rule, not a DAG

`ScenarioService.calculate` applies every assumption whose
`measureCode` matches the requested measure, compounding PERCENT
assumptions multiplicatively and ABSOLUTE ones additively in creation
order. A true dependency model where a Volume assumption should also
flow into COGS/Inventory/Cash (spec section 103) is not automated — the
caller must calculate each dependent measure's own scenario separately
(each will independently apply any assumption defined against ITS OWN
measure code).

## K. Variance favorability uses a curated measure list; no bridge decomposition

`VarianceAnalysisService` classifies favorability by checking whether
`measureCode` is in a small hard-coded "revenue-like" set rather than
reading a governed favorability flag off the measure definition itself
(a reasonable follow-up: add a `favorabilityDirection` field to
`ManagementMeasureDefinition`). The Volume/Price/Mix/Cost variance
BRIDGE (spec section 118, `VarianceBridgeDefinition`) is not
implemented — only the simple actual-vs-comparator variance is.

## L. Dashboard widgets are a JSON blob, not a relational table

`ManagementDashboard.widgets` stores the widget array as JSON rather
than a separate `DashboardWidget` table — no rendering engine consumes
it in this build; it is a governed data contract for a future frontend.

## M. Other acknowledged gaps

- No segregation-of-duties enforcement (budget preparer ≠ approver,
  etc.) — anyone holding the relevant permission may perform any step.
- `KPITarget`'s `minimum`/`maximum` fields exist for `TARGET_RANGE`
  directionality but `KPIService.evaluate`'s status logic does not yet
  use them (only `warningThreshold`/`criticalThreshold` are checked).
- No consolidation/multi-entity combined view endpoint is implemented
  (spec sections 137-138) — the underlying measures are per-organization
  and could be summed client-side, clearly unlabeled as "consolidated."
- Constant-currency / FX-effect bridge analysis (spec sections 132-133)
  is not implemented.
- Row-level security beyond the existing organization-access check
  (branch/department/cost-center/project/territory row filtering, spec
  section 140) is not enforced — a user with `MGMT_*` view permission on
  an organization sees every row within it.

## Permissions

`MGMT_REPORT_VIEW`, `MGMT_DASHBOARD_VIEW`, `MGMT_KPI_VIEW`,
`MGMT_PROFITABILITY_VIEW`, `MGMT_CUSTOMER_PROFITABILITY`,
`MGMT_PRODUCT_PROFITABILITY`, `MGMT_COST_CENTER_VIEW`, `MGMT_PROJECT_PNL`,
`MGMT_WORKING_CAPITAL_VIEW`, `MGMT_PRODUCTION_VIEW`,
`MGMT_WORKFORCE_COST_VIEW`, `MGMT_BUDGET_VIEW`, `MGMT_BUDGET_EDIT`,
`MGMT_BUDGET_APPROVE`, `MGMT_FORECAST_EDIT`, `MGMT_SCENARIO_CREATE`,
`MGMT_SEMANTIC_MODEL_EDIT`, `MGMT_KPI_EDIT`, `MGMT_ALLOCATION_EDIT`,
`MGMT_SNAPSHOT_CREATE`, `MGMT_EXPORT`, `MGMT_SENSITIVE_DRILLDOWN`.
