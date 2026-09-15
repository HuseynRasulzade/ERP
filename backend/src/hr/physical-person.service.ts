import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * PhysicalPersonService (spec sections 4-5). `checkDuplicates` is called
 * by the caller BEFORE `create` (never automatically) — a hard unique
 * constraint only applies when `personalId` is given and non-empty (spec
 * section 5's "Hard unique yalnız legal identifier mövcud və etibarlı
 * olduqda tətbiq et"); everything else (name+birthDate, phone, email) is
 * a fuzzy warning signal returned to the caller, never a block.
 */
@Injectable()
export class PhysicalPersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async checkDuplicates(tenantId: string, dto: { personalId?: string; firstName?: string; lastName?: string; birthDate?: string; phone?: string; email?: string }) {
    const matches: { id: string; fullName: string; matchedOn: string }[] = [];
    if (dto.personalId) {
      const exact = await this.prisma.physicalPerson.findMany({ where: { tenantId, personalId: dto.personalId, active: true } });
      matches.push(...exact.map((p) => ({ id: p.id, fullName: p.fullName, matchedOn: 'personalId' })));
    }
    if (dto.firstName && dto.lastName && dto.birthDate) {
      const nameMatches = await this.prisma.physicalPerson.findMany({ where: { tenantId, firstName: dto.firstName, lastName: dto.lastName, birthDate: new Date(dto.birthDate), active: true } });
      matches.push(...nameMatches.map((p) => ({ id: p.id, fullName: p.fullName, matchedOn: 'name+birthDate' })));
    }
    if (dto.phone) {
      const phoneMatches = await this.prisma.physicalPerson.findMany({ where: { tenantId, phone: dto.phone, active: true } });
      matches.push(...phoneMatches.map((p) => ({ id: p.id, fullName: p.fullName, matchedOn: 'phone' })));
    }
    if (dto.email) {
      const emailMatches = await this.prisma.physicalPerson.findMany({ where: { tenantId, email: dto.email, active: true } });
      matches.push(...emailMatches.map((p) => ({ id: p.id, fullName: p.fullName, matchedOn: 'email' })));
    }
    const uniqueIds = new Set(matches.map((m) => m.id));
    return { hasHardMatch: dto.personalId ? matches.some((m) => m.matchedOn === 'personalId') : false, matches: [...uniqueIds].map((id) => matches.find((m) => m.id === id)!) };
  }

  async create(tenantId: string, userId: string, dto: { firstName: string; lastName: string; middleName?: string; gender?: string; birthDate?: string; nationality?: string; personalId?: string; passportNumber?: string; phone?: string; email?: string; address?: string; emergencyContact?: string; notes?: string }) {
    if (dto.personalId) {
      const existing = await this.prisma.physicalPerson.findFirst({ where: { tenantId, personalId: dto.personalId, active: true } });
      if (existing) throw new ValidationAppError(`A physical person with personal ID ${dto.personalId} already exists (${existing.fullName}).`);
    }
    const fullName = [dto.lastName, dto.firstName, dto.middleName].filter(Boolean).join(' ');
    const row = await this.prisma.physicalPerson.create({
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
        passportNumber: dto.passportNumber,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        emergencyContact: dto.emergencyContact,
        notes: dto.notes,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'HR_PHYSICAL_PERSON_CREATED', entityType: 'PHYSICAL_PERSON', entityId: row.id, action: 'CREATE', userId, newValues: { fullName } });
    return row;
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.physicalPerson.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('PhysicalPerson', id);
    return row;
  }

  list(tenantId: string, search?: string) {
    return this.prisma.physicalPerson.findMany({ where: { tenantId, active: true, ...(search ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { personalId: { contains: search } }] } : {}) }, orderBy: { lastName: 'asc' } });
  }

  async update(tenantId: string, userId: string, id: string, dto: Partial<{ phone: string; email: string; address: string; emergencyContact: string; notes: string }>) {
    const person = await this.get(tenantId, id);
    const row = await this.prisma.physicalPerson.update({ where: { id }, data: { ...dto, updatedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_PHYSICAL_PERSON_UPDATED', entityType: 'PHYSICAL_PERSON', entityId: id, action: 'UPDATE', userId, oldValues: person, newValues: dto });
    return row;
  }
}
