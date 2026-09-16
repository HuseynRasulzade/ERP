export interface Me {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  isSystemAdmin: boolean;
}

export interface MyTenant {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  membershipId: string;
  status: string;
}

export interface Tenant {
  id: string;
  code: string;
  name: string;
  legalName?: string | null;
  baseCurrencyId?: string | null;
  timezone: string;
  locale: string;
  status: string;
}

export type DocumentStatus = 'DRAFT' | 'ACTIVE' | 'CANCELLED' | 'DELETION_MARKED';
export type PostingStatus = 'NOT_POSTED' | 'POSTED' | 'POSTING_FAILED';

export interface FoundationTestDocument {
  id: string;
  tenantId: string;
  organizationId: string | null;
  documentType: string;
  number: string | null;
  documentDate: string;
  postingDate: string | null;
  status: DocumentStatus;
  postingStatus: PostingStatus;
  currencyId: string | null;
  amount: string;
  description: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  postedAt: string | null;
  postedBy: string | null;
  cancelledAt: string | null;
  version: number;
}

export interface AccountingPeriod {
  id: string;
  tenantId: string;
  organizationId: string | null;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'SOFT_CLOSED' | 'CLOSED';
  closedAt: string | null;
  reopenedAt: string | null;
  version: number;
}

export interface AuditEvent {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string | null;
  timestamp: string;
  oldValues: unknown;
  newValues: unknown;
  reason: string | null;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: { code: string; description: string | null; module: string } }[];
}

export interface Permission {
  id: string;
  code: string;
  description: string | null;
  module: string;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
}

export interface DocumentLink {
  id: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  targetDocumentType: string;
  targetDocumentId: string;
  relationType: string;
  createdAt: string;
}

export interface ApprovalStep {
  id: string;
  documentType: string;
  documentId: string;
  sequence: number;
  stepType: 'PROCUREMENT_OFFICER' | 'DEPARTMENT_HEAD' | 'DIRECTOR' | 'FINANCE' | 'ACCOUNTING';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  approvedBy: string | null;
  approvedAt: string | null;
  comment: string | null;
}

// ---------------------------------------------------------------------------
// Phase 1 — Organization & Business Structure
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  fullLegalName: string | null;
  shortName: string | null;
  legalForm: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  countryCode: string;
  registeredAddress: string | null;
  actualAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  baseCurrencyId: string | null;
  timezone: string;
  locale: string;
  active: boolean;
  defaultBranchId: string | null;
  defaultWarehouseId: string | null;
  defaultCashboxId: string | null;
  defaultBankAccountId: string | null;
  version: number;
}

export interface Branch {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  managerPersonId: string | null;
  active: boolean;
  version: number;
}

export interface Department {
  id: string;
  organizationId: string;
  branchId: string | null;
  parentDepartmentId: string | null;
  code: string;
  name: string;
  managerPersonId: string | null;
  active: boolean;
  version: number;
}

export interface ResponsiblePerson {
  id: string;
  tenantId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  active: boolean;
  notes: string | null;
  version: number;
}

export interface Warehouse {
  id: string;
  organizationId: string;
  branchId: string | null;
  code: string;
  name: string;
  warehouseType: string;
  address: string | null;
  responsiblePersonId: string | null;
  allowNegativeStock: boolean;
  active: boolean;
  version: number;
}

export interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  unitType: string;
  description: string | null;
  active: boolean;
  version: number;
}

export interface ProductCategory {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  parentCategoryId: string | null;
  description: string | null;
  active: boolean;
  version: number;
}

export interface Product {
  id: string;
  organizationId: string;
  categoryId: string | null;
  code: string;
  name: string;
  fullName: string | null;
  productType: string;
  baseUnitId: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  manufacturer: string | null;
  brand: string | null;
  model: string | null;
  trackInventory: boolean;
  allowNegativeStock: boolean;
  batchTrackingMode: string;
  serialTrackingMode: string;
  active: boolean;
  version: number;
}

export interface Cashbox {
  id: string;
  organizationId: string;
  branchId: string | null;
  code: string;
  name: string;
  currencyId: string;
  responsiblePersonId: string | null;
  active: boolean;
  version: number;
}

export interface BankAccount {
  id: string;
  organizationId: string;
  bankName: string;
  bankCode: string | null;
  branchName: string | null;
  accountName: string;
  iban: string;
  swiftBic: string | null;
  currencyId: string;
  accountType: string;
  isDefault: boolean;
  active: boolean;
  openedDate: string | null;
  closedDate: string | null;
  version: number;
}

