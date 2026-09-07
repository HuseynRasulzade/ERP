import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import {
  ConcurrencyConflictError,
  ConflictAppError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';

export interface CreateOrganizationInput {
  code: string;
  name: string;
  fullLegalName?: string;
  shortName?: string;
  legalForm?: string;
  taxId?: string;
  registrationNumber?: string;
  countryCode?: string;
  registeredAddress?: string;
  actualAddress?: string;
  phone?: string;
  email?: string;
  website?: string;
  baseCurrencyId?: string;
  timezone?: string;
  locale?: string;
}

/**
 * Organization / Legal Entity (section 3-5, 21-23, 28, 31). Every method
 * here treats `organizationId` as untrusted input that must be re-verified
 * against `tenantId` and the caller's access grant — never assume the
 * frontend's organization_id can be trusted (section 21).
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, userId: string, input: CreateOrganizationInput) {
    const existing = await this.prisma.organization.findUnique({
      where: { tenantId_code: { tenantId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Organization code already exists: ${input.code}`);

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { tenantId, createdBy: userId, updatedBy: userId, ...input },
      });

      // Section 22: creating an organization does not implicitly grant
      // access to everyone — but the creator needs it immediately.
      await tx.organizationAccess.create({
        data: { tenantMembershipId: membershipId, organizationId: created.id, accessLevel: 'FULL', createdBy: userId },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          eventType: 'ORGANIZATION_CREATED',
          entityType: 'Organization',
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { code: created.code, name: created.name },
        },
      });

      return created;
    });

    return org;
  }

  /** Section 25/26: the selectable list only ever returns organizations the
   * caller has an explicit grant for, and excludes inactive ones by default. */
  async listAccessible(tenantId: string, membershipId: string, includeInactive = false) {
    const accessibleIds = await this.access.listAccessibleOrganizationIds(membershipId);
    if (accessibleIds.length === 0) return [];

    return this.prisma.organization.findMany({
      where: { tenantId, id: { in: accessibleIds }, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId);
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<CreateOrganizationInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, tenantId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'ORGANIZATION_UPDATED',
      entityType: 'Organization',
      entityId: organizationId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  async deactivate(tenantId: string, membershipId: string, organizationId: string, userId: string, expectedVersion: number) {
    const org = await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!org.active) throw new ValidationAppError('Organization is already inactive');

    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, tenantId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'ORGANIZATION_DEACTIVATED',
      entityType: 'Organization',
      entityId: organizationId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  async reactivate(tenantId: string, membershipId: string, organizationId: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, tenantId, version: expectedVersion },
      data: { active: true, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  /**
   * Section 31: sets one of the organization's typed defaults, validating
   * the target belongs to THIS organization first (never trust a default
   * pointing at another org's warehouse/branch/cashbox/bank account).
   */
  async setDefault(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    expectedVersion: number,
    field: 'defaultBranchId' | 'defaultWarehouseId' | 'defaultCashboxId' | 'defaultBankAccountId',
    targetId: string | null,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    if (targetId) {
      const table = {
        defaultBranchId: this.prisma.branch,
        defaultWarehouseId: this.prisma.warehouse,
        defaultCashboxId: this.prisma.cashbox,
        defaultBankAccountId: this.prisma.bankAccount,
      }[field] as { findFirst: (args: any) => Promise<any> };

      const target = await table.findFirst({ where: { id: targetId, organizationId } });
      if (!target) {
        throw new ValidationAppError('Default reference must belong to this same organization');
      }
    }

    const result = await this.prisma.organization.updateMany({
      where: { id: organizationId, tenantId, version: expectedVersion },
      data: { [field]: targetId, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }
}
