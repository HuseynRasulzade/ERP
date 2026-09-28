import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { EmploymentService } from '../hr-core/employment.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { PAYROLL_LIABILITY_REGISTER } from './payroll-liability.service';

/**
 * PayrollReportingService (docx spec Phase 19 reporting sections) — reads
 * exclusively from PayrollCalculationResult/PayrollResultLine and the
 * PAYROLL_LIABILITY_REGISTER, never re-deriving numbers the calculation
 * engine already produced.
 */
@Injectable()
export class PayrollReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly employments: EmploymentService,
  ) {}

  private async requirePeriod(organizationId: string, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', periodId);
    return period;
  }

  /** Payroll register — one row per employment for the period, the
   * primary "who was paid what" report (spec: Payroll Register). */
  async register(tenantId: string, membershipId: string, organizationId: string, periodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.requirePeriod(organizationId, periodId);

    const results = await this.prisma.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: periodId, status: 'CALCULATED' },
      orderBy: { employmentId: 'asc' },
    });
    const employments = await this.prisma.employment.findMany({
      where: { id: { in: results.map((r) => r.employmentId) } },
      include: { employee: { include: { physicalPerson: true } } },
    });
    const employmentById = new Map(employments.map((e) => [e.id, e]));

    return results.map((r) => {
      const employment = employmentById.get(r.employmentId);
      const person = employment?.employee?.physicalPerson;
      return {
        employmentId: r.employmentId,
        employeeName: person?.fullName ?? null,
        departmentId: employment?.departmentId ?? null,
        version: r.version,
        gross: r.gross,
        taxableIncome: r.taxableIncome,
        employeeDeductions: r.employeeDeductions,
        net: r.net,
        employerContributions: r.employerContributions,
        employerTotalCost: r.employerTotalCost,
      };
    });
  }

  /** Payslip — one employment's full calculation trace for the period. */
  async payslip(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    periodId: string,
    employmentId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.requirePeriod(organizationId, periodId);
    const result = await this.prisma.payrollCalculationResult.findFirst({
      where: { tenantId, payrollPeriodId: periodId, employmentId, status: 'CALCULATED' },
      include: { lines: { orderBy: { calculationSequence: 'asc' } } },
    });
    if (!result) throw new NotFoundAppError('PayrollCalculationResult', employmentId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: employmentId },
      include: { employee: { include: { physicalPerson: true } } },
    });
    const person = employment?.employee?.physicalPerson;

    return {
      employmentId,
      employeeName: person?.fullName ?? null,
      period: { id: period.id, year: period.year, month: period.month, periodStart: period.periodStart, periodEnd: period.periodEnd },
      gross: result.gross,
      taxableIncome: result.taxableIncome,
      employeeDeductions: result.employeeDeductions,
      net: result.net,
      employerContributions: result.employerContributions,
      employerTotalCost: result.employerTotalCost,
      version: result.version,
      lines: result.lines,
    };
  }

  /** Employer cost report — total employer cost (gross + employer
   * contributions) per department for the period (spec section 114: cost
   * must be visible by department/cost-center, never just a tenant total). */
  async employerCostByDepartment(tenantId: string, membershipId: string, organizationId: string, periodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.requirePeriod(organizationId, periodId);
    const businessDate = period.periodEnd;

    const results = await this.prisma.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: periodId, status: 'CALCULATED' },
    });

    const byDepartment = new Map<string, { departmentId: string | null; gross: Decimal; employerContributions: Decimal; employerTotalCost: Decimal; employeeCount: number }>();
    for (const r of results) {
      const state = await this.employments.getState(r.employmentId, businessDate);
      const key = state.departmentId ?? '__NONE__';
      const bucket = byDepartment.get(key) ?? {
        departmentId: state.departmentId,
        gross: new Decimal(0),
        employerContributions: new Decimal(0),
        employerTotalCost: new Decimal(0),
        employeeCount: 0,
      };
      bucket.gross = bucket.gross.plus(r.gross.toString());
      bucket.employerContributions = bucket.employerContributions.plus(r.employerContributions.toString());
      bucket.employerTotalCost = bucket.employerTotalCost.plus(r.employerTotalCost.toString());
      bucket.employeeCount += 1;
      byDepartment.set(key, bucket);
    }

    return Array.from(byDepartment.values()).map((b) => ({
      departmentId: b.departmentId,
      employeeCount: b.employeeCount,
      gross: b.gross.toFixed(2),
      employerContributions: b.employerContributions.toFixed(2),
      employerTotalCost: b.employerTotalCost.toFixed(2),
    }));
  }

  /** Liability report — outstanding balance per statutory category for
   * every employment that had a movement in this period (spec: "what do
   * we still owe, and to whom" — never derived by re-summing gross/net,
   * always read from the PAYROLL_LIABILITY_REGISTER itself). */
  async liabilityReport(tenantId: string, membershipId: string, organizationId: string, periodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.requirePeriod(organizationId, periodId);

    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: PAYROLL_LIABILITY_REGISTER,
        dimensions: { path: ['payrollPeriodId'], equals: periodId },
      },
    });
    if (movements.length === 0) return [];

    const employmentIds = new Set<string>();
    for (const m of movements) {
      const dims = m.dimensions as { employmentId?: string } | null;
      if (dims?.employmentId) employmentIds.add(dims.employmentId);
    }

    const byEmploymentCategory = new Map<string, Decimal>();
    for (const m of movements) {
      const dims = m.dimensions as { employmentId?: string } | null;
      const resources = m.resources as { amount?: string; direction?: string } | null;
      if (!dims?.employmentId) continue;
      const key = `${dims.employmentId}|${m.movementType}`;
      const amount = new Decimal(resources?.amount ?? '0');
      const signed = resources?.direction === 'DECREASE' ? amount.negated() : amount;
      byEmploymentCategory.set(key, (byEmploymentCategory.get(key) ?? new Decimal(0)).plus(signed));
    }

    const rows: Array<{ employmentId: string; category: string; outstanding: string }> = [];
    for (const [key, amount] of byEmploymentCategory) {
      const [employmentId, category] = key.split('|');
      if (amount.lte(0)) continue;
      rows.push({ employmentId, category, outstanding: amount.toFixed(2) });
    }
    return rows;
  }
}
