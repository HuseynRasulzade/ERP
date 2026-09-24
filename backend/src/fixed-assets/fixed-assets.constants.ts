import Decimal from 'decimal.js';

/** Valuation books (spec section 23). Cost movements are always written to
 * ACCOUNTING_BOOK and shared by every book; depreciation / impairment
 * movements are book-specific. Only ACCOUNTING_BOOK posts to the GL. */
export const Books = {
  ACCOUNTING_BOOK: 'ACCOUNTING_BOOK',
  TAX_BOOK: 'TAX_BOOK',
  MANAGEMENT_BOOK: 'MANAGEMENT_BOOK',
} as const;
export const BOOK_CODES = Object.values(Books);

/** Asset lifecycle status (spec section 16). Acceptance, commissioning,
 * depreciation, modernization, impairment and disposal each have their OWN
 * documents; this single status only describes where the asset is in its
 * lifecycle (section 3: never mix the concepts into one field). */
export const AssetStatus = {
  ACQUISITION: 'ACQUISITION',
  UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION',
  ACCEPTED: 'ACCEPTED',
  NOT_COMMISSIONED: 'NOT_COMMISSIONED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CONSERVED: 'CONSERVED',
  UNDER_MODERNIZATION: 'UNDER_MODERNIZATION',
  IMPAIRED: 'IMPAIRED',
  HELD_FOR_SALE: 'HELD_FOR_SALE',
  PARTIALLY_DISPOSED: 'PARTIALLY_DISPOSED',
  DISPOSED: 'DISPOSED',
  WRITTEN_OFF: 'WRITTEN_OFF',
} as const;

/** Statuses of an asset that is in use (commissioned, not closed). */
export const IN_USE_STATUSES: string[] = [
  AssetStatus.ACTIVE,
  AssetStatus.SUSPENDED,
  AssetStatus.CONSERVED,
  AssetStatus.UNDER_MODERNIZATION,
  AssetStatus.IMPAIRED,
  AssetStatus.HELD_FOR_SALE,
  AssetStatus.PARTIALLY_DISPOSED,
];
export const CLOSED_STATUSES: string[] = [AssetStatus.DISPOSED, AssetStatus.WRITTEN_OFF];
export const RECOGNIZED_STATUSES: string[] = [AssetStatus.ACCEPTED, AssetStatus.NOT_COMMISSIONED, ...IN_USE_STATUSES];

export const CandidateStatus = {
  NEW: 'NEW',
  UNDER_REVIEW: 'UNDER_REVIEW',
  CAPITALIZABLE: 'CAPITALIZABLE',
  EXPENSE: 'EXPENSE',
  ASSIGNED_TO_CIP: 'ASSIGNED_TO_CIP',
  ASSIGNED_TO_ASSET: 'ASSIGNED_TO_ASSET',
  CAPITALIZED: 'CAPITALIZED',
  CANCELLED: 'CANCELLED',
} as const;
/** Candidate statuses whose amount still sits on the FA_CIP clearing
 * account without being in the CIP register or an asset's cost yet. */
export const CANDIDATE_PENDING_STATUSES: string[] = [
  CandidateStatus.NEW,
  CandidateStatus.UNDER_REVIEW,
  CandidateStatus.CAPITALIZABLE,
];

export const CandidateDecision = {
  CAPITALIZE: 'CAPITALIZE',
  EXPENSE: 'EXPENSE',
  SPLIT: 'SPLIT',
  ASSIGN_TO_CIP: 'ASSIGN_TO_CIP',
  ASSIGN_TO_ASSET: 'ASSIGN_TO_ASSET',
  UNDER_REVIEW: 'UNDER_REVIEW',
} as const;

export const CipStatus = {
  PLANNED: 'PLANNED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  READY_FOR_CAPITALIZATION: 'READY_FOR_CAPITALIZATION',
  CAPITALIZED: 'CAPITALIZED',
  CANCELLED: 'CANCELLED',
} as const;

