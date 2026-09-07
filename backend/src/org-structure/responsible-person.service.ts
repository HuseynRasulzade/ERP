import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface ResponsiblePersonInput {
  displayName: string;
  email?: string;
  phone?: string;
  userId?: string;
  notes?: string;
}

/**
 * Lightweight, tenant-global responsible-person foundation (section 9/10) —
 * deliberately NOT the future Phase 17 Employee model, and NOT required to
 * link to a system user.
 */
@Injectable()
export class ResponsiblePersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, includeInactive = false) {
    return this.prisma.responsiblePerson.findMany({
      where: { tenantId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { displayName: 'asc' },
    });
  }

  async create(tenantId: string, userId: string, input: ResponsiblePersonInput) {
    const person = await this.prisma.responsiblePerson.create({ data: { tenantId, ...input } });

    await this.audit.record({
      tenantId,
      eventType: 'RESPONSIBLE_PERSON_CREATED',
      entityType: 'ResponsiblePerson',
      entityId: person.id,
      action: 'CREATE',
      userId,
      newValues: { displayName: person.displayName },
    });

    return person;
  }

  async get(tenantId: string, id: string) {
    const person = await this.prisma.responsiblePerson.findFirst({ where: { id, tenantId } });
    if (!person) throw new NotFoundAppError('ResponsiblePerson', id);
    return person;
  }

  async update(tenantId: string, id: string, userId: string, expectedVersion: number, patch: Partial<ResponsiblePersonInput>) {
    const result = await this.prisma.responsiblePerson.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { ...patch, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'RESPONSIBLE_PERSON_UPDATED',
      entityType: 'ResponsiblePerson',
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.responsiblePerson.findUnique({ where: { id } });
  }

  async deactivate(tenantId: string, id: string, userId: string, expectedVersion: number) {
    const person = await this.get(tenantId, id);
    if (!person.active) throw new ValidationAppError('Responsible person is already inactive');

    const result = await this.prisma.responsiblePerson.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { active: false, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'RESPONSIBLE_PERSON_DEACTIVATED',
      entityType: 'ResponsiblePerson',
      entityId: id,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.responsiblePerson.findUnique({ where: { id } });
  }
}
