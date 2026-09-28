import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CreateEmployeeDto } from './dto/hr-core.dto';

const EMPLOYEE_TYPE = 'HR_EMPLOYEE';
const EMPLOYEE_SEQUENCE_CODE = 'HR_EMPLOYEE';
const EMPLOYEE_SEQUENCE_PREFIX = 'EMP';

/**
 * Employee — the company's own HR identity (docx spec Phase 17 section 1),
 * distinct from PhysicalPerson (real-world identity) and Employment (one
 * concrete employment relationship). Tenant-wide: a personnel number is
 * assigned once and never reused, even across multiple employments for the
 * same person (rehire reuses the SAME Employee row — see HireDocumentService).
 */
@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.prisma.employee.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { personnelNumber: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.employee.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('Employee', id);
    return row;
  }

  async getWithPerson(tenantId: string, id: string) {
    const row = await this.prisma.employee.findFirst({
      where: { id, tenantId },
      include: { physicalPerson: true },
    });
    if (!row) throw new NotFoundAppError('Employee', id);
    return row;
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateEmployeeDto,
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const person = await client.physicalPerson.findFirst({
      where: { id: dto.physicalPersonId, tenantId },
    });
    if (!person)
      throw new ValidationAppError(
        'physicalPersonId does not belong to this tenant',
      );

    await this.ensureSequence(tenantId, client);
    const allocated = await this.numbering.allocateNumber(
      tenantId,
      EMPLOYEE_SEQUENCE_CODE,
      new Date(),
      tx,
    );

    const employee = await client.employee.create({
      data: {
        tenantId,
        physicalPersonId: dto.physicalPersonId,
        personnelNumber: allocated.formatted,
        employeeCode: dto.employeeCode,
        defaultOrganizationId: dto.defaultOrganizationId,
        corporateEmail: dto.corporateEmail,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record(
      {
        tenantId,
        eventType: 'HR_EMPLOYEE_CREATED',
        entityType: EMPLOYEE_TYPE,
        entityId: employee.id,
        action: 'CREATE',
        userId,
        newValues: { personnelNumber: employee.personnelNumber },
      },
      tx,
    );
    return employee;
  }

  private async ensureSequence(
    tenantId: string,
    client: PrismaTransactionClient | PrismaService,
  ) {
    const existing = await client.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: EMPLOYEE_SEQUENCE_CODE } },
    });
    if (existing) return;
    try {
      await client.numberSequence.create({
        data: {
          tenantId,
          code: EMPLOYEE_SEQUENCE_CODE,
          documentType: EMPLOYEE_TYPE,
          prefix: EMPLOYEE_SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'NEVER',
        },
      });
    } catch {
      // Lost the race — fine.
    }
  }
}