/** Cost components (spec section 9). */
export const COST_COMPONENTS = [
  'PURCHASE_PRICE',
  'CONSTRUCTION',
  'INSTALLATION',
  'FREIGHT',
  'CUSTOMS',
  'IMPORT_DUTY',
  'NON_RECOVERABLE_TAX',
  'ENGINEERING',
  'PROFESSIONAL_FEES',
  'TESTING',
  'DIRECT_LABOR',
  'BORROWING_COST',
  'DISCOUNT_REBATE',
  'TRAINING',
  'REPAIR',
  'OTHER_CAPITALIZABLE',
] as const;

/** Default non-capitalizable components when no policy row says otherwise
 * (spec section 10: "Training -> expense"). A tenant overrides it through
 * FixedAssetPolicy.nonCapitalizableCostComponents. */
export const DEFAULT_NON_CAPITALIZABLE_COMPONENTS = ['TRAINING', 'REPAIR'];

export const MovementType = {
  INITIAL_RECOGNITION: 'INITIAL_RECOGNITION',
  CAPITALIZATION: 'CAPITALIZATION',
  COMMISSIONING: 'COMMISSIONING',
  PARAMETER_CHANGE: 'PARAMETER_CHANGE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  DEPRECIATION: 'DEPRECIATION',
  DEPRECIATION_REVERSAL: 'DEPRECIATION_REVERSAL',
  MODERNIZATION: 'MODERNIZATION',
  IMPAIRMENT: 'IMPAIRMENT',
  IMPAIRMENT_REVERSAL: 'IMPAIRMENT_REVERSAL',
  REVALUATION_INCREASE: 'REVALUATION_INCREASE',
  REVALUATION_DECREASE: 'REVALUATION_DECREASE',
  PARTIAL_DISPOSAL: 'PARTIAL_DISPOSAL',
  FULL_DISPOSAL: 'FULL_DISPOSAL',
  WRITE_OFF: 'WRITE_OFF',
  TRANSFER: 'TRANSFER',
  OPENING_BALANCE: 'OPENING_BALANCE',
  REVERSAL: 'REVERSAL',
} as const;

export const FaDocumentType = {
  ACCEPTANCE: 'FA_ACCEPTANCE',
  COMMISSIONING: 'FA_COMMISSIONING',
  PARAMETER_CHANGE: 'FA_PARAMETER_CHANGE',
  TRANSFER: 'FA_TRANSFER',
  MODERNIZATION: 'FA_MODERNIZATION',
  REPAIR: 'FA_REPAIR',
  STATUS_CHANGE: 'FA_STATUS_CHANGE',
  IMPAIRMENT: 'FA_IMPAIRMENT',
  IMPAIRMENT_REVERSAL: 'FA_IMPAIRMENT_REVERSAL',
  REVALUATION: 'FA_REVALUATION',
  DISPOSAL: 'FA_DISPOSAL',
  OPENING_BALANCE: 'FA_OPENING_BALANCE',
} as const;
export const FA_DOCUMENT_TYPES = Object.values(FaDocumentType) as string[];

/** Source-document types used on journal entries / movements written by
 * non-FixedAssetDocument operations. */
export const FaSourceType = {
  CANDIDATE: 'FA_ACQUISITION_CANDIDATE',
  CIP_PROJECT: 'CAPITAL_INVESTMENT_PROJECT',
  DEPRECIATION_RUN: 'FA_DEPRECIATION_RUN',
  INVENTORY_COUNT: 'FA_INVENTORY_COUNT',
} as const;

export const NUMBER_PREFIX: Record<string, string> = {
  FIXED_ASSET: 'FA',
  FIXED_ASSET_INVENTORY_NUMBER: 'INV',
  FA_CANDIDATE: 'FAC',
  FA_DEPRECIATION_RUN: 'FAD',
  FA_INVENTORY_COUNT: 'FAI',
  FA_ACCEPTANCE: 'FAA',
  FA_COMMISSIONING: 'FAK',
  FA_PARAMETER_CHANGE: 'FAP',
  FA_TRANSFER: 'FAT',
  FA_MODERNIZATION: 'FAM',
  FA_REPAIR: 'FAR',
  FA_STATUS_CHANGE: 'FAS',
  FA_IMPAIRMENT: 'FAIM',
  FA_IMPAIRMENT_REVERSAL: 'FAIR',
  FA_REVALUATION: 'FARV',
  FA_DISPOSAL: 'FADS',
  FA_OPENING_BALANCE: 'FAOB',
};

