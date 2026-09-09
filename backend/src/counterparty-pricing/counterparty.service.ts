import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { Decimal } from '@prisma/client/runtime/library';

const VALID_TYPES = ['CUSTOMER', 'SUPPLIER', 'BOTH'];
const VALID_ADDRESS_TYPES = ['LEGAL', 'SHIPPING', 'BILLING', 'OTHER'];

export interface CounterpartyInput {
  counterpartyType: string;
  code: string;
  name: string;
  fullLegalName?: string;
  taxId?: string;
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
 * Phase 3 — Counterparty service (section 86-89).
 * Organization-scoped customer/supplier master data.
 */
@Injectable()
export class CounterpartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false, type?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.counterparty.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }), ...(type ? { counterpartyType: type as any } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: CounterpartyInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!VALID_TYPES.includes(input.counterpartyType)) throw new ValidationAppError(`Unknown type: ${input.counterpartyType}`);

    const existing = await this.prisma.counterparty.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Counterparty code already exists: ${input.code}`);

    if (input.currencyId) {
      const cur = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
      if (!cur) throw new ValidationAppError('Currency not found');
    }

    const cp = await this.prisma.counterparty.create({
      data: {
        tenantId, organizationId, createdBy: userId, updatedBy: userId,
        counterpartyType: input.counterpartyType as any, code: input.code, name: input.name,
        fullLegalName: input.fullLegalName, taxId: input.taxId, registrationNumber: input.registrationNumber,
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
      include: { addresses: { where: { active: true } }, contacts: { where: { active: true } } },
    });
    if (!cp) throw new NotFoundAppError('Counterparty', id);
    return cp;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number, patch: Partial<CounterpartyInput>) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.counterpartyType && !VALID_TYPES.includes(patch.counterpartyType)) {
      throw new ValidationAppError(`Unknown type: ${patch.counterpartyType}`);
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
}
