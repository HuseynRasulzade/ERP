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
} as const;

export type DimensionCode = (typeof DimensionCodes)[keyof typeof DimensionCodes];

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
  // Reserved for the Tax Engine build (docx spec Phase 5)
  VAT_RECOVERABLE: 'VAT_RECOVERABLE',
  VAT_PAYABLE: 'VAT_PAYABLE',
} as const;

export type MappingKey = (typeof MappingKeys)[keyof typeof MappingKeys];
