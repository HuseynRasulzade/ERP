import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { Decimal } from '@prisma/client/runtime/library';

const VALID_TYPES = ['CUSTOMER', 'SUPPLIER', 'BOTH'];
const VALID_ADDRESS_TYPES = ['LEGAL', 'ACTUAL', 'SHIPPING', 'BILLING', 'OTHER'];
const VALID_RESIDENCY = ['RESIDENT', 'NON_RESIDENT'];
export const COUNTERPARTY_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'CANCELLED'];

export interface CounterpartyInput {
  counterpartyType: string;
  code: string;
  name: string;
  fullLegalName?: string;
  residencyStatus?: string;
  taxId?: string;
  foreignTaxId?: string;
  vatPayer?: boolean;
  countryCode?: string;
  registrationNumber?: string;
  phone?: string;
  email?: string;
  website?: string;
  paymentTerms?: number;
  creditLimit?: number | Decimal;
  currencyId?: string;
  notes?: string;
}

/**
 * Counterparty service (Phase 3, section 86-89 — extended by the
 * "Kontragentlər" module, see docs/COUNTERPARTY_MANAGEMENT.md, sections
 * 1-4, 8-9). Organization-scoped customer/supplier master data plus its
 * approval workflow, bank accounts, and contacts. Contracts and their
 * documents live in the sibling `counterparty-contracts` module — this
 * service stays the single source of truth for the counterparty row
 * itself so every existing caller (Sales/Purchase Execution, Procurement,
 * ...) keeps working against the exact same `create`/`get`/`list`
 * signatures it always has; new fields are purely additive and default
 * to values that never surface a completeness requirement until the new
 * `approve` command is actually called.
 */
