import { ALL_PERMISSION_CODES } from '../rbac/permission-codes';

export const SYSTEM_ROLE_TENANT_ADMIN = 'TENANT_ADMIN';

export const SEED_CURRENCIES = [
  { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', decimalPlaces: 2, numericCode: '944' },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, numericCode: '840' },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2, numericCode: '978' },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', decimalPlaces: 2, numericCode: '826' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimalPlaces: 2, numericCode: '643' },
];

export const SEED_PERMISSIONS = ALL_PERMISSION_CODES;

export const SEED_ENUM_TYPES: Record<string, { code: string; labels: { en: string; az: string } }[]> = {
  DOCUMENT_STATUS: [
    { code: 'DRAFT', labels: { en: 'Draft', az: 'Qaralama' } },
    { code: 'ACTIVE', labels: { en: 'Active', az: 'Aktiv' } },
    { code: 'CANCELLED', labels: { en: 'Cancelled', az: 'Ləğv edilib' } },
    { code: 'DELETION_MARKED', labels: { en: 'Marked for deletion', az: 'Silinməyə işarələnib' } },
  ],
  POSTING_STATUS: [
    { code: 'NOT_POSTED', labels: { en: 'Not posted', az: 'Keçirilməyib' } },
    { code: 'POSTED', labels: { en: 'Posted', az: 'Keçirilib' } },
    { code: 'POSTING_FAILED', labels: { en: 'Posting failed', az: 'Keçirmə uğursuz oldu' } },
  ],
  PERIOD_STATUS: [
    { code: 'OPEN', labels: { en: 'Open', az: 'Açıq' } },
    { code: 'SOFT_CLOSED', labels: { en: 'Soft closed', az: 'Qismən bağlı' } },
    { code: 'CLOSED', labels: { en: 'Closed', az: 'Bağlı' } },
  ],
  APPROVAL_STATUS: [
    { code: 'NOT_REQUIRED', labels: { en: 'Not required', az: 'Tələb olunmur' } },
    { code: 'PENDING', labels: { en: 'Pending', az: 'Gözləmədə' } },
    { code: 'APPROVED', labels: { en: 'Approved', az: 'Təsdiqlənib' } },
    { code: 'REJECTED', labels: { en: 'Rejected', az: 'Rədd edilib' } },
  ],
  CURRENCY_RATE_TYPE: [
    { code: 'OFFICIAL', labels: { en: 'Official', az: 'Rəsmi' } },
    { code: 'MANUAL', labels: { en: 'Manual', az: 'Manual' } },
    { code: 'AVERAGE', labels: { en: 'Average', az: 'Orta' } },
  ],
  NUMBER_SEQUENCE_RESET_POLICY: [
    { code: 'NEVER', labels: { en: 'Never', az: 'Heç vaxt' } },
    { code: 'YEARLY', labels: { en: 'Yearly', az: 'İllik' } },
    { code: 'MONTHLY', labels: { en: 'Monthly', az: 'Aylıq' } },
  ],
  // Phase 1 — kept extensible per spec section 11/18: new codes can be
  // seeded later without a schema change (warehouseType/inventoryCostingMethod
  // are free-text columns, not native Prisma enums).
  WAREHOUSE_TYPE: [
    { code: 'STANDARD', labels: { en: 'Standard', az: 'Standart' } },
    { code: 'RETAIL', labels: { en: 'Retail', az: 'Pərakəndə' } },
    { code: 'TRANSIT', labels: { en: 'Transit', az: 'Tranzit' } },
    { code: 'PRODUCTION', labels: { en: 'Production', az: 'İstehsalat' } },
    { code: 'RESPONSIBLE_STORAGE', labels: { en: 'Responsible storage', az: 'Məsul saxlama' } },
  ],
  INVENTORY_COSTING_METHOD: [
    { code: 'FIFO', labels: { en: 'FIFO', az: 'FIFO' } },
    { code: 'WEIGHTED_AVERAGE', labels: { en: 'Weighted average', az: 'Orta çəkili' } },
  ],
  ACCOUNTING_POLICY_STATUS: [
    { code: 'DRAFT', labels: { en: 'Draft', az: 'Qaralama' } },
    { code: 'ACTIVE', labels: { en: 'Active', az: 'Aktiv' } },
    { code: 'ARCHIVED', labels: { en: 'Archived', az: 'Arxivləşdirilib' } },
  ],
  BANK_ACCOUNT_TYPE: [
    { code: 'CURRENT', labels: { en: 'Current', az: 'Cari' } },
    { code: 'SAVINGS', labels: { en: 'Savings', az: 'Əmanət' } },
    { code: 'LOAN', labels: { en: 'Loan', az: 'Kredit' } },
  ],
  ORGANIZATION_ACCESS_LEVEL: [
    { code: 'FULL', labels: { en: 'Full access', az: 'Tam giriş' } },
    { code: 'READ', labels: { en: 'Read only', az: 'Yalnız oxumaq' } },
  ],
  // Phase 2 — Product/Nomenclature master data
  UNIT_TYPE: [
    { code: 'QUANTITY', labels: { en: 'Quantity', az: 'Miqdar' } },
    { code: 'WEIGHT', labels: { en: 'Weight', az: 'Çəki' } },
    { code: 'VOLUME', labels: { en: 'Volume', az: 'Həcm' } },
    { code: 'LENGTH', labels: { en: 'Length', az: 'Uzunluq' } },
    { code: 'AREA', labels: { en: 'Area', az: 'Sahə' } },
    { code: 'TIME', labels: { en: 'Time', az: 'Vaxt' } },
  ],
  PRODUCT_TYPE: [
    { code: 'GOODS', labels: { en: 'Goods', az: 'Mallar' } },
    { code: 'SERVICE', labels: { en: 'Service', az: 'Xidmət' } },
    { code: 'WORK', labels: { en: 'Work', az: 'İş' } },
    { code: 'SET', labels: { en: 'Set', az: 'Dəst' } },
  ],
  // Phase 3 — Counterparty Master Data + Pricing
  COUNTERPARTY_TYPE: [
    { code: 'CUSTOMER', labels: { en: 'Customer', az: 'Müştəri' } },
    { code: 'SUPPLIER', labels: { en: 'Supplier', az: 'Təchizatçı' } },
    { code: 'BOTH', labels: { en: 'Customer & Supplier', az: 'Müştəri və Təchizatçı' } },
  ],
  COUNTERPARTY_ADDRESS_TYPE: [
    { code: 'LEGAL', labels: { en: 'Legal', az: 'Hüquqi' } },
    { code: 'SHIPPING', labels: { en: 'Shipping', az: 'Çatdırılma' } },
    { code: 'BILLING', labels: { en: 'Billing', az: 'Ödəniş' } },
    { code: 'OTHER', labels: { en: 'Other', az: 'Digər' } },
  ],
  PRICE_LIST_TYPE: [
    { code: 'SALE', labels: { en: 'Sale', az: 'Satış' } },
    { code: 'PURCHASE', labels: { en: 'Purchase', az: 'Alış' } },
  ],
};
