import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { EmploymentContractService } from './employment-contract.service';
import { HR_HIRE_TYPE } from './hire.repository';

const SEQUENCE_PREFIX = 'HIRE';
const CONTRACT_SEQUENCE = 'HR_CONTRACT_NUMBER';
const CONTRACT_PREFIX = 'CTR';

/**
 * HireService (spec sections 19-21, 47-48). Creates a PLANNED Employment,
 * its initial EmploymentContract, and the HireDocument itself in one
 * transaction — none of the real HR-register effects (assignment,
 * schedule, status history) happen until the document is POSTed via
 * `DocumentPostingService` (spec section 66: "No real history write
 * until POST"). `rehire` is a thin wrapper — the spec's own
 * `RehireDocument` (section 48) is NOT a separate table in this build; it
 * reuses this exact flow with `isRehire: true` and
 * `previousEmploymentId` set (disclosed simplification, see
 * docs/HR_CORE.md) rather than creating a new Employee/PhysicalPerson.
 */
@Injectable()
export class HireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly contracts: EmploymentContractService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      employeeId: string;
      employmentType: string;
      hireDate: string;
      documentDate: string;
      departmentId: string;
      positionId: string;
      branchId?: string;
      staffingPositionId?: string;
      managerEmploymentId?: string;
      workScheduleId?: string;
      fte?: number;
      probationEndDate?: string;
      locationId?: string;
      costCenterId?: string;
      projectId?: string;
      primaryEmployment?: boolean;
      responsibleHrUserId?: string;
      previousEmploymentId?: string;
      isRehire?: boolean;
      contractNumber?: string;
      contractType: string;
      probationPeriodMonths?: number;
      workLocation?: string;
      workingTimeType?: string;
      baseCompensationReference?: string;
      conditions?: string;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, tenantId } });
    if (!employee) throw new NotFoundAppError('Employee', dto.employeeId);
    if (dto.isRehire && !dto.previousEmploymentId) throw new ValidationAppError('A rehire requires previousEmploymentId (spec section 47 — never reopen the terminated employment itself)');
    if (dto.previousEmploymentId) {
      const previous = await this.prisma.employment.findFirst({ where: { id: dto.previousEmploymentId, tenantId } });
      if (!previous) throw new NotFoundAppError('Employment', dto.previousEmploymentId);
      if (previous.employmentStatus !== 'TERMINATED') throw new ValidationAppError('previousEmploymentId must reference a TERMINATED employment');
      const hireDate = new Date(dto.hireDate);
      if (previous.employmentEndDate && hireDate <= previous.employmentEndDate) throw new ValidationAppError('Rehire date must be after the previous employment\'s end date (spec section 76)');
    }

    const documentDate = this.parseDate(dto.documentDate);
    const hireDate = this.parseDate(dto.hireDate);
    await this.ensureSequences(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const employment = await tx.employment.create({
        data: {
          tenantId,
          employeeId: dto.employeeId,
          organizationId,
          employmentType: dto.employmentType,
          employmentStatus: 'PLANNED',
          employmentStartDate: hireDate,
          primaryEmployment: dto.primaryEmployment ?? true,
          staffingPositionId: dto.staffingPositionId,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          branchId: dto.branchId,
          managerEmploymentId: dto.managerEmploymentId,
          workScheduleId: dto.workScheduleId,
          fte: (dto.fte ?? 1).toString(),
          probationEndDate: dto.probationEndDate ? new Date(dto.probationEndDate) : undefined,
          locationId: dto.locationId,
          costCenterId: dto.costCenterId,
          projectId: dto.projectId,
          previousEmploymentId: dto.previousEmploymentId,
          createdBy: userId,
        },
      });

      const contractNumber = dto.contractNumber ?? (await this.numbering.allocateNumber(tenantId, CONTRACT_SEQUENCE, documentDate, tx)).formatted;
      await this.contracts.createInitial(tenantId, userId, employment.id, { contractNumber, contractDate: dto.documentDate, effectiveFrom: dto.hireDate, contractType: dto.contractType, probationPeriodMonths: dto.probationPeriodMonths, workLocation: dto.workLocation, workingTimeType: dto.workingTimeType, baseCompensationReference: dto.baseCompensationReference, conditions: dto.conditions }, tx);

      const allocated = await this.numbering.allocateNumber(tenantId, HR_HIRE_TYPE, documentDate, tx);
      const hire = await tx.hireDocument.create({
        data: {
          tenantId,
          organizationId,
          employmentId: employment.id,
          physicalPersonId: employee.physicalPersonId,
          employeeId: dto.employeeId,
          isRehire: dto.isRehire ?? false,
          hireDate,
          responsibleHrUserId: dto.responsibleHrUserId,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: dto.isRehire ? 'HR_REHIRE_CREATED' : 'HR_HIRE_CREATED', entityType: HR_HIRE_TYPE, entityId: hire.id, action: 'CREATE', userId, newValues: { employeeId: dto.employeeId, hireDate: dto.hireDate } }, tx);
      return { employment, hire };
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.hireDocument.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }

  private async ensureSequences(tenantId: string) {
    for (const [code, prefix] of [[HR_HIRE_TYPE, SEQUENCE_PREFIX], [CONTRACT_SEQUENCE, CONTRACT_PREFIX]] as const) {
      const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code } } });
      if (existing) continue;
      try {
        await this.prisma.numberSequence.create({ data: { tenantId, code, documentType: code, prefix, padding: 6, resetPolicy: 'YEARLY' } });
      } catch {
        // Lost the race — fine.
      }
    }
  }
}