@Injectable()
export class CounterpartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false, type?: string, status?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.counterparty.findMany({
      where: {
        organizationId,
        ...(includeInactive ? {} : { active: true }),
        ...(type ? { counterpartyType: type as any } : {}),
        ...(status ? { status } : {}),
      },
      include: { contacts: { where: { active: true, isPrimary: true }, take: 1 } },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: CounterpartyInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!VALID_TYPES.includes(input.counterpartyType)) throw new ValidationAppError(`Unknown type: ${input.counterpartyType}`);
    if (input.residencyStatus && !VALID_RESIDENCY.includes(input.residencyStatus)) {
      throw new ValidationAppError(`Unknown residency status: ${input.residencyStatus}`);
    }

    const existing = await this.prisma.counterparty.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Counterparty code already exists: ${input.code}`);

    if (input.taxId) {
      await this.assertTaxIdAvailable(organizationId, input.taxId);
    }

    if (input.currencyId) {
      const cur = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
      if (!cur) throw new ValidationAppError('Currency not found');
    }

    const cp = await this.prisma.counterparty.create({
      data: {
        tenantId, organizationId, createdBy: userId, updatedBy: userId,
        counterpartyType: input.counterpartyType as any, code: input.code, name: input.name,
        fullLegalName: input.fullLegalName,
        residencyStatus: input.residencyStatus ?? 'RESIDENT',
        taxId: input.taxId, foreignTaxId: input.foreignTaxId,
        vatPayer: input.vatPayer ?? false,
        countryCode: input.countryCode,
        registrationNumber: input.registrationNumber,
        phone: input.phone, email: input.email, website: input.website, paymentTerms: input.paymentTerms,
        creditLimit: input.creditLimit ? new Decimal(input.creditLimit.toString()) : null,
        currencyId: input.currencyId, notes: input.notes,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CREATED', entityType: 'Counterparty',
      entityId: cp.id, action: 'CREATE', userId, newValues: { code: cp.code },
    });
    return cp;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cp = await this.prisma.counterparty.findFirst({
      where: { id, organizationId },
      include: {
        addresses: { where: { active: true } },
        contacts: { where: { active: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        bankAccounts: { where: { active: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!cp) throw new NotFoundAppError('Counterparty', id);
    return cp;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: Partial<CounterpartyInput>) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.counterpartyType && !VALID_TYPES.includes(patch.counterpartyType)) {
      throw new ValidationAppError(`Unknown type: ${patch.counterpartyType}`);
    }
    if (patch.residencyStatus && !VALID_RESIDENCY.includes(patch.residencyStatus)) {
      throw new ValidationAppError(`Unknown residency status: ${patch.residencyStatus}`);
    }
    if (patch.taxId) {
      await this.assertTaxIdAvailable(organizationId, patch.taxId, id);
    }

    const updateData: any = { updatedBy: userId, version: { increment: 1 } };
    for (const k of Object.keys(patch)) {
      if (k === 'creditLimit' && patch.creditLimit !== undefined && patch.creditLimit !== null) {
        updateData.creditLimit = new Decimal((patch.creditLimit as number | string).toString());
      } else if (k === 'counterpartyType') {
        // Cast the validated string to the native Prisma enum so `updateMany`
        // data type-checks (create path casts the same way).
        updateData.counterpartyType = (patch as any)[k] as any;
      } else if ((patch as any)[k] !== undefined) updateData[k] = (patch as any)[k];
    }
    const result = await this.prisma.counterparty.updateMany({
      where: { id, organizationId, version: expectedVersion }, data: updateData,
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_UPDATED', entityType: 'Counterparty',
      entityId: id, action: 'UPDATE', userId, newValues: patch,
    });
    return this.prisma.counterparty.findUnique({ where: { id } });
  }

  async deactivate(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cp = await this.get(tenantId, membershipId, organizationId, id);
    if (!cp.active) throw new ValidationAppError('Counterparty is already inactive');

    const result = await this.prisma.counterparty.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_DEACTIVATED', entityType: 'Counterparty',
      entityId: id, action: 'DEACTIVATE', userId,
    });
    return this.prisma.counterparty.findUnique({ where: { id } });
  }

  /**
   * Approval gate (spec section 8): every mandatory "Ümumi məlumatlar"
   * field from section 2 must be present before a counterparty can leave
   * DRAFT/PENDING_APPROVAL. Missing fields are collected and returned
   * together (never fail-fast on the first one) so the UI can highlight
   * all of them at once — see `fieldErrors` on the thrown error.
   */
  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cp = await this.get(tenantId, membershipId, organizationId, id);
    if (cp.status === 'APPROVED' || cp.status === 'ACTIVE') throw new ValidationAppError(`Counterparty is already ${cp.status}`);
    if (cp.status === 'CANCELLED') throw new ValidationAppError('Cannot approve a cancelled counterparty');

    const missing = this.missingRequiredFields(cp);
    if (missing.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const f of missing) fieldErrors[f] = ['Required for approval'];
      throw new ValidationAppError(`Cannot approve — missing required fields: ${missing.join(', ')}`, fieldErrors);
    }

    const result = await this.prisma.counterparty.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_APPROVED', entityType: 'Counterparty',
      entityId: id, action: 'APPROVE', userId,
    });
    return this.prisma.counterparty.findUnique({ where: { id } });
  }

  /** Manual forward status transitions beyond approval (APPROVED->ACTIVE,
   * ACTIVE->EXPIRED, or ->CANCELLED from anywhere short of terminal) — no
   * date-driven automation in this build (disclosed simplification, see
   * docs/COUNTERPARTY_MANAGEMENT.md). */
  async setStatus(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, status: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!COUNTERPARTY_STATUSES.includes(status)) throw new ValidationAppError(`Unknown status: ${status}`);
    const cp = await this.get(tenantId, membershipId, organizationId, id);
    if (status !== 'CANCELLED' && (cp.status === 'DRAFT' || cp.status === 'PENDING_APPROVAL')) {
      throw new ValidationAppError('Approve the counterparty before changing its status further');
    }

    const result = await this.prisma.counterparty.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { status, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_STATUS_CHANGED', entityType: 'Counterparty',
      entityId: id, action: 'UPDATE', userId, newValues: { status },
    });
    return this.prisma.counterparty.findUnique({ where: { id } });
  }

  async addAddress(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, counterpartyId);
    if (!VALID_ADDRESS_TYPES.includes(input.addressType)) throw new ValidationAppError(`Unknown address type`);

    if (input.isDefault) {
      await this.prisma.counterpartyAddress.updateMany({
        where: { counterpartyId, addressType: input.addressType as any },
        data: { isDefault: false },
      });
    }
    const addr = await this.prisma.counterpartyAddress.create({
      data: { tenantId, counterpartyId, createdBy: userId, updatedBy: userId, ...input },
    });
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_ADDRESS_ADDED', entityType: 'Counterparty',
      entityId: counterpartyId, action: 'CREATE', userId, newValues: { addressId: addr.id },
    });
    return addr;
  }

  async addContact(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, counterpartyId);

    if (input.isPrimary) {
      await this.prisma.counterpartyContact.updateMany({ where: { counterpartyId }, data: { isPrimary: false } });
    }
    const contact = await this.prisma.counterpartyContact.create({
      data: { tenantId, counterpartyId, createdBy: userId, updatedBy: userId, ...input },
    });
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTACT_ADDED', entityType: 'Counterparty',
      entityId: counterpartyId, action: 'CREATE', userId, newValues: { contactId: contact.id },
    });
    return contact;
  }

  async updateContact(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, contactId: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, counterpartyId);
    const { expectedVersion: _ev, ...fields } = patch;

    if (fields.isPrimary) {
      await this.prisma.counterpartyContact.updateMany({ where: { counterpartyId, id: { not: contactId } }, data: { isPrimary: false } });
    }
    const result = await this.prisma.counterpartyContact.updateMany({
      where: { id: contactId, counterpartyId, version: expectedVersion },
      data: { ...fields, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_CONTACT_UPDATED', entityType: 'Counterparty',
      entityId: counterpartyId, action: 'UPDATE', userId, newValues: { contactId, ...fields },
    });
    return this.prisma.counterpartyContact.findUnique({ where: { id: contactId } });
  }

  async addBankAccount(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, userId: string, input: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, counterpartyId);
    if (input.currencyId) {
      const cur = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
      if (!cur) throw new ValidationAppError('Currency not found');
    }

    const existingCount = await this.prisma.counterpartyBankAccount.count({ where: { counterpartyId, active: true } });
    // The FIRST bank account on a counterparty is always primary — "ən azı
    // bir hesab əsas bank hesabı kimi seçilə bilsin" (spec section 3) is
    // satisfied structurally rather than left to the caller to remember.
    const isPrimary = existingCount === 0 ? true : !!input.isPrimary;
    if (isPrimary) {
      await this.prisma.counterpartyBankAccount.updateMany({ where: { counterpartyId }, data: { isPrimary: false } });
    }

    const account = await this.prisma.counterpartyBankAccount.create({
      data: { tenantId, counterpartyId, createdBy: userId, updatedBy: userId, ...input, isPrimary },
    });
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_BANK_ACCOUNT_ADDED', entityType: 'Counterparty',
      entityId: counterpartyId, action: 'CREATE', userId, newValues: { bankAccountId: account.id },
    });
    return account;
  }

  async updateBankAccount(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, accountId: string, userId: string, expectedVersion: number, patch: any) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, counterpartyId);
    const { expectedVersion: _ev, ...fields } = patch;

    if (fields.isPrimary) {
      await this.prisma.counterpartyBankAccount.updateMany({ where: { counterpartyId, id: { not: accountId } }, data: { isPrimary: false } });
    }
    const result = await this.prisma.counterpartyBankAccount.updateMany({
      where: { id: accountId, counterpartyId, version: expectedVersion },
      data: { ...fields, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_BANK_ACCOUNT_UPDATED', entityType: 'Counterparty',
      entityId: counterpartyId, action: 'UPDATE', userId, newValues: { bankAccountId: accountId, ...fields },
    });
    return this.prisma.counterpartyBankAccount.findUnique({ where: { id: accountId } });
  }

  async deactivateBankAccount(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, accountId: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, counterpartyId);
    const result = await this.prisma.counterpartyBankAccount.updateMany({
      where: { id: accountId, counterpartyId, version: expectedVersion },
      data: { active: false, isPrimary: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_BANK_ACCOUNT_REMOVED', entityType: 'Counterparty',
      entityId: counterpartyId, action: 'DEACTIVATE', userId, newValues: { bankAccountId: accountId },
    });
    return { removed: true };
  }

  async search(tenantId: string, membershipId: string, organizationId: string, query: string, limit = 20) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.counterparty.findMany({
      where: {
        organizationId, active: true,
        OR: [
          { code: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { taxId: { equals: query } },
        ],
      },
      take: limit, orderBy: { name: 'asc' },
    });
  }

  // -- helpers ----------------------------------------------------------------

  private async assertTaxIdAvailable(organizationId: string, taxId: string, excludeId?: string) {
    const existing = await this.prisma.counterparty.findFirst({
      where: { organizationId, taxId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) throw new ConflictAppError(`A counterparty with VÖEN ${taxId} already exists: ${existing.name}`);
  }

  private missingRequiredFields(cp: any): string[] {
    const missing: string[] = [];
    if (!cp.name?.trim()) missing.push('name');
    if (!cp.residencyStatus) missing.push('residencyStatus');
    if (cp.residencyStatus === 'NON_RESIDENT') {
      if (!cp.foreignTaxId?.trim()) missing.push('foreignTaxId');
    } else if (!cp.taxId?.trim()) {
      missing.push('taxId');
    }
    if (!cp.countryCode?.trim()) missing.push('countryCode');
    const hasLegalAddress = (cp.addresses ?? []).some((a: any) => a.addressType === 'LEGAL' && a.active);
    if (!hasLegalAddress) missing.push('legalAddress');
    return missing;
  }
}
