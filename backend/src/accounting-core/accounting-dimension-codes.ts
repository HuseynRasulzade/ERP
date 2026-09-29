/**
 * Stable dimension codes (spec section 26) — the same set of subconto
 * definitions every tenant gets seeded with. Kept as constants (never a
 * hardcoded string scattered through services) so a typo becomes a
 * compile error, not a silent mismatch at posting time.
 */
export const DimensionCodes = {
  ORGANIZATION: 'ORGANIZATION',
  BRANCH: 'BRANCH',
  DEPARTMENT: 'DEPARTMENT',
  WAREHOUSE: 'WAREHOUSE',
  CASHBOX: 'CASHBOX',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  PARTNER: 'PARTNER',
  COUNTERPARTY: 'COUNTERPARTY',
  CONTRACT: 'CONTRACT',
  AGREEMENT: 'AGREEMENT',
  PRODUCT: 'PRODUCT',
  PRODUCT_CHARACTERISTIC: 'PRODUCT_CHARACTERISTIC',
  CURRENCY: 'CURRENCY',
  SETTLEMENT_DOCUMENT: 'SETTLEMENT_DOCUMENT',
  // Cash Desk Control Engine (docx spec Phase 15) — the accountable
  // ResponsiblePerson an advance/shortage receivable is tracked against.
  EMPLOYEE: 'EMPLOYEE',
  // Fixed Asset Subledger (docx spec Phase 16) — which asset/CIP project a
  // cost/depreciation/impairment/disposal GL line belongs to. Two separate
  // dimensions because a CIP project's own capitalization account (113)
  // carries cost BEFORE any FixedAsset row exists — a FIXED_ASSET
  // dimension can never be required there.
  FIXED_ASSET: 'FIXED_ASSET',
  CIP_PROJECT: 'CIP_PROJECT',
  // Expenses / Cost Centers (docx spec Phase 20) — the financial-
  // responsibility dimension a claim line/allocation lands on. Deliberately
  // its own dimension, never DEPARTMENT (spec sections 4-5: Cost Center and
  // Department are not the same master). PROJECT has no backing master
  // entity in this build yet (disclosed simplification, see
  // docs/EXPENSES.md) — the reference is an opaque string today.
  COST_CENTER: 'COST_CENTER',
  PROJECT: 'PROJECT',
} as const;

export type DimensionCode =
  (typeof DimensionCodes)[keyof typeof DimensionCodes];

/** Reference-entity type recorded on each dimension value (spec section 30
 * "never store arbitrary entity IDs without type enforcement") — deliberately
 * the same string as the dimension code for the entities we seed, since each
 * seeded dimension maps 1:1 to exactly one entity type today. */
export const DIMENSION_REFERENCE_ENTITY_TYPE: Record<string, string> = {
  [DimensionCodes.ORGANIZATION]: 'ORGANIZATION',
  [DimensionCodes.BRANCH]: 'BRANCH',
  [DimensionCodes.DEPARTMENT]: 'DEPARTMENT',
  [DimensionCodes.WAREHOUSE]: 'WAREHOUSE',
  [DimensionCodes.CASHBOX]: 'CASHBOX',
  [DimensionCodes.BANK_ACCOUNT]: 'BANK_ACCOUNT',
  [DimensionCodes.PARTNER]: 'COUNTERPARTY',
  [DimensionCodes.COUNTERPARTY]: 'COUNTERPARTY',
  [DimensionCodes.CONTRACT]: 'COUNTERPARTY',
  [DimensionCodes.AGREEMENT]: 'COUNTERPARTY',
  [DimensionCodes.PRODUCT]: 'PRODUCT',
  [DimensionCodes.PRODUCT_CHARACTERISTIC]: 'PRODUCT',
  [DimensionCodes.CURRENCY]: 'CURRENCY',
  [DimensionCodes.SETTLEMENT_DOCUMENT]: 'SETTLEMENT_DOCUMENT',
  [DimensionCodes.EMPLOYEE]: 'RESPONSIBLE_PERSON',
  [DimensionCodes.FIXED_ASSET]: 'FIXED_ASSET',
  [DimensionCodes.CIP_PROJECT]: 'CIP_PROJECT',
  [DimensionCodes.COST_CENTER]: 'COST_CENTER',
  [DimensionCodes.PROJECT]: 'PROJECT',
};

/**
 * Semantic accounting-mapping keys (spec sections 39-40) — business modules
 * resolve through AccountingMappingService.resolve(...) using one of these,
 * never a literal account code.
 */