export const DepreciationStartRule = {
  FROM_COMMISSIONING_DATE: 'FROM_COMMISSIONING_DATE',
  NEXT_DAY: 'NEXT_DAY',
  NEXT_MONTH: 'NEXT_MONTH',
  FIRST_DAY_NEXT_MONTH: 'FIRST_DAY_NEXT_MONTH',
  LOCALIZATION_DEFINED: 'LOCALIZATION_DEFINED',
} as const;

export const PartialPeriodRule = {
  FULL_MONTH: 'FULL_MONTH',
  DAILY_PRORATA: 'DAILY_PRORATA',
  HALF_MONTH: 'HALF_MONTH',
  LOCALIZATION_RULE: 'LOCALIZATION_RULE',
} as const;

export const DepreciationMethod = {
  STRAIGHT_LINE: 'STRAIGHT_LINE',
  DECLINING_BALANCE: 'DECLINING_BALANCE',
  DOUBLE_DECLINING: 'DOUBLE_DECLINING',
  SUM_OF_YEARS_DIGITS: 'SUM_OF_YEARS_DIGITS',
  UNITS_OF_PRODUCTION: 'UNITS_OF_PRODUCTION',
  MANUAL: 'MANUAL',
  TAX_METHOD: 'TAX_METHOD',
} as const;

export const DisposalType = {
  SALE: 'SALE',
  WRITE_OFF: 'WRITE_OFF',
  SCRAP: 'SCRAP',
  DONATION: 'DONATION',
  LOSS: 'LOSS',
  THEFT: 'THEFT',
  TRANSFER_OUT: 'TRANSFER_OUT',
  PARTIAL_DISPOSAL: 'PARTIAL_DISPOSAL',
  COMPONENT_REPLACEMENT: 'COMPONENT_REPLACEMENT',
} as const;
/** Disposal types that end in WRITTEN_OFF rather than DISPOSED. */
export const WRITE_OFF_DISPOSAL_TYPES: string[] = [DisposalType.WRITE_OFF, DisposalType.SCRAP, DisposalType.LOSS, DisposalType.THEFT];

export const PartialDisposalMethod = {
  SPECIFIC_COMPONENT: 'SPECIFIC_COMPONENT',
  PROPORTIONAL_COST: 'PROPORTIONAL_COST',
  PROPORTIONAL_AREA: 'PROPORTIONAL_AREA',
  MANUAL_APPROVED: 'MANUAL_APPROVED',
} as const;

export const ExpenseType = {
  ADMINISTRATIVE: 'ADMINISTRATIVE',
  SALES: 'SALES',
  PRODUCTION: 'PRODUCTION',
  OTHER: 'OTHER',
} as const;

export const InventoryResult = {
  PENDING: 'PENDING',
  FOUND: 'FOUND',
  MISSING: 'MISSING',
  WRONG_LOCATION: 'WRONG_LOCATION',
  WRONG_RESPONSIBLE_PERSON: 'WRONG_RESPONSIBLE_PERSON',
  DAMAGED: 'DAMAGED',
  UNREGISTERED_ASSET: 'UNREGISTERED_ASSET',
} as const;

export const ZERO = new Decimal(0);

export function dec(value: unknown): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal((value as { toString(): string }).toString());
}

/** 'YYYY-MM-DD' (or Date) -> UTC midnight Date. */
export function toDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const s = value.length >= 10 ? value.slice(0, 10) : value;
  return new Date(`${s}T00:00:00.000Z`);
}

export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodBounds(period: string): { start: Date; end: Date; days: number } {
  const [y, m] = period.split('-').map((x) => Number(x));
  if (!y || !m || m < 1 || m > 12) throw new Error(`Invalid period ${period}`);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start, end, days: end.getUTCDate() };
}

export function previousPeriod(period: string): string {
  const { start } = periodBounds(period);
  return periodOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
}

export function nextPeriod(period: string): string {
  const { start } = periodBounds(period);
  return periodOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function formatAmount(v: Decimal.Value): string {
  return new Decimal(v).toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPeriodLabel(period: string): string {
  const { start } = periodBounds(period);
  return start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
