import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { rangesOverlap } from './effective-date.util';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface TaxProfileInput {
  code: string;
  name: string;
  countryCode?: string;
  taxId?: string;
  vatRegistered?: boolean;
  vatRegistrationDate?: Date;
  vatDeregistrationDate?: Date;
  taxRegimeCode?: string;
  validFrom: Date;
  validTo?: Date | null;
  metadata?: Record<string, unknown>;
}

/**
 * Organization tax identity/configuration FOUNDATION ONLY (section 19, 40)
 * — VAT rates/calculation/posting belong to Phase 5. Same effective-dating
 * discipline as AccountingPolicy: prefer a new version over overwriting
 * history when tax registration changes.
 */
@Injectable()
export class TaxProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.taxProfile.findMany({ where: { organizationId }, orderBy: { validFrom: 'desc' } });
  }

  private async assertNoOverlap(organizationId: string, validFrom: Date, validTo: Date | null | undefined, excludeId?: string) {
    const others = await this.prisma.taxProfile.findMany({
      where: { organizationId, active: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    for (const other of others) {
      if (rangesOverlap(validFrom, validTo ?? null, other.validFrom, other.validTo)) {
        throw new ConflictAppError(`Effective period overlaps existing tax profile "${other.code}"`);
      }
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: TaxProfileInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertNoOverlap(organizationId, input.validFrom, input.validTo);

    const existingCode = await this.prisma.taxProfile.findUnique({
      where: { organizationId_code_validFrom: { organizationId, code: input.code, validFrom: input.validFrom } },
    });
    if (existingCode) throw new ConflictAppError('A tax profile with this code and effective date already exists');

    const profile = await this.prisma.taxProfile.create({
      data: { tenantId, organizationId, metadata: input.metadata as any, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TAX_PROFILE_CREATED',
      entityType: 'TaxProfile',
      entityId: profile.id,
      action: 'CREATE',
      userId,
      newValues: { code: profile.code, validFrom: profile.validFrom },
    });

    return profile;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const profile = await this.prisma.taxProfile.findFirst({ where: { id, organizationId } });
    if (!profile) throw new NotFoundAppError('TaxProfile', id);
    return profile;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<TaxProfileInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    if (patch.validFrom || patch.validTo !== undefined) {
      const current = await this.get(tenantId, membershipId, organizationId, id);
      await this.assertNoOverlap(organizationId, patch.validFrom ?? current.validFrom, patch.validTo ?? current.validTo, id);
    }

    const result = await this.prisma.taxProfile.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { ...patch, metadata: patch.metadata as any, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'TAX_PROFILE_CHANGED',
      entityType: 'TaxProfile',
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.taxProfile.findUnique({ where: { id } });
  }

  /** `resolveTaxProfile(tenantId, organizationId, businessDate)` (section 29). */
  async resolve(tenantId: string, organizationId: string, businessDate: Date) {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId, tenantId } });
    if (!org) throw new NotFoundAppError('Organization', organizationId);

    const matches = await this.prisma.taxProfile.findMany({
      where: {
        organizationId,
        active: true,
        validFrom: { lte: businessDate },
        OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
      },
    });

    if (matches.length === 0) {
      throw new ValidationAppError(`No tax profile is configured for ${businessDate.toISOString().slice(0, 10)}`);
    }
    if (matches.length > 1) {
      throw new ConflictAppError('Multiple overlapping tax profiles matched — data integrity error');
    }
    return matches[0];
  }
}
