import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CreateCompensationAssignmentDto } from './dto/payroll.dto';

export interface CompensationSegment {
  from: Date;
  to: Date;
  assignment: {
    id: string;
    payBasis: string;
    baseSalary: Decimal | null;
    hourlyRate: Decimal | null;
    dailyRate: Decimal | null;
    fteBasis: string;
  };
}

/**
 * CompensationService — EmployeeCompensationAssignment CRUD (docx spec
 * Phase 19 sections 9-12). Never overwritten: a salary change is a new
 * row with its own `effectiveFrom`, so `resolveSegments()` can split a
 * payroll period at each change boundary (spec section 12's own mid-month
 * raise example) without ever losing the January-June history.
 */
@Injectable()
export class CompensationService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, employmentId: string) {
    return this.prisma.employeeCompensationAssignment.findMany({
      where: { tenantId, employmentId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateCompensationAssignmentDto) {
    if (dto.payBasis === 'MONTHLY_SALARY' && dto.baseSalary === undefined)
      throw new ValidationAppError('baseSalary is required for MONTHLY_SALARY pay basis');
    if (dto.payBasis === 'HOURLY' && dto.hourlyRate === undefined)
      throw new ValidationAppError('hourlyRate is required for HOURLY pay basis');
    if (dto.payBasis === 'DAILY' && dto.dailyRate === undefined)
      throw new ValidationAppError('dailyRate is required for DAILY pay basis');

    const effectiveFrom = this.parseDate(dto.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const overlapping = await tx.employeeCompensationAssignment.findFirst({
        where: {
          employmentId: dto.employmentId,
          status: 'ACTIVE',
          effectiveFrom: { lt: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (overlapping) {
        const dayBefore = new Date(effectiveFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await tx.employeeCompensationAssignment.update({
          where: { id: overlapping.id },
          data: { effectiveTo: dayBefore },
        });
      }

      return tx.employeeCompensationAssignment.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          effectiveFrom,
          effectiveTo: dto.effectiveTo ? this.parseDate(dto.effectiveTo) : undefined,
          compensationType: dto.compensationType,
          payBasis: dto.payBasis,
          baseSalary: dto.baseSalary !== undefined ? new Decimal(dto.baseSalary) : undefined,
          hourlyRate: dto.hourlyRate !== undefined ? new Decimal(dto.hourlyRate) : undefined,
          dailyRate: dto.dailyRate !== undefined ? new Decimal(dto.dailyRate) : undefined,
          currencyId: dto.currencyId,
          fteBasis: dto.fteBasis,
          salaryGrade: dto.salaryGrade,
          createdBy: userId,
        },
      });
    });
  }

  /** Splits [periodStart, periodEnd] at every compensation-change boundary
   * within the range, returning one segment per applicable assignment
   * (spec section 12: mid-month salary change support). */
  async resolveSegments(
    tenantId: string,
    employmentId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<CompensationSegment[]> {
    const assignments = await this.prisma.employeeCompensationAssignment.findMany({
      where: {
        tenantId,
        employmentId,
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    if (assignments.length === 0) return [];

    const breakpoints = new Set<number>([periodStart.getTime()]);
    for (const a of assignments) {
      if (a.effectiveFrom.getTime() > periodStart.getTime() && a.effectiveFrom.getTime() <= periodEnd.getTime()) {
        breakpoints.add(a.effectiveFrom.getTime());
      }
    }
    const sorted = Array.from(breakpoints).sort((a, b) => a - b);

    const segments: CompensationSegment[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const segStart = new Date(sorted[i]);
      const segEnd =
        i + 1 < sorted.length ? new Date(sorted[i + 1] - 86_400_000) : periodEnd;
      const applicable = [...assignments]
        .reverse()
        .find(
          (a) =>
            a.effectiveFrom.getTime() <= segStart.getTime() &&
            (!a.effectiveTo || a.effectiveTo.getTime() >= segStart.getTime()),
        );
      if (applicable) segments.push({ from: segStart, to: segEnd, assignment: applicable });
    }
    return segments;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
