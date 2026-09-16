import { ALL_PERMISSION_CODES, PermissionCodes } from '../rbac/permission-codes';

export const SYSTEM_ROLE_TENANT_ADMIN = 'TENANT_ADMIN';

// Approval workflow MVP demo tenant/org — see docs/APPROVALS.md. Recreated
// idempotently by name (code) rather than a hardcoded id, since a fresh
// dev database won't have it yet.
export const DEMO_TENANT_CODE = 'acme';
export const DEMO_ORG_CODE = 'sinteks';
export const DEMO_DEPARTMENT_CODE = 'PROCUREMENT';

/** Curated, tenant-scoped roles for the approval workflow MVP (and a few
 * inert placeholders for named roles the wider spec asks for, holding only
 * permissions that already exist today — ready for a future increment). */
export const SEED_APPROVAL_ROLES: { code: string; name: string; permissions: string[] }[] = [
  {
    code: 'PROCUREMENT_OFFICER',
    name: 'Procurement Officer',
    permissions: [
      PermissionCodes.PURCHASE_REQUIREMENT_VIEW,
      PermissionCodes.PURCHASE_ORDER_VIEW,
      PermissionCodes.PURCHASE_ORDER_CREATE,
      PermissionCodes.PURCHASE_ORDER_EDIT,
      PermissionCodes.PURCHASE_ORDER_APPROVE,
      PermissionCodes.PURCHASE_VIEW,
      PermissionCodes.PURCHASE_CREATE,
      PermissionCodes.DOCUMENTS_VIEW,
    ],
  },
  {
    code: 'DEPARTMENT_HEAD',
    name: 'Department Head',
    permissions: [
      PermissionCodes.PURCHASE_REQUIREMENT_VIEW,
      PermissionCodes.PURCHASE_REQUIREMENT_APPROVE,
      PermissionCodes.PURCHASE_REQUIREMENT_REJECT,
      PermissionCodes.PURCHASE_ORDER_VIEW,
      PermissionCodes.PURCHASE_ORDER_APPROVE,
      PermissionCodes.PURCHASE_ORDER_REJECT,
      PermissionCodes.DOCUMENTS_VIEW,
      PermissionCodes.AUDIT_VIEW,
    ],
  },
  {
    code: 'DIRECTOR',
    name: 'Director',
    permissions: [
      PermissionCodes.PURCHASE_REQUIREMENT_VIEW,
      PermissionCodes.PURCHASE_ORDER_VIEW,
      PermissionCodes.PURCHASE_ORDER_APPROVE,
      PermissionCodes.PURCHASE_ORDER_REJECT,
      PermissionCodes.DOCUMENTS_VIEW,
      PermissionCodes.AUDIT_VIEW,
    ],
  },
  {
    code: 'FINANCE_USER',
    name: 'Finance',
    permissions: [
      PermissionCodes.PURCHASE_ORDER_VIEW,
      PermissionCodes.PURCHASE_ORDER_APPROVE,
      PermissionCodes.PURCHASE_ORDER_REJECT,
      PermissionCodes.PURCHASE_PAYMENT_SCHEDULE_VIEW,
      PermissionCodes.DOCUMENTS_VIEW,
    ],
  },
  {
    code: 'ACCOUNTING_USER',
    name: 'Accounting',
    permissions: [
      PermissionCodes.PURCHASE_ORDER_VIEW,
      PermissionCodes.PURCHASE_ORDER_APPROVE,
      PermissionCodes.PURCHASE_ORDER_REJECT,
      PermissionCodes.PURCHASE_VIEW_ACCOUNTING,
      PermissionCodes.ACCOUNTING_JOURNAL_VIEW,
      PermissionCodes.DOCUMENTS_VIEW,
    ],
  },
  // Inert placeholders (spec's wider named-role list) — view-only today,
  // ready for a future increment to extend.
  {
    code: 'WAREHOUSE_USER',
    name: 'Warehouse',
    permissions: [PermissionCodes.PURCHASE_VIEW, PermissionCodes.PURCHASE_CREATE, PermissionCodes.INVENTORY_VIEW, PermissionCodes.DOCUMENTS_VIEW],
  },
  {
    code: 'SALES_USER',
    name: 'Sales',
    permissions: [PermissionCodes.SALES_ORDER_VIEW, PermissionCodes.SALES_ORDER_CREATE, PermissionCodes.SALES_INVOICE_VIEW, PermissionCodes.DOCUMENTS_VIEW],
  },
  {
    code: 'SALES_MANAGER',
    name: 'Sales Manager',
    permissions: [PermissionCodes.SALES_ORDER_VIEW, PermissionCodes.SALES_ORDER_CREATE, PermissionCodes.SALES_ORDER_CONFIRM, PermissionCodes.SALES_INVOICE_VIEW, PermissionCodes.DOCUMENTS_VIEW],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    permissions: [
      PermissionCodes.AUDIT_VIEW,
      PermissionCodes.DOCUMENTS_VIEW,
      PermissionCodes.PURCHASE_REQUIREMENT_VIEW,
      PermissionCodes.PURCHASE_ORDER_VIEW,
      PermissionCodes.SALES_ORDER_VIEW,
      PermissionCodes.ACCOUNTING_JOURNAL_VIEW,
    ],
  },
];

export const SEED_DEMO_USERS: { email: string; password: string; displayName: string; roleCode: string; departmentCode?: string }[] = [
  { email: 'procurement_officer@acme.test', password: 'Passw0rd!23', displayName: 'Procurement Officer', roleCode: 'PROCUREMENT_OFFICER' },
  { email: 'department_head@acme.test', password: 'Passw0rd!23', displayName: 'Department Head', roleCode: 'DEPARTMENT_HEAD', departmentCode: DEMO_DEPARTMENT_CODE },
  { email: 'director@acme.test', password: 'Passw0rd!23', displayName: 'Director', roleCode: 'DIRECTOR' },
  { email: 'finance_user@acme.test', password: 'Passw0rd!23', displayName: 'Finance User', roleCode: 'FINANCE_USER' },
  { email: 'accounting_user@acme.test', password: 'Passw0rd!23', displayName: 'Accounting User', roleCode: 'ACCOUNTING_USER' },
  { email: 'warehouse_user@acme.test', password: 'Passw0rd!23', displayName: 'Warehouse User', roleCode: 'WAREHOUSE_USER' },
  { email: 'sales_manager@acme.test', password: 'Passw0rd!23', displayName: 'Sales Manager', roleCode: 'SALES_MANAGER' },
  { email: 'auditor@acme.test', password: 'Passw0rd!23', displayName: 'Auditor', roleCode: 'AUDITOR' },
];

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
