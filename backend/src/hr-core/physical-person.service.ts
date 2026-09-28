import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  CreatePhysicalPersonDto,
  UpdatePhysicalPersonDto,
} from './dto/hr-core.dto';

const PHYSICAL_PERSON_TYPE = 'PHYSICAL_PERSON';

/**
 * PhysicalPerson — the real-world identity behind an Employee (docx spec
 * Phase 17 section 1: person / identity / employment are three separate
 * concepts). Tenant-wide master data, same as Department/Position: a
 * person can move between organizations under the same tenant without
 * being re-created.
 */
@Injectable()
export class PhysicalPersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, activeOnly = false) {
    return this.prisma.physicalPerson.findMany({
      where: { tenantId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { lastName: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.physicalPerson.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('PhysicalPerson', id);
    return row;
  }

  /** Duplicate-detection check (spec section 3) — used both standalone and
   * from HireDocumentService's own new-person path. */
  async findDuplicates(tenantId: string, personalId: string) {
    return this.prisma.physicalPerson.findMany({
      where: { tenantId, personalId, active: true },
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreatePhysicalPersonDto,
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    if (dto.personalId) {
      const duplicates = await client.physicalPerson.findMany({
        where: { tenantId, personalId: dto.personalId, active: true },
      });
      if (duplicates.length > 0 && !dto.confirmDuplicate)
        throw new ValidationAppError(
          `A physical person with personalId ${dto.personalId} already exists — set confirmDuplicate to proceed anyway`,
        );
    }

    const fullName = [dto.firstName, dto.middleName, dto.lastName]
      .filter(Boolean)
      .join(' ');

    const person = await client.physicalPerson.create({
      data: {
        tenantId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        fullName,
        gender: dto.gender,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        nationality: dto.nationality,
        personalId: dto.personalId,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        emergencyContact: dto.emergencyContact,
        notes: dto.notes,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record(
      {
        tenantId,
        eventType: 'PHYSICAL_PERSON_CREATED',
        entityType: PHYSICAL_PERSON_TYPE,
        entityId: person.id,
        action: 'CREATE',
        userId,
        newValues: { fullName, personalId: dto.personalId },
      },
      tx,
    );
    return person;
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdatePhysicalPersonDto,
  ) {
    const person = await this.get(tenantId, id);
    if (person.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const result = await this.prisma.physicalPerson.updateMany({
      where: { id, tenantId, version: dto.expectedVersion },
      data: {
        email: dto.email ?? person.email,
        phone: dto.phone ?? person.phone,
        address: dto.address ?? person.address,
        emergencyContact: dto.emergencyContact ?? person.emergencyContact,
        notes: dto.notes ?? person.notes,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'PHYSICAL_PERSON_UPDATED',
      entityType: PHYSICAL_PERSON_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.get(tenantId, id);
  }
}
