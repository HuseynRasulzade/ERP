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
