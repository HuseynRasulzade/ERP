import Decimal from 'decimal.js';

/** Document-type / numbering codes owned by Phase 12. */
export const INVENTORY_COUNT_PLAN_TYPE = 'INVENTORY_COUNT_PLAN';
export const INVENTORY_COUNT_SESSION_TYPE = 'INVENTORY_COUNT_SESSION';
export const INVENTORY_COUNT_ADJUSTMENT_TYPE = 'INVENTORY_COUNT_ADJUSTMENT';

export const COUNT_TYPES = ['FULL', 'PARTIAL', 'CYCLE', 'ANNUAL', 'AD_HOC', 'INVESTIGATION', 'RECOUNT'] as const;
export const FREEZE_POLICIES = ['HARD_FREEZE', 'SOFT_FREEZE', 'NO_FREEZE_WITH_MOVEMENT_TRACKING'] as const;
export const CUTOFF_MODES = ['GLOBAL_SNAPSHOT_CUTOFF', 'TASK_COMPLETION_CUTOFF', 'LOCATION_COUNT_TIMESTAMP'] as const;
export const RECOUNT_POLICIES = ['NO_RECOUNT', 'RECOUNT_ALL_VARIANCES', 'RECOUNT_ABOVE_QUANTITY_THRESHOLD', 'RECOUNT_ABOVE_VALUE_THRESHOLD', 'RECOUNT_PERCENTAGE', 'MANUAL_SELECTION'] as const;
export const FINAL_QUANTITY_RULES = ['LATEST_RECOUNT', 'CONSENSUS', 'SUPERVISOR_CONFIRMED', 'MANUAL_APPROVED'] as const;
export const DUPLICATE_ENTRY_POLICIES = ['AGGREGATE', 'LAST_COUNT', 'BLOCK_DUPLICATE'] as const;
export const REPEATED_SCAN_MODES = ['INCREMENT', 'SEPARATE_ENTRIES'] as const;
export const UNCOUNTED_POLICIES = ['MARK_UNCOUNTED', 'TREAT_AS_ZERO'] as const;
export const SURPLUS_COST_POLICIES = ['CURRENT_WEIGHTED_AVERAGE', 'LATEST_PURCHASE_COST', 'FIFO_REFERENCE', 'STANDARD_COST', 'MANUAL_APPROVED', 'ZERO_PENDING_VALUATION'] as const;
export const SHORTAGE_COST_POLICIES = ['CURRENT_COST', 'FIFO_LAYERS', 'LATEST_PURCHASE_COST'] as const;
export const COSTING_STRICTNESS = ['STRICT', 'ALLOW_PENDING'] as const;
export const LOCATION_MISMATCH_POLICIES = ['LOCATION_TRANSFER', 'ADJUST_STOCK', 'INVESTIGATION_REQUIRED'] as const;
export const ADJUSTMENT_DATE_POLICIES = ['SNAPSHOT_DATE', 'COMPLETION_DATE', 'EXPLICIT_DATE'] as const;
export const STALE_POLICIES = ['BLOCK', 'RECALCULATE'] as const;

export const SCOPE_DIMENSIONS = [
  'BRANCH',
  'WAREHOUSE',
  'LOCATION',
  'LOCATION_SUBTREE',
  'PRODUCT',
  'PRODUCT_CATEGORY',
  'CHARACTERISTIC',
  'BATCH',
  'SERIAL',
  'OWNERSHIP_TYPE',
  'QUALITY_STATUS',
  'INVENTORY_STATUS',
] as const;

export const ENTRY_METHODS = ['MANUAL', 'BARCODE', 'IMPORT', 'MOBILE', 'API', 'SYSTEM_RECOUNT'] as const;
export const TEAM_ROLES = ['TEAM_LEAD', 'COUNTER', 'OBSERVER', 'FINANCE_REPRESENTATIVE', 'WAREHOUSE_REPRESENTATIVE'] as const;

export const RESOLUTION_TYPES = [
  'ADJUST_STOCK',
  'LOCATION_TRANSFER',
  'STATUS_TRANSFER',
  'BATCH_CORRECTION',
  'SERIAL_CORRECTION',
  'NO_ADJUSTMENT',
  'SOURCE_DOCUMENT_CORRECTION',
  'WRITE_OFF',
  'SURPLUS_RECOGNITION',
] as const;

