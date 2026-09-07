import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { StructuralValidationService } from './structural-validation.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface CashboxInput {
  code: string;
  name: string;
  branchId?: string;
  currencyId: string;
  responsiblePersonId?: string;
}

/**
 * Structural cashbox MASTER DATA ONLY (section 13) — cash movements/
 * balances belong to Phase 15.
 */
@Injectable()
export class CashboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly validation: StructuralValidationService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.cashbox.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: CashboxInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.validation.assertBranchBelongsToOrganization(organizationId, input.branchId);
    await this.validation.assertResponsiblePersonInTenant(tenantId, input.responsiblePersonId);

    const currency = await this.prisma.currency.findUnique({ where: { id: input.currencyId } });
    if (!currency) throw new ValidationAppError('Unknown currency');

    const existing = await this.prisma.cashbox.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Cashbox code already exists: ${input.code}`);

    const cashbox = await this.prisma.cashbox.create({
      data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'CASHBOX_CREATED',
      entityType: 'Cashbox',
      entityId: cashbox.id,
      action: 'CREATE',
      userId,
      newValues: { code: cashbox.code, name: cashbox.name },
    });

    return cashbox;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, cashboxId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cashbox = await this.prisma.cashbox.findFirst({ where: { id: cashboxId, organizationId } });
    if (!cashbox) throw new NotFoundAppError('Cashbox', cashboxId);
    return cashbox;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<CashboxInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.branchId !== undefined) await this.validation.assertBranchBelongsToOrganization(organizationId, patch.branchId);
    if (patch.responsiblePersonId !== undefined) {
      await this.validation.assertResponsiblePersonInTenant(tenantId, patch.responsiblePersonId);
    }

    const result = await this.prisma.cashbox.updateMany({
      where: { id: cashboxId, organizationId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'CASHBOX_UPDATED',
      entityType: 'Cashbox',
      entityId: cashboxId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.cashbox.findUnique({ where: { id: cashboxId } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cashbox = await this.get(tenantId, membershipId, organizationId, cashboxId);
    if (!cashbox.active) throw new ValidationAppError('Cashbox is already inactive');

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.cashbox.updateMany({
        where: { id: cashboxId, organizationId, version: expectedVersion },
        data: { active: false, updatedBy: userId, version: { increment: 1 } },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await tx.organization.updateMany({
        where: { id: organizationId, defaultCashboxId: cashboxId },
        data: { defaultCashboxId: null },
      });
    });

    await this.audit.record({
      tenantId,
      eventType: 'CASHBOX_DEACTIVATED',
      entityType: 'Cashbox',
      entityId: cashboxId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.cashbox.findUnique({ where: { id: cashboxId } });
  }
}
