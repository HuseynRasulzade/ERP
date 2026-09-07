import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_ROLE_TENANT_ADMIN } from '../seed/seed-data';

/**
 * Tenant = highest business isolation boundary (section 4). Creating a
 * tenant also creates the creator's membership and grants the seeded
 * "Tenant Administrator" system role — a tenant is never left without an
 * administrator.
 */
@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createTenant(
    creatorUserId: string,
    params: { code: string; name: string; legalName?: string; baseCurrencyCode?: string; timezone?: string; locale?: string },
  ) {
    const existing = await this.prisma.tenant.findUnique({ where: { code: params.code } });
    if (existing) throw new ConflictAppError(`Tenant code already exists: ${params.code}`);

    const baseCurrencyCode = params.baseCurrencyCode ?? 'AZN';
    const baseCurrency = await this.prisma.currency.findUnique({ where: { code: baseCurrencyCode } });
    if (!baseCurrency) throw new ValidationAppError(`Unknown currency code: ${baseCurrencyCode}`);

    const adminRole = await this.prisma.role.findFirst({
      where: { code: SYSTEM_ROLE_TENANT_ADMIN, isSystem: true, tenantId: null },
    });
    if (!adminRole) {
      throw new ValidationAppError('System not seeded: Tenant Administrator role missing. Run seed first.');
    }

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          code: params.code,
          name: params.name,
          legalName: params.legalName,
          baseCurrencyId: baseCurrency.id,
          timezone: params.timezone ?? 'Asia/Baku',
          locale: params.locale ?? 'az-AZ',
          createdBy: creatorUserId,
        },
      });

      const membership = await tx.tenantMembership.create({
        data: { tenantId: created.id, userId: creatorUserId, status: 'ACTIVE' },
      });

      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: adminRole.id },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: created.id,
          eventType: 'TENANT_CREATED',
          entityType: 'Tenant',
          entityId: created.id,
          action: 'CREATE',
          userId: creatorUserId,
          newValues: { code: created.code, name: created.name },
        },
      });

      return created;
    });

    return tenant;
  }

  async get(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundAppError('Tenant', tenantId);
    return tenant;
  }

  async inviteMember(tenantId: string, userId: string) {
    const existing = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (existing) throw new ConflictAppError('User is already a member of this tenant');

    return this.prisma.tenantMembership.create({
      data: { tenantId, userId, status: 'ACTIVE' },
    });
  }

  listMembers(tenantId: string) {
    return this.prisma.tenantMembership.findMany({
      where: { tenantId },
      include: { user: true, roles: { include: { role: true } } },
    });
  }
}
