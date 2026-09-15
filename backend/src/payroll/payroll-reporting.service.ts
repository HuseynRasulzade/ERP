import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * PayrollReportingService (spec sections 119-120, 136-137). Statutory
 * report data is always assembled from `PayrollResultLine`/
 * `PayrollCalculationResult` — the employee-level subledger — never
 * derived from the GL (spec section 120's own explicit instruction).
 */
@Injectable()
export class PayrollReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** Statutory Reporting Foundation (spec section 119). */
  async statutoryReport(tenantId: string, membershipId: string, organizationId: string, payrollPeriodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const results = await this.prisma.payrollCalculationResult.findMany({ where: { tenantId, organizationId, payrollPeriodId, status: { not: 'SUPERSEDED' } }, include: { lines: true, employment: { include: { employee: { include: { physicalPerson: true } } } } } });
    return results.map((r) => {
      const incomeTax = r.lines.find((l) => l.calculationCode === 'INCOME_TAX')?.amount.toString() ?? '0';
      const employeeSocial = r.lines.find((l) => l.calculationCode === 'EMPLOYEE_SOCIAL_INSURANCE')?.amount.toString() ?? '0';
      const employerSocial = r.lines.find((l) => l.calculationCode === 'EMPLOYER_SOCIAL_INSURANCE')?.amount.toString() ?? '0';
      const employeeUnemployment = r.lines.find((l) => l.calculationCode === 'EMPLOYEE_UNEMPLOYMENT_INSURANCE')?.amount.toString() ?? '0';
      const employeeMedical = r.lines.find((l) => l.calculationCode === 'EMPLOYEE_MEDICAL_INSURANCE')?.amount.toString() ?? '0';
      return { employee: r.employment.employee.physicalPerson.fullName, personnelNumber: r.employment.employee.personnelNumber, taxableBase: r.taxableIncome.toString(), incomeTax, employeeSocialInsurance: employeeSocial, employerSocialInsurance: employerSocial, employeeUnemploymentInsurance: employeeUnemployment, employeeMedicalInsurance: employeeMedical };
    });
  }

  /** Employer Total Cost (spec section 136). */
  async employerCostReport(tenantId: string, membershipId: string, organizationId: string, payrollPeriodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const results = await this.prisma.payrollCalculationResult.findMany({ where: { tenantId, organizationId, payrollPeriodId, status: { not: 'SUPERSEDED' } } });
    const gross = results.reduce((s, r) => s.plus(r.gross.toString()), new Decimal(0));
    const employerContributions = results.reduce((s, r) => s.plus(r.employerContributions.toString()), new Decimal(0));
    const totalCost = results.reduce((s, r) => s.plus(r.employerTotalCost.toString()), new Decimal(0));
    return { grossSalary: gross.toString(), employerContributions: employerContributions.toString(), totalLaborCost: totalCost.toString(), employeeCount: results.length };
  }

  /** Payroll Analytics (spec section 137) — by department/position via
   * the effective HR assignment, never a stale current-state field. */
  async analyticsByDepartment(tenantId: string, membershipId: string, organizationId: string, payrollPeriodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const results = await this.prisma.payrollCalculationResult.findMany({ where: { tenantId, organizationId, payrollPeriodId, status: { not: 'SUPERSEDED' } }, include: { employment: { include: { department: true } } } });
    const byDept = new Map<string, { department: string; gross: Decimal; net: Decimal; employerCost: Decimal; headcount: number }>();
    for (const r of results) {
      const key = r.employment.departmentId;
      const entry = byDept.get(key) ?? { department: r.employment.department.name, gross: new Decimal(0), net: new Decimal(0), employerCost: new Decimal(0), headcount: 0 };
      entry.gross = entry.gross.plus(r.gross.toString());
      entry.net = entry.net.plus(r.net.toString());
      entry.employerCost = entry.employerCost.plus(r.employerTotalCost.toString());
      entry.headcount += 1;
      byDept.set(key, entry);
    }
    return [...byDept.values()].map((e) => ({ department: e.department, gross: e.gross.toString(), net: e.net.toString(), employerCost: e.employerCost.toString(), headcount: e.headcount }));
  }
}
