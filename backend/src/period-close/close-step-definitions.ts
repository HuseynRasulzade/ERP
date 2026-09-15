/**
 * Static registry of Month Close step codes and their dependency edges
 * (docx spec Phase 22, sections 12-16). Not a fully data-driven,
 * tenant-configurable graph — the STEP set itself is fixed by this build
 * (disclosed simplification, see docs/MONTH_CLOSE.md section C) — but the
 * graph ALGORITHMS (topological sort, cycle detection, transitive
 * descendant lookup in `CloseDependencyGraphService`) are generic and
 * operate on `CloseStepDependency` rows seeded from this list, so they
 * are exercised as real graph operations, not a hard-coded sequence.
 */
export interface CloseStepDefinition {
  code: string;
  name: string;
  dependencyGroup: string;
  dependsOn: string[];
  /** Steps that are SKIPPED rather than run when the organization has no
   * relevant activity (spec section 16). Evaluated by the step executor,
   * not hard-coded true/false here. */
  conditional: boolean;
}

export const CLOSE_STEP_CODES = {
  DOCUMENT_READINESS: 'DOCUMENT_READINESS',
  FA_DEPRECIATION: 'FA_DEPRECIATION',
  PREPAID_RECOGNITION: 'PREPAID_RECOGNITION',
  PAYROLL_FINALIZATION: 'PAYROLL_FINALIZATION',
  INVENTORY_COSTING: 'INVENTORY_COSTING',
  PRODUCTION_COSTING: 'PRODUCTION_COSTING',
  INVENTORY_RECALCULATION: 'INVENTORY_RECALCULATION',
  AR_AP_VALIDATION: 'AR_AP_VALIDATION',
  BANK_RECONCILIATION: 'BANK_RECONCILIATION',
  CASH_CLOSE: 'CASH_CLOSE',
  FX_REVALUATION: 'FX_REVALUATION',
  ACCRUALS: 'ACCRUALS',
  TAX_CLOSE: 'TAX_CLOSE',
  RECONCILIATION: 'RECONCILIATION',
  FINANCIAL_RESULT: 'FINANCIAL_RESULT',
  CLOSING_ENTRIES: 'CLOSING_ENTRIES',
  FINAL_LOCK: 'FINAL_LOCK',
} as const;

export type CloseStepCode = (typeof CLOSE_STEP_CODES)[keyof typeof CLOSE_STEP_CODES];

export const CLOSE_STEP_DEFINITIONS: CloseStepDefinition[] = [
  { code: CLOSE_STEP_CODES.DOCUMENT_READINESS, name: 'Missing / Unposted Document Check', dependencyGroup: 'READINESS', dependsOn: [], conditional: false },
  { code: CLOSE_STEP_CODES.FA_DEPRECIATION, name: 'Fixed Asset Depreciation', dependencyGroup: 'SUBLEDGER', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: true },
  { code: CLOSE_STEP_CODES.PREPAID_RECOGNITION, name: 'Prepaid Expense Recognition', dependencyGroup: 'SUBLEDGER', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: true },
  { code: CLOSE_STEP_CODES.PAYROLL_FINALIZATION, name: 'Work Time / Payroll Finalization', dependencyGroup: 'SUBLEDGER', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: true },
  { code: CLOSE_STEP_CODES.INVENTORY_COSTING, name: 'Inventory Costing Finalization', dependencyGroup: 'SUBLEDGER', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: false },
  {
    code: CLOSE_STEP_CODES.PRODUCTION_COSTING,
    name: 'Production / WIP Costing',
    dependencyGroup: 'SUBLEDGER',
    dependsOn: [CLOSE_STEP_CODES.INVENTORY_COSTING, CLOSE_STEP_CODES.PAYROLL_FINALIZATION, CLOSE_STEP_CODES.PREPAID_RECOGNITION, CLOSE_STEP_CODES.FA_DEPRECIATION],
    conditional: true,
  },
  { code: CLOSE_STEP_CODES.INVENTORY_RECALCULATION, name: 'Inventory Recalculation After Production', dependencyGroup: 'SUBLEDGER', dependsOn: [CLOSE_STEP_CODES.PRODUCTION_COSTING], conditional: true },
  { code: CLOSE_STEP_CODES.AR_AP_VALIDATION, name: 'AR/AP Readiness', dependencyGroup: 'SETTLEMENT', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: false },
  { code: CLOSE_STEP_CODES.BANK_RECONCILIATION, name: 'Bank Reconciliation', dependencyGroup: 'SETTLEMENT', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: false },
  { code: CLOSE_STEP_CODES.CASH_CLOSE, name: 'Cash Close', dependencyGroup: 'SETTLEMENT', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: false },
  {
    code: CLOSE_STEP_CODES.FX_REVALUATION,
    name: 'FX Revaluation',
    dependencyGroup: 'VALUATION',
    dependsOn: [CLOSE_STEP_CODES.AR_AP_VALIDATION, CLOSE_STEP_CODES.BANK_RECONCILIATION, CLOSE_STEP_CODES.CASH_CLOSE],
    conditional: true,
  },
  { code: CLOSE_STEP_CODES.ACCRUALS, name: 'Accruals / Deferrals', dependencyGroup: 'VALUATION', dependsOn: [CLOSE_STEP_CODES.DOCUMENT_READINESS], conditional: false },
  { code: CLOSE_STEP_CODES.TAX_CLOSE, name: 'Tax Close', dependencyGroup: 'VALUATION', dependsOn: [CLOSE_STEP_CODES.FX_REVALUATION, CLOSE_STEP_CODES.ACCRUALS], conditional: false },
  {
    code: CLOSE_STEP_CODES.RECONCILIATION,
    name: 'Subledger ↔ GL Reconciliation',
    dependencyGroup: 'RECONCILIATION',
    dependsOn: [
      CLOSE_STEP_CODES.INVENTORY_RECALCULATION,
      CLOSE_STEP_CODES.AR_AP_VALIDATION,
      CLOSE_STEP_CODES.BANK_RECONCILIATION,
      CLOSE_STEP_CODES.CASH_CLOSE,
      CLOSE_STEP_CODES.FA_DEPRECIATION,
      CLOSE_STEP_CODES.PREPAID_RECOGNITION,
      CLOSE_STEP_CODES.PAYROLL_FINALIZATION,
      CLOSE_STEP_CODES.PRODUCTION_COSTING,
      CLOSE_STEP_CODES.TAX_CLOSE,
    ],
    conditional: false,
  },
  { code: CLOSE_STEP_CODES.FINANCIAL_RESULT, name: 'Financial Result Calculation', dependencyGroup: 'FINALIZATION', dependsOn: [CLOSE_STEP_CODES.RECONCILIATION], conditional: false },
  { code: CLOSE_STEP_CODES.CLOSING_ENTRIES, name: 'Closing Entries / Retained Earnings', dependencyGroup: 'FINALIZATION', dependsOn: [CLOSE_STEP_CODES.FINANCIAL_RESULT], conditional: true },
  { code: CLOSE_STEP_CODES.FINAL_LOCK, name: 'Final Validation / Snapshot / Period Lock', dependencyGroup: 'FINALIZATION', dependsOn: [CLOSE_STEP_CODES.CLOSING_ENTRIES], conditional: false },
];