export const MappingKeys = {
  CASH: 'CASH',
  BANK: 'BANK',
  MATERIAL_INVENTORY: 'MATERIAL_INVENTORY',
  FINISHED_GOODS: 'FINISHED_GOODS',
  GOODS_INVENTORY: 'GOODS_INVENTORY',
  CUSTOMER_RECEIVABLE: 'CUSTOMER_RECEIVABLE',
  SUPPLIER_ADVANCE: 'SUPPLIER_ADVANCE',
  CUSTOMER_ADVANCE: 'CUSTOMER_ADVANCE',
  SUPPLIER_PAYABLE: 'SUPPLIER_PAYABLE',
  SALES_REVENUE: 'SALES_REVENUE',
  SALES_RETURN: 'SALES_RETURN',
  SALES_DISCOUNT: 'SALES_DISCOUNT',
  COGS: 'COGS',
  COMMERCIAL_EXPENSE: 'COMMERCIAL_EXPENSE',
  ADMIN_EXPENSE: 'ADMIN_EXPENSE',
  OTHER_OPERATING_INCOME: 'OTHER_OPERATING_INCOME',
  OTHER_OPERATING_EXPENSE: 'OTHER_OPERATING_EXPENSE',
  CURRENT_INCOME_TAX_EXPENSE: 'CURRENT_INCOME_TAX_EXPENSE',
  // Tax Engine build (docx spec Phase 5, section 38)
  VAT_INPUT_RECOVERABLE: 'VAT_INPUT_RECOVERABLE',
  VAT_INPUT_PENDING: 'VAT_INPUT_PENDING',
  VAT_INPUT_NONRECOVERABLE: 'VAT_INPUT_NONRECOVERABLE',
  VAT_OUTPUT_PAYABLE: 'VAT_OUTPUT_PAYABLE',
  VAT_DEPOSIT_ACCOUNT: 'VAT_DEPOSIT_ACCOUNT',
  VAT_SETTLEMENT: 'VAT_SETTLEMENT',
  VAT_ROUNDING: 'VAT_ROUNDING',
  VAT_ADJUSTMENT: 'VAT_ADJUSTMENT',
  // Purchase / Procurement build (docx spec Phase 9, section 5 Model A)
  GOODS_RECEIVED_NOT_INVOICED: 'GOODS_RECEIVED_NOT_INVOICED',
  // Treasury / Bank Operations build (docx spec Phase 14) — independently
  // configurable per org, defaulting to the same accounts as the generic
  // OTHER_OPERATING_INCOME/EXPENSE keys (see az-standard-coa.data.ts).
  BANK_FEE_EXPENSE: 'BANK_FEE_EXPENSE',
  BANK_INTEREST_INCOME: 'BANK_INTEREST_INCOME',
  BANK_FX_GAIN: 'BANK_FX_GAIN',
  BANK_FX_LOSS: 'BANK_FX_LOSS',
  // Cash Desk Control Engine (docx spec Phase 15)
  ACCOUNTABLE_PERSON_RECEIVABLE: 'ACCOUNTABLE_PERSON_RECEIVABLE',
  CASH_SHORTAGE_LOSS: 'CASH_SHORTAGE_LOSS',
  CASH_SURPLUS_INCOME: 'CASH_SURPLUS_INCOME',
  CASH_IN_TRANSIT: 'CASH_IN_TRANSIT',
  // Fixed Asset Subledger (docx spec Phase 16)
  FIXED_ASSET_COST: 'FIXED_ASSET_COST',
  FIXED_ASSET_CIP: 'FIXED_ASSET_CIP',
  ACCUMULATED_DEPRECIATION: 'ACCUMULATED_DEPRECIATION',
  DEPRECIATION_EXPENSE: 'DEPRECIATION_EXPENSE',
  IMPAIRMENT_LOSS: 'IMPAIRMENT_LOSS',
  DISPOSAL_GAIN: 'DISPOSAL_GAIN',
  DISPOSAL_LOSS: 'DISPOSAL_LOSS',
  // Payroll / Gross-to-Net Engine (docx spec Phase 19, sections 97-103):
  // gross wages + employer statutory contributions are expensed; net pay
  // and each statutory withholding become a separate short-term
  // liability until paid (spec section 114 — never one lumped "payroll
  // payable" account).
  SALARY_EXPENSE: 'SALARY_EXPENSE',
  EMPLOYER_CONTRIBUTION_EXPENSE: 'EMPLOYER_CONTRIBUTION_EXPENSE',
  SALARY_PAYABLE: 'SALARY_PAYABLE',
  INCOME_TAX_PAYABLE: 'INCOME_TAX_PAYABLE',
  SOCIAL_INSURANCE_PAYABLE: 'SOCIAL_INSURANCE_PAYABLE',
  UNEMPLOYMENT_INSURANCE_PAYABLE: 'UNEMPLOYMENT_INSURANCE_PAYABLE',
  MEDICAL_INSURANCE_PAYABLE: 'MEDICAL_INSURANCE_PAYABLE',
  EXECUTION_ORDER_PAYABLE: 'EXECUTION_ORDER_PAYABLE',
  // Expenses / Cost Centers / Employee Expenses (docx spec Phase 20,
  // sections 92-96): an employee-personal-funds expense is never a cash/
  // bank payment (spec's own critical rule) — it's this liability until
  // Phase 14/15 actually pays it.
  PREPAID_EXPENSE_ASSET: 'PREPAID_EXPENSE_ASSET',
  EMPLOYEE_REIMBURSEMENT_PAYABLE: 'EMPLOYEE_REIMBURSEMENT_PAYABLE',
} as const;

export type MappingKey = (typeof MappingKeys)[keyof typeof MappingKeys];
