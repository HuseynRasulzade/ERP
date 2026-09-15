import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

const PERSONNEL_NUMBER_SEQUENCE = 'HR_PERSONNEL_NUMBER';
const SEQUENCE_PREFIX = 'EMP';

/**
 * EmployeeService (spec sections 6-7). An Employee is the tenant's own HR
 * identity for a PhysicalPerson — never itself an employment relation
 * (spec section 6's own "Employee özü employment deyil"). `personnelNumber`
 * comes from the same transaction-safe `NumberingService` every other
 * document number does (spec section 7).
 */
@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { physicalPersonId: string; defaultOrganizationId?: string; defaultLanguage?: string; corporateEmail?: string; corporatePhone?: string; bankAccountReference?: string }) {
    const person = await this.prisma.physicalPerson.findFirst({ where: { id: dto.physicalPersonId, tenantId } });
    if (!person) throw new NotFoundAppError('PhysicalPerson', dto.physicalPersonId);
    await this.ensureSequence(tenantId);
    const allocated = await this.numbering.allocateNumber(tenantId, PERSONNEL_NUMBER_SEQUENCE, new Date());

    const row = await this.prisma.employee.create({
      data: {
        tenantId,
        physicalPersonId: dto.physicalPersonId,
        personnelNumber: allocated.formatted,
        defaultOrganizationId: dto.defaultOrganizationId,
        defaultLanguage: dto.defaultLanguage,
        corporateEmail: dto.corporateEmail,
        corporatePhone: dto.corporatePhone,
        bankAccountReference: dto.bankAccountReference,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'HR_EMPLOYEE_CREATED', entityType: 'EMPLOYEE', entityId: row.id, action: 'CREATE', userId, newValues: { personnelNumber: allocated.formatted, physicalPersonId: dto.physicalPersonId } });
    return row;
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.employee.findFirst({ where: { id, tenantId }, include: { physicalPerson: true, employments: true } });
    if (!row) throw new NotFoundAppError('Employee', id);
    return row;
  }

  list(tenantId: string, status?: string) {
    return this.prisma.employee.findMany({ where: { tenantId, status }, include: { physicalPerson: true }, orderBy: { personnelNumber: 'asc' } });
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PERSONNEL_NUMBER_SEQUENCE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PERSONNEL_NUMBER_SEQUENCE, documentType: PERSONNEL_NUMBER_SEQUENCE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'NEVER' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
