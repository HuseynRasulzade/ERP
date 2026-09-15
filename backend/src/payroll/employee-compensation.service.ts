import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * EmployeeCompensationAssignmentService (spec sections 9-12, 25). A
 * salary change closes the current row's `effectiveTo` and inserts a new
 * one — history is never overwritten (spec section 11's own worked
 * example: January 2,000 / July 2,500, both rows kept).
 */
@Injectable()
export class EmployeeCompensationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(
    tenantId: string,
    userId: string,
    dto: { employmentId: string; effectiveFrom: string; payBasis: string; baseSalary?: number; hourlyRate?: number; dailyRate?: number; currencyId: string; fteBasis?: string; salaryGrade?: string; normBasis?: string; sourceDocumentType?: string; sourceDocumentId?: string },
  ) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const effectiveFrom = new Date(dto.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.employeeCompensationAssignment.findFirst({ where: { tenantId, employmentId: dto.employmentId, status: 'ACTIVE', effectiveTo: null } });
      let requiresRecalc = false;
      if (current) {
        if (current.effectiveFrom > effectiveFrom) {
          // Retroactive change into an already-effective row's window
          // (spec section 89) — still recorded, flagged for recalculation
          // rather than rejected outright.
          requiresRecalc = true;
        }
        await tx.employeeCompensationAssignment.update({ where: { id: current.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) } });
      }
      const row = await tx.employeeCompensationAssignment.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          effectiveFrom,
          payBasis: dto.payBasis,
          baseSalary: dto.baseSalary?.toString(),
          hourlyRate: dto.hourlyRate?.toString(),
          dailyRate: dto.dailyRate?.toString(),
          currencyId: dto.currencyId,
          fteBasis: dto.fteBasis ?? 'ACTUAL_ASSIGNED_SALARY',
          salaryGrade: dto.salaryGrade,
          normBasis: dto.normBasis ?? 'WORKING_DAYS',
          sourceDocumentType: dto.sourceDocumentType,
          sourceDocumentId: dto.sourceDocumentId,
          createdBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'PAYROLL_COMPENSATION_ASSIGNED', entityType: 'EMPLOYEE_COMPENSATION_ASSIGNMENT', entityId: row.id, action: 'CREATE', userId, newValues: { payBasis: dto.payBasis, baseSalary: dto.baseSalary, effectiveFrom: dto.effectiveFrom, requiresRecalc } }, tx);
      return { assignment: row, requiresRecalc, priorAssignment: current };
    });
  }

  /** As-of-date compensation, and every row overlapping a period (spec
   * section 12's own mid-month split requirement). */
  async getAsOf(tenantId: string, employmentId: string, date: Date) {
    return this.prisma.employeeCompensationAssignment.findFirst({ where: { tenantId, employmentId, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' } });
  }

  async getOverlapping(tenantId: string, employmentId: string, periodStart: Date, periodEnd: Date) {
    return this.prisma.employeeCompensationAssignment.findMany({ where: { tenantId, employmentId, status: 'ACTIVE', effectiveFrom: { lte: periodEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }] }, orderBy: { effectiveFrom: 'asc' } });
  }

  history(tenantId: string, employmentId: string) {
    return this.prisma.employeeCompensationAssignment.findMany({ where: { tenantId, employmentId }, orderBy: { effectiveFrom: 'asc' } });
  }
}
