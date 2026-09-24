import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, ErrorCode, HrRuleError, NotFoundAppError } from '../common/errors/app-error';
import { CreatePhysicalPersonDto, DuplicateCheckDto, UpdatePhysicalPersonDto } from './dto/hr.dto';
import { HrDocType, HrEventType } from './hr.constants';
import { parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrEventService } from './hr-event.service';
import { HrPolicyService } from './hr-policy.service';
import { HrSecurityService, PERSONAL_DATA_FIELDS } from './hr-security.service';

export interface DuplicateMatch {
  personId: string;
  fullName: string;
  signal: 'PERSONAL_ID' | 'PASSPORT' | 'NAME_BIRTH_DATE' | 'PHONE' | 'EMAIL';
  hard: boolean;
}

/**
 * PhysicalPerson (spec 4/5) — the real human, created once per tenant.
 * Duplicate detection: a legal identifier (personal ID / passport) is a
 * HARD unique (DB constraint + 409 here); name+birth date, phone and email
 * are FUZZY signals returned as warnings, never a block.
 */
@Injectable()
export class PhysicalPersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: HrEventService,
    private readonly security: HrSecurityService,
    private readonly policy: HrPolicyService,
  ) {}

  static normalizeId(v?: string | null) {
    return v ? v.trim().toUpperCase().replace(/\s+/g, '') : null;
  }

  static composeFullName(p: { firstName: string; lastName: string; middleName?: string | null }) {
    return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ').trim();
  }

  async findDuplicates(tenantId: string, dto: DuplicateCheckDto, excludeId?: string, client?: PrismaTransactionClient): Promise<DuplicateMatch[]> {
    const db = client ?? this.prisma;
    const or: any[] = [];
    const personalId = PhysicalPersonService.normalizeId(dto.personalId);
    const passport = PhysicalPersonService.normalizeId(dto.passportNumber);
    if (personalId) or.push({ personalId });
    if (passport) or.push({ passportNumber: passport });
    const birthDate = parseOptionalHrDate(dto.birthDate, 'birthDate');
    if (dto.firstName && dto.lastName && birthDate) {
      or.push({ firstName: { equals: dto.firstName.trim(), mode: 'insensitive' }, lastName: { equals: dto.lastName.trim(), mode: 'insensitive' }, birthDate });
    }
    if (dto.personalPhone) or.push({ personalPhone: dto.personalPhone.trim() });
    if (dto.personalEmail) or.push({ personalEmail: { equals: dto.personalEmail.trim(), mode: 'insensitive' } });
    if (!or.length) return [];
    const rows = await db.physicalPerson.findMany({ where: { tenantId, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) }, take: 50 });
    const matches: DuplicateMatch[] = [];
    for (const r of rows) {
      if (personalId && r.personalId === personalId) matches.push({ personId: r.id, fullName: r.fullName, signal: 'PERSONAL_ID', hard: true });
      if (passport && r.passportNumber === passport) matches.push({ personId: r.id, fullName: r.fullName, signal: 'PASSPORT', hard: true });
      if (
        birthDate && dto.firstName && dto.lastName && r.birthDate?.getTime() === birthDate.getTime() &&
        r.firstName.toLowerCase() === dto.firstName.trim().toLowerCase() && r.lastName.toLowerCase() === dto.lastName.trim().toLowerCase()
      ) {
        matches.push({ personId: r.id, fullName: r.fullName, signal: 'NAME_BIRTH_DATE', hard: false });
      }
      if (dto.personalPhone && r.personalPhone === dto.personalPhone.trim()) matches.push({ personId: r.id, fullName: r.fullName, signal: 'PHONE', hard: false });
      if (dto.personalEmail && r.personalEmail?.toLowerCase() === dto.personalEmail.trim().toLowerCase()) matches.push({ personId: r.id, fullName: r.fullName, signal: 'EMAIL', hard: false });
    }
    return matches;
  }

  async create(tenantId: string, userId: string, dto: CreatePhysicalPersonDto, client?: PrismaTransactionClient) {
    const run = async (tx: PrismaTransactionClient) => {
      const duplicates = await this.findDuplicates(tenantId, dto, undefined, tx);
      const hard = duplicates.filter((d) => d.hard);
      if (hard.length) {
        throw new HrRuleError(
          ErrorCode.HR_DUPLICATE_PERSON,
          `A physical person with the same ${hard[0].signal === 'PERSONAL_ID' ? 'personal ID' : 'passport number'} already exists: ${hard[0].fullName}`,
          409,
          { duplicates: hard },
        );
      }
      const person = await tx.physicalPerson.create({
        data: {
          tenantId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          middleName: dto.middleName?.trim() || null,
          fullName: PhysicalPersonService.composeFullName(dto),
          gender: dto.gender,
          birthDate: parseOptionalHrDate(dto.birthDate, 'birthDate'),
          nationality: dto.nationality,
          personalId: PhysicalPersonService.normalizeId(dto.personalId),
          taxId: PhysicalPersonService.normalizeId(dto.taxId),
          passportNumber: PhysicalPersonService.normalizeId(dto.passportNumber),
          identityDocuments: dto.identityDocuments as any,
          personalEmail: dto.personalEmail?.trim() || null,
          personalPhone: dto.personalPhone?.trim() || null,
          address: dto.address,
          emergencyContact: dto.emergencyContact as any,
          photoUrl: dto.photoUrl,
          notes: dto.notes,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        { tenantId, eventType: 'HR_PERSON_CREATED', entityType: HrDocType.PERSON, entityId: person.id, action: 'CREATE', userId, newValues: { fullName: person.fullName } },
        tx,
      );
      await this.events.emit(tx, {
        tenantId,
        eventType: HrEventType.PHYSICAL_PERSON_CREATED,
        effectiveDate: todayHr(),
        newState: { fullName: person.fullName },
        sourceDocumentType: HrDocType.PERSON,
        sourceDocumentId: person.id,
      });
      return { person, duplicateWarnings: duplicates };
    };
    return client ? run(client) : this.prisma.runInTransaction(run);
  }

  async list(tenantId: string, filter: { search?: string; active?: string; limit?: number }) {
    const rows = await this.prisma.physicalPerson.findMany({
      where: {
        tenantId,
        ...(filter.active !== undefined ? { active: filter.active === 'true' } : {}),
        ...(filter.search
          ? {
              OR: [
                { fullName: { contains: filter.search, mode: 'insensitive' } },
                ...(this.security.canViewPersonalData() ? [{ personalId: { contains: filter.search.toUpperCase() } }] : []),
              ],
            }
          : {}),
      },
      include: { employees: { select: { id: true, personnelNumber: true, status: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: Math.min(filter.limit ?? 200, 1000),
    });
    return rows.map((r) => this.security.redactPerson(r));
  }

  async get(tenantId: string, id: string, userId?: string) {
    const person = await this.prisma.physicalPerson.findFirst({
      where: { id, tenantId },
      include: { employees: { include: { employments: { select: { id: true, organizationId: true, employmentStartDate: true, employmentEndDate: true, employmentStatus: true, status: true } } } } },
    });
    if (!person) throw new NotFoundAppError('PhysicalPerson', id);
    if (this.security.canViewPersonalData()) {
      const policy = await this.policy.getPolicy(tenantId);
      if (policy.auditSensitiveViews) {
        await this.audit.record({ tenantId, eventType: 'HR_SENSITIVE_DATA_VIEWED', entityType: HrDocType.PERSON, entityId: id, action: 'VIEW', userId, metadata: { fields: PERSONAL_DATA_FIELDS } });
      }
    }
    const documents = await this.prisma.hrPersonnelDocument.findMany({ where: { tenantId, ownerType: 'PERSON', ownerId: id, active: true } });
    return { ...this.security.redactPerson(person), documents: this.security.filterDocuments(documents) };
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdatePhysicalPersonDto) {
    const current = await this.prisma.physicalPerson.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundAppError('PhysicalPerson', id);
    const { expectedVersion, ...changes } = dto;
    const data: Record<string, unknown> = { ...changes };
    if ('birthDate' in changes) data.birthDate = parseOptionalHrDate(changes.birthDate, 'birthDate');
    for (const k of ['personalId', 'taxId', 'passportNumber'] as const) if (k in changes) data[k] = PhysicalPersonService.normalizeId(changes[k]);
    const merged = { ...current, ...data } as any;
    if (changes.firstName || changes.lastName || 'middleName' in changes) data.fullName = PhysicalPersonService.composeFullName(merged);

    if (data.personalId || data.passportNumber) {
      const hard = (await this.findDuplicates(tenantId, { personalId: merged.personalId, passportNumber: merged.passportNumber }, id)).filter((d) => d.hard);
      if (hard.length) throw new HrRuleError(ErrorCode.HR_DUPLICATE_PERSON, `Another physical person already has this legal identifier: ${hard[0].fullName}`, 409, { duplicates: hard });
    }
    const res = await this.prisma.physicalPerson.updateMany({ where: { id, tenantId, version: expectedVersion }, data: { ...(data as any), updatedBy: userId, version: { increment: 1 } } });
    if (res.count === 0) throw new ConcurrencyConflictError();
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const k of Object.keys(data)) {
      oldValues[k] = (current as any)[k];
      newValues[k] = data[k];
    }
    await this.audit.record({ tenantId, eventType: 'HR_PERSON_CHANGED', entityType: HrDocType.PERSON, entityId: id, action: 'UPDATE', userId, oldValues, newValues });
    return this.get(tenantId, id);
  }
}
