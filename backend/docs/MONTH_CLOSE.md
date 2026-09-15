# Phase 22 — Financial Period Close Orchestrator ("Month Close")

Implements docx spec Phase 22: a dependency-graph-driven orchestration
engine that runs every subledger's own authoritative close operation in
the correct order, reconciles each subledger against the GL, computes
the period's financial result, and locks the period — all resumable,
idempotent, versioned, and fully audited. Month Close never
re-implements a subledger's own calculation; it only calls it,
records the outcome, and reconciles it.

```
Layer 1 — Subledger Engines (Phase 11/16/18/19/20/21, Settlement,
           Treasury, Cash, Tax) — already exist, called directly.
                       │
Layer 2 — Close Orchestration
  PeriodReadinessService ── read-only pre-flight
        │
  CloseDependencyGraphService ── seeds/validates CloseStepDependency,
        │                        topological order, cycle detection
        ▼
  PeriodCloseOrchestrator ── owns PeriodCloseRun/PeriodCloseStep state
        │                     machine, sequential topological execution
        ▼
  PeriodCloseStepExecutor ── one dispatch per step code, calls the
                              owning subledger's own service
        │
  CloseIssueService / CloseReconciliationService / FXRevaluationService /
  AccrualService / DeferredRevenueService / TaxCloseService /
  FinancialResultService / ClosingEntryService / CloseSnapshotService
                       │
Layer 3 — Financial Period Lock
  PeriodLockService ── the ONLY caller of Phase 4's own
                        PeriodService.close/reopen
  PeriodReopenService ── request/approve, transitive step invalidation
```

## A. FinancialPeriod layered on top of Phase 4's AccountingPeriod

`FinancialPeriod` (this phase) is a richer, close-orchestration-specific
entity (OPEN/PRE_CLOSE/CLOSE_IN_PROGRESS/SOFT_CLOSED/HARD_CLOSED/
REOPENING/REOPENED/ERROR, fiscal year + period number, soft/hard close
timestamps, reopen count, mutation-token `dataVersion`). It never
replaces Phase 4's own `AccountingPeriod` — the actual `assertDateIsOpen`
posting guard every document in this codebase calls. `PeriodLockService`
is the ONLY bridge between the two: hard-closing a `FinancialPeriod`
calls `PeriodService.close(...)` on the matching (or newly created)
`AccountingPeriod`; reopening calls `PeriodService.reopen(...)`.

## B. Fixed step-graph, generic graph algorithms