export interface AccountingPolicy {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  status: string;
  inventoryCostingMethod: string;
  active: boolean;
  version: number;
}

export interface TaxProfile {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  countryCode: string;
  taxId: string | null;
  vatRegistered: boolean;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  version: number;
}

export interface OrganizationAccessGrant {
  id: string;
  tenantMembershipId: string;
  organizationId: string;
  accessLevel: string;
  membership?: { user: { email: string; displayName: string } };
}

// ---------------------------------------------------------------------------
// Phase 4 — Sales documents (orders + invoices)
// ---------------------------------------------------------------------------

export interface SalesDocumentLine {
  id: string;
  tenantId: string;
  salesOrderId?: string;
  salesInvoiceId?: string;
  position: number;
  productId: string;
  unitId: string;
  quantity: string;
  price: string;
  lineTotal: string;
  taxRate: string;
  taxAmount: string;
  lineTotalWithTax: string;
  priceListId: string | null;
  productPriceId: string | null;
  sourceOrderLineId?: string | null;
  description: string | null;
}

export interface SalesOrder {
  id: string;
  tenantId: string;
  organizationId: string;
  counterpartyId: string;
  documentType: string;
  number: string | null;
  documentDate: string;
  postingDate: string | null;
  status: DocumentStatus;
  postingStatus: PostingStatus;
  currencyId: string | null;
  exchangeRate: string;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  priceIncludesTax: boolean;
  description: string | null;
  createdAt: string;
  postedAt: string | null;
  version: number;
  lines?: SalesDocumentLine[];
}

export type SalesInvoice = SalesOrder;

// Minimal reference shapes for sales dropdowns (full master-data screens
// are out of scope — only id/code/name (+ base unit / type) are needed here).
export interface SalesProductRef {
  id: string;
  code: string;
  name: string;
  baseUnitId: string;
}

export interface SalesCounterpartyRef {
  id: string;
  code: string;
  name: string;
  counterpartyType: string;
}

// ---------------------------------------------------------------------------
// "Kontragentlər" — Counterparty CRM (residency/VAT/approval, bank accounts,
// contacts, contracts, amendments, documents).

export type CounterpartyStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface CounterpartyAddress {
  id: string;
  addressType: 'LEGAL' | 'ACTUAL' | 'SHIPPING' | 'BILLING' | 'OTHER';
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string | null;
  postalCode: string | null;
  countryCode: string;
  isDefault: boolean;
  active: boolean;
  version: number;
}

export interface CounterpartyContact {
  id: string;
  counterpartyId: string;
  firstName: string;
  lastName: string;
  position: string | null;
  department: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
  active: boolean;
  version: number;
}

export interface CounterpartyBankAccount {
  id: string;
  counterpartyId: string;
  bankName: string;
  bankTaxId: string | null;
  bankCode: string | null;
  bankAddress: string | null;
  accountNumber: string;
  iban: string | null;
  swiftBic: string | null;
  correspondentAccount: string | null;
  currencyId: string | null;
  branchName: string | null;
  isPrimary: boolean;
  notes: string | null;
  active: boolean;
  version: number;
}

export interface Counterparty {
  id: string;
  organizationId: string;
  counterpartyType: string;
  code: string;
  name: string;
  fullLegalName: string | null;
  residencyStatus: 'RESIDENT' | 'NON_RESIDENT';
  taxId: string | null;
  foreignTaxId: string | null;
  vatPayer: boolean;
  countryCode: string | null;
  registrationNumber: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  paymentTerms: number | null;
  creditLimit: string | null;
  currencyId: string | null;
  notes: string | null;
  status: CounterpartyStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  active: boolean;
  version: number;
  createdAt: string;
  addresses?: CounterpartyAddress[];
  contacts?: CounterpartyContact[];
  bankAccounts?: CounterpartyBankAccount[];
}

export interface CounterpartyContractAmendment {
  id: string;
  contractId: string;
  number: string;
  subject: string;
  amendmentDate: string | null;
  effectiveDate: string | null;
  endDate: string | null;
  newAmount: string | null;
  currencyId: string | null;
  changeDescription: string | null;
  notes: string | null;
  status: CounterpartyStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  version: number;
}