export const INVESTIGATION_STATUSES = ['OPEN', 'RECOUNT_REQUIRED', 'UNDER_INVESTIGATION', 'EXPLAINED', 'APPROVED', 'REJECTED', 'POSTED'] as const;

export const ADJUSTMENT_OPERATION_TYPES = ['INVENTORY_SURPLUS', 'INVENTORY_SHORTAGE', 'LOCATION_CORRECTION', 'STATUS_CORRECTION', 'BATCH_CORRECTION', 'SERIAL_CORRECTION'] as const;

export const ATTACHMENT_KINDS = ['PHOTO', 'SIGNED_COUNT_SHEET', 'INCIDENT_REPORT', 'INVESTIGATION_DOCUMENT', 'EMPLOYEE_EXPLANATION', 'SCANNED_FORM', 'OTHER'] as const;

/** Default variance reason catalog (spec section 45) — provisioned per
 * tenant on first use; tenants can add their own codes. */
export const DEFAULT_REASON_CODES: { code: string; name: string }[] = [
  { code: 'counting_error', name: 'Counting error' },
  { code: 'document_not_posted', name: 'Document not posted' },
  { code: 'wrong_location', name: 'Wrong location' },
  { code: 'wrong_batch', name: 'Wrong batch' },
  { code: 'unrecorded_receipt', name: 'Unrecorded receipt' },
  { code: 'unrecorded_issue', name: 'Unrecorded issue' },
  { code: 'theft', name: 'Theft' },
  { code: 'damage', name: 'Damage' },
  { code: 'expiry', name: 'Expiry' },
  { code: 'production_variance', name: 'Production variance' },
  { code: 'data_migration', name: 'Data migration' },
  { code: 'packaging_conversion_error', name: 'Packaging conversion error' },
  { code: 'serial_mismatch', name: 'Serial mismatch' },
  { code: 'unknown', name: 'Unknown' },
  { code: 'other', name: 'Other' },
];

/** Session statuses in which counting input is still accepted. */
export const COUNTING_STATUSES = ['SNAPSHOT_CREATED', 'COUNTING'];
/** Session statuses that count as "open" for month-close / health checks. */
export const OPEN_SESSION_STATUSES = ['READY', 'SNAPSHOT_CREATED', 'COUNTING', 'RECOUNT_REQUIRED', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'RECONCILED'];

/** Semantic accounting-mapping keys Phase 12 resolves first; each falls
 * back to the generic key when a tenant has not configured the specific
 * one (never a literal account code). */
export const InventoryCountMappingKeys = {
  SURPLUS_INCOME: 'INVENTORY_SURPLUS_INCOME',
  SHORTAGE_EXPENSE: 'INVENTORY_SHORTAGE_EXPENSE',
  SHORTAGE_RECOVERABLE: 'INVENTORY_SHORTAGE_RECOVERABLE',
} as const;

export interface StockKeyParts {
  warehouseId: string;
  locationId?: string | null;
  productId?: string | null;
  characteristicId?: string | null;
  batchId?: string | null;
  serialId?: string | null;
  serialNumberText?: string | null;
  ownershipType?: string | null;
  ownerCounterpartyId?: string | null;
  stockStatus?: string | null;
}

/**
 * The reconciliation dimension key (spec sections 8, 26-28, 31). Every
 * snapshot row, count entry and variance is keyed by the same full tuple,
 * so batch/location/ownership/status mismatches can never be netted away.
 */
export function stockLineKey(p: StockKeyParts): string {
  const serial = p.serialId ? p.serialId : p.serialNumberText ? `sn:${p.serialNumberText}` : '-';
  return [
    p.warehouseId,
    p.locationId || '-',
    p.productId || '-',
    p.characteristicId || '-',
    p.batchId || '-',
    serial,
    p.ownershipType || 'OWN',
    p.ownerCounterpartyId || '-',
    p.stockStatus || 'AVAILABLE',
  ].join('|');
}

export function dec(value: Decimal.Value | { toString(): string } | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(typeof value === 'object' ? value.toString() : value);
}

export function decOrNull(value: Decimal.Value | { toString(): string } | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  return new Decimal(typeof value === 'object' ? value.toString() : value);
}