`close-step-definitions.ts` hard-codes the 17-step set and their
dependency edges for this build (`DOCUMENT_READINESS` through
`FINAL_LOCK`) — a fully tenant-configurable, arbitrary step catalog is
out of scope. What IS generic: `CloseDependencyGraphService`'s
topological sort (Kahn's algorithm) and cycle detection operate on
`CloseStepDependency` ROWS, seeded from that fixed list rather than
hard-coded as a linear sequence — so a corrupted/cyclic edge set is
still genuinely detected and rejected (spec section 15's own
A→B→C→A test), not assumed impossible by construction.

## C. Document readiness covers a representative subset of document types

`document-close-relevance.ts` and `PeriodReadinessService`'s own direct
checks cover `PurchaseInvoice`/`SalesInvoice` (`ACTIVE` status +
`NOT_POSTED`) as the reference implementation of "approved but unposted
blocks close." The full ~30-document-type catalog across every phase is
not exhaustively wired up — extending coverage to another document type
requires no readiness-engine code change, just another block in
`documentFindings`.

## D. Period mutation token is not wired into every posting path

`FinancialPeriod.dataVersion` (spec section 25) exists and
`PeriodCloseRun.periodDataVersionAtStart` captures it at run start, but
no posting flow in this build calls `bumpDataVersion` automatically —
so a stale-close-run detection at finalize time is not yet enforced
end-to-end. The primitive is in place; the enforcement wiring across
every document type's posting handler is left for a follow-up.

## E. Document Close Relevance map

See `document-close-relevance.ts` — `IGNORE`/`WARNING`/
`BLOCK_IF_APPROVED`/`ALWAYS_BLOCK` are all modeled, but only
`PURCHASE_INVOICE`/`SALES_INVOICE` are actually queried against real
tables today; the rest of the map is forward-looking documentation.

## F. Reconciliation reads each subledger's own tables directly

`CloseReconciliationService.sourceAmountFor` queries `InventoryCostLayer`,
`SettlementObligation`/`SupplierPayable`, `PayrollLiability`,
`FixedAsset`, `PrepaidExpense`, and `ProductionCostMovement` directly
rather than requiring every module to export a `getSubledgerTotal()`
method — this is read-only aggregation, not a duplicated calculation.
The `PAYROLL_VS_GL` rule is the one exception needing multiple GL
accounts (net pay + every statutory payable) summed against one pooled
subledger total, handled as a special case in `runAll`.

## G. FX revaluation: AR/AP only, proportional historical carrying amount

Only open, foreign-currency `SettlementObligation` (AR) and
`SupplierPayable` (AP) rows are revalued (spec section 47's minimum
list) — foreign-currency bank and cash balance revaluation is NOT
implemented. Non-monetary items (inventory, fixed assets) are never
touched (spec section 48) — `FXRevaluationService` never reads those
tables. Because the settlement subledger does not keep a running
base-currency carrying value for a partially-settled item, the
"historical carrying amount" for the still-open balance is approximated
as `remainingAmount × (baseCurrencyAmount / originalAmount)` — the
original booking rate applied proportionally to what remains open.

## H. Deferred revenue is a header-per-schedule foundation only

`DeferredRevenueService` mirrors Phase 20's `PrepaidExpenseService`
pattern but keeps one schedule header per source document (with a
running `recognizedAmount`) rather than one row per period — no
milestone/usage-based recognition, no `DeferredRevenueSchedule`
per-period line table (spec section 65's own "future extension" note).

## I. Tax close covers VAT input/output only

`TaxCloseService` reconciles `TaxRegisterService.taxBalance` against the
GL `VAT_OUTPUT_PAYABLE`/`VAT_INPUT_RECOVERABLE` accounts. Withholding
reconciliation, nondeductible-expense tax adjustments, and payroll
statutory liabilities (covered instead by the `PAYROLL_VS_GL`
reconciliation rule) are out of scope for this tax-specific service.

## J. Soft close does not yet gate ordinary posting

Phase 4's own `PeriodService.assertDateIsOpen` guard is binary
(OPEN/CLOSED) — `SOFT_CLOSED` is tracked on `FinancialPeriod` and
reported everywhere, but does not itself block an ordinary document
posting the way `HARD_CLOSED` does. Only hard close actually flips the
underlying `AccountingPeriod`.

## K. Close snapshot stores checksums and references, not a data copy

`PeriodCloseSnapshot.snapshotData` stores counts, reconciliation
statuses, and a trial-balance checksum (SHA-256 over a sorted
account/side/amount digest) — not a physically frozen copy of every
subledger row. "What did the system know when August closed" is
answered by re-querying the same tables `businessDate <= periodEnd`,
using the checksum only to detect drift, not to serve as the archive
itself.

## L. Close health is computed live, not stored

`CloseHealthService` follows this codebase's own "rebuildable
projection" convention (same as every other `*HealthService`) — no
persisted `close_health_issues` table.

## M. Month Close runs under a resolved membership, not the initiator's own

Several existing subledger services (`FixedAssetDepreciationService`,
`PayrollCloseService`, ...) take a `membershipId` for
`OrganizationAccessService.assertAccess`. `PeriodCloseStepExecutor`
resolves ANY active membership with access to the run's organization
(preferring the close-run initiator's own) rather than requiring that
user to personally hold a membership on every organization in a
group close — Month Close acts as an orchestration principal.

## N. Sequential step execution, not parallel branches

Independent dependency-graph branches (e.g. Bank Reconciliation and FA
Depreciation, spec section 137) execute sequentially in topological
order in this build, not in parallel. Correctness (deterministic final
state) is preserved; only wall-clock parallelism is not implemented.

## O. No CONTRA_EXPENSE account class

This codebase's chart-of-accounts `AccountClass` enum has
`CONTRA_REVENUE` but no `CONTRA_EXPENSE` — `FinancialResultService`
nets `REVENUE`/`CONTRA_REVENUE`/`EXPENSE` account classes only.

## P. Other acknowledged gaps

- No `GroupCloseBatch` cross-organization batch orchestration (spec
  section 81) — each organization's `PeriodCloseRun` is started
  individually.
- No segregation-of-duties enforcement (preparer ≠ approver) — anyone
  holding the relevant permission may perform any step.
- Inventory count requirement (`requireInventoryCount` policy flag)
  is stored but not yet checked by the readiness engine.
- Manual checklist tasks (spec section 85, e.g. "legal provision
  reviewed") have no dedicated entity — `PeriodCloseIssue` with a
  manually-created row can serve the same purpose today.
- No dedicated `PeriodCloseAuditEvent` table — every close-lifecycle
  event is recorded through the existing `AuditService` instead, per
  this codebase's own "don't duplicate objects" convention.
- Year-end additional validations (statutory reporting readiness,
  opening-next-fiscal-year balance derivation beyond the retained
  earnings transfer itself) are not implemented beyond
  `ClosingEntryService.postYearEndClosingEntries`.

## Permissions

`PERIOD_CLOSE_VIEW`, `PERIOD_CLOSE_PREVIEW`, `PERIOD_CLOSE_RUN`,
`PERIOD_CLOSE_STEP_RUN`, `PERIOD_CLOSE_RESOLVE_ISSUE`,
`PERIOD_CLOSE_WAIVE_WARNING`, `PERIOD_CLOSE_MANUAL_ADJUSTMENT`,
`PERIOD_SOFT_CLOSE`, `PERIOD_HARD_CLOSE`, `PERIOD_REOPEN_REQUEST`,
`PERIOD_REOPEN_APPROVE`, `PERIOD_RECLOSE`, `PERIOD_VIEW_RECONCILIATION`,
`PERIOD_VIEW_TAX`, `PERIOD_VIEW_PAYROLL`, `PERIOD_VIEW_CLOSE_AUDIT`.
