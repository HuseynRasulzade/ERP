import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AuditService } from '../audit/audit.service';

/**
 * TaxRegistration (spec sections 21-23) — effective-dated, never a single
 * boolean flag on Organization. `resolveActive` is what TaxContext
 * builders should call to answer "was this organization VAT-registered on
 * this date".
 */
@Injectable()
export class TaxRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.taxRegistration.findMany({ where: { tenantId, organizationId }, orderBy: { validFrom: 'desc' } });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    input: { taxType: string; registrationNumber?: string; validFrom: Date; validTo?: Date; status?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const registration = await this.prisma.taxRegistration.create({
      data: {
        tenantId,
        organizationId,
        taxType: input.taxType,
        registrationNumber: input.registrationNumber,
        validFrom: input.validFrom,
        validTo: input.validTo,
        status: input.status ?? 'REGISTERED',
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'TAX_REGISTRATION_CHANGED',
      entityType: 'TaxRegistration',
      entityId: registration.id,
      action: 'CREATE',
      userId,
      newValues: { taxType: input.taxType, status: registration.status },
    });

    return registration;
  }

  async resolveActive(tenantId: string, organizationId: string, taxType: string, date: Date) {
    return this.prisma.taxRegistration.findFirst({
      where: {
        tenantId,
        organizationId,
        taxType,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
      },
      orderBy: { validFrom: 'desc' },
    });
  }
}