export interface CounterpartyContractLine {
  id: string;
  contractId: string;
  position: number;
  productId: string;
  description: string | null;
  quantity: string;
  unitId: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  lineAmount: string;
  taxBase: string;
  taxCategoryCode: string | null;
  taxRatePercent: string | null;
  taxAmount: string | null;
  lineTotal: string | null;
  taxCalculationError: string | null;
  sourceOrderLineId: string | null;
  sourcePoTaxRatePercent: string | null;
  sourcePoTaxAmount: string | null;
  taxMismatch: boolean;
  sourceChain?: {
    purchaseOrderId: string;
    purchaseOrderNumber: string | null;
    purchaseOrderLineId: string;
    purchaseRequirementId: string | null;
    purchaseRequirementNumber: string | null;
    purchaseRequirementLineId: string | null;
  };
  version: number;
}

export interface CounterpartyContractPaymentInstallment {
  id: string;
  contractId: string;
  sequence: number;
  dueDate: string;
  basis: string;
  percentage: string | null;
  amount: string;
  currencyId: string | null;
  status: string;
}

export interface CounterpartyContract {
  id: string;
  organizationId: string;
  counterpartyId: string;
  number: string;
  subject: string;
  contractType: string | null;
  signedDate: string | null;
  startDate: string | null;
  endDate: string | null;
  amount: string | null;
  currencyId: string | null;
  paymentTerms: string | null;
  responsiblePersonId: string | null;
  notes: string | null;
  status: CounterpartyStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  version: number;
  amendments?: CounterpartyContractAmendment[];
  lines?: CounterpartyContractLine[];
  paymentInstallments?: CounterpartyContractPaymentInstallment[];

  // Commercial / delivery terms (spec section 10)
  hasAdvance: boolean;
  advancePercent: string | null;
  advanceAmount: string | null;
  advanceAmountManual: boolean;
  remainingPaymentDueDays: number | null;
  deliveryDate: string | null;
  deliveryTermDays: number | null;
  deliveryAddress: string | null;
  deliveryTerms: string | null;
  warrantyPeriod: string | null;
  penaltyTerms: string | null;
  otherTerms: string | null;
  priceIncludesTax: boolean;
  sourcePurchaseOrderId: string | null;
  linesDirty: boolean;
  subtotal: string | null;
  totalDiscount: string | null;
  totalTax: string | null;
  remainingPayableAmount: string | null;
}

export interface CounterpartyDocument {
  id: string;
  ownerType: 'CONTRACT' | 'CONTRACT_AMENDMENT';
  ownerId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  documentVersion: number;
  notes: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

export interface SalesUnitRef {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
}

export interface SalesLineDraft {
  productId: string;
  unitId: string;
  quantity: string;
  price: string;
  taxRate: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Phases 6-9 — Sales Pre-Order/Execution, Procurement, Purchase Execution.
// Loosely typed on purpose: these document shapes vary per kind (extra
// header fields, line source references, lineType) and the backend is
// already the source of truth for validation — the UI only needs to read
// common fields safely and pass the rest through untouched.
// ---------------------------------------------------------------------------

export interface BizLine {
  id?: string;
  position?: number;
  productId?: string;
  unitId?: string;
  quantity?: string;
  price?: string;
  taxRate?: string;
  lineTotal?: string;
  taxAmount?: string;
  lineTotalWithTax?: string;
  warehouseId?: string | null;
  description?: string | null;
  lineType?: string;
  reason?: string | null;
  [key: string]: unknown;
}

export interface BizDoc {
  id: string;
  number: string | null;
  documentDate: string;
  postingDate?: string | null;
  status: DocumentStatus;
  postingStatus: PostingStatus;
  approvalStatus?: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  counterpartyId?: string;
  currencyId?: string | null;
  warehouseId?: string | null;
  description: string | null;
  subtotal?: string;
  taxTotal?: string;
  grandTotal?: string;
  totalCost?: string;
  priceIncludesTax?: boolean;
  version: number;
  postedAt?: string | null;
  lines?: BizLine[];
  targetLines?: BizLine[];
  [key: string]: unknown;
}

export interface LineDraft {
  productId: string;
  unitId: string;
  quantity: string;
  price: string;
  taxRate: string;
  warehouseId: string;
  description: string;
  lineType: string;
  // Carried through untouched when editing an existing line (never set by
  // the user) so a requirement-sourced Purchase Order line keeps its
  // traceability link after a later manual price/tax edit.
  requirementLineId?: string;
  // Same passthrough for a Goods Receipt line sourced from a Purchase
  // Order line — required for the backend to resolve the PO price and
  // check remaining quantity when this line is re-saved.
  supplierOrderLineId?: string;
  // Requester's justification when this line's quantity exceeds the
  // source PO line's remaining quantity — see GoodsReceiptService.
  overReceiptReason?: string;
}
