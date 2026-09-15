import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/** HRReportingService — read-only reports (spec sections 87-96). Every
 * headcount/FTE number is derived from `EmployeeAssignment` (as-of-date),
 * never from `Employment`'s own live columns (spec section 52's own
 * "Current employee fields ilə hesablanmamalıdır"). */
@Injectable()
export class HRReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  private assignmentsAsOf(tenantId: string, organizationId: string, asOfDate: Date) {
    return this.prisma.employeeAssignment.findMany({ where: { tenantId, organizationId, effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] }, include: { department: true, position: true } });
  }

  /** Headcount Report (spec section 88): headcount vs FTE are distinct
   * measures (spec section 54's own 2×0.5FTE = headcount 2 / FTE 1.0). */
  async headcountReport(tenantId: string, membershipId: string, organizationId: string, asOfDate: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assignments = await this.assignmentsAsOf(tenantId, organizationId, new Date(asOfDate));
    const byDepartment = new Map<string, { department: string; headcount: number; fte: Decimal }>();
    for (const a of assignments) {
      const key = a.departmentId;
      const entry = byDepartment.get(key) ?? { department: a.department.name, headcount: 0, fte: new Decimal(0) };
      entry.headcount += 1;
      entry.fte = entry.fte.plus(a.fte.toString());
      byDepartment.set(key, entry);
    }
    return [...byDepartment.values()].map((e) => ({ department: e.department, headcount: e.headcount, fte: e.fte.toString() }));
  }

  /** Employee List (spec section 90). */
  async employeeList(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employments = await this.prisma.employment.findMany({ where: { tenantId, organizationId }, include: { employee: { include: { physicalPerson: true } }, department: true, position: true, manager: { include: { employee: { include: { physicalPerson: true } } } } } });
    return employments.map((e) => ({ personnelNumber: e.employee.personnelNumber, employeeName: e.employee.physicalPerson.fullName, organization: organizationId, department: e.department.name, position: e.position.name, manager: e.manager?.employee.physicalPerson.fullName ?? null, employmentType: e.employmentType, fte: e.fte.toString(), hireDate: e.employmentStartDate, status: e.employmentStatus }));
  }

  /** Org Chart Report (spec section 87) delegates to
   * `EmployeeAssignmentService.orgChartAsOf` at the controller level — see
   * `HRController.orgChart`. */

  /** Employee Movement Report (spec section 91): opening headcount, hires,
   * transfers in/out, terminations, closing headcount for a period. */
  async movementReport(tenantId: string, membershipId: string, organizationId: string, periodStart: string, periodEnd: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const openingHeadcount = (await this.assignmentsAsOf(tenantId, organizationId, new Date(start.getTime() - 86_400_000))).length;
    const closingHeadcount = (await this.assignmentsAsOf(tenantId, organizationId, end)).length;
    const hires = await this.prisma.hireDocument.count({ where: { tenantId, organizationId, postingStatus: 'POSTED', hireDate: { gte: start, lte: end } } });
    const terminations = await this.prisma.terminationDocument.count({ where: { tenantId, organizationId, postingStatus: 'POSTED', terminationDate: { gte: start, lte: end } } });
    const transfersIn = await this.prisma.employeeTransfer.count({ where: { tenantId, newOrganizationId: organizationId, postingStatus: 'POSTED', effectiveDate: { gte: start, lte: end } } });
    const transfersOut = await this.prisma.employeeTransfer.count({ where: { tenantId, organizationId, postingStatus: 'POSTED', effectiveDate: { gte: start, lte: end }, newOrganizationId: { not: null } } });
    return { openingHeadcount, hires, transfersIn, transfersOut, terminations, closingHeadcount };
  }

  /** Hire Report (spec section 92). */
  async hireReport(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const hires = await this.prisma.hireDocument.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED' }, include: { employment: { include: { employee: { include: { physicalPerson: true } }, department: true, position: true } } }, orderBy: { hireDate: 'desc' } });
    return hires.map((h) => ({ employee: h.employment.employee.physicalPerson.fullName, organization: organizationId, department: h.employment.department.name, position: h.employment.position.name, hireDate: h.hireDate, probationEnd: h.employment.probationEndDate, status: h.employment.employmentStatus }));
  }

  /** Termination Report (spec section 93). */
  async terminationReport(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const terminations = await this.prisma.terminationDocument.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED' }, include: { employment: { include: { employee: { include: { physicalPerson: true } }, department: true, position: true } } }, orderBy: { terminationDate: 'desc' } });
    return terminations.map((t) => ({ employee: t.employment.employee.physicalPerson.fullName, department: t.employment.department.name, position: t.employment.position.name, terminationDate: t.terminationDate, reason: t.terminationReason, serviceLengthDays: Math.floor((t.terminationDate.getTime() - t.employment.employmentStartDate.getTime()) / 86_400_000) }));
  }

  /** Transfer History Report (spec section 94). */
  async transferHistoryReport(tenantId: string, membershipId: string, organizationId: string, employmentId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const transfers = await this.prisma.employeeTransfer.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED', employmentId }, include: { employment: { include: { employee: { include: { physicalPerson: true } } } } }, orderBy: { effectiveDate: 'desc' } });
    const withOldNew = [];
    for (const t of transfers) {
      const before = await this.prisma.employeeAssignment.findFirst({ where: { tenantId, employmentId: t.employmentId, effectiveTo: { lt: t.effectiveDate } }, orderBy: { effectiveFrom: 'desc' }, include: { department: true, position: true } });
      withOldNew.push({ employee: t.employment.employee.physicalPerson.fullName, effectiveDate: t.effectiveDate, fromDepartment: before?.department.name ?? null, toDepartment: t.newDepartmentId, fromPosition: before?.position.name ?? null, toPosition: t.newPositionId, reason: t.reason });
    }
    return withOldNew;
  }

  /** Contract Expiry Report (spec section 95): fixed-term contracts. */
  async contractExpiryReport(tenantId: string, membershipId: string, organizationId: string, withinDays = 90) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const horizon = new Date(Date.now() + withinDays * 86_400_000);
    const contracts = await this.prisma.employmentContract.findMany({ where: { tenantId, status: 'ACTIVE', effectiveTo: { not: null, lte: horizon }, employment: { organizationId } }, include: { employment: { include: { employee: { include: { physicalPerson: true } }, manager: { include: { employee: { include: { physicalPerson: true } } } } } } } });
    return contracts.map((c) => ({ employee: c.employment.employee.physicalPerson.fullName, contractNumber: c.contractNumber, endDate: c.effectiveTo, daysRemaining: c.effectiveTo ? Math.floor((c.effectiveTo.getTime() - Date.now()) / 86_400_000) : null, manager: c.employment.manager?.employee.physicalPerson.fullName ?? null }));
  }

  /** Probation Report (spec section 96). */
  async probationReport(tenantId: string, membershipId: string, organizationId: string, withinDays = 30) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const horizon = new Date(Date.now() + withinDays * 86_400_000);
    const employments = await this.prisma.employment.findMany({ where: { tenantId, organizationId, employmentStatus: 'ACTIVE', probationEndDate: { not: null, lte: horizon } }, include: { employee: { include: { physicalPerson: true } }, manager: { include: { employee: { include: { physicalPerson: true } } } } } });
    return employments.map((e) => ({ employee: e.employee.physicalPerson.fullName, probationEnd: e.probationEndDate, daysRemaining: e.probationEndDate ? Math.floor((e.probationEndDate.getTime() - Date.now()) / 86_400_000) : null, manager: e.manager?.employee.physicalPerson.fullName ?? null }));
  }

  /** Leave/Absence Foundation Report (spec section 97). */
  async leaveAbsenceReport(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const [leaves, absences] = await Promise.all([
      this.prisma.leaveRecord.findMany({ where: { tenantId, employment: { organizationId } }, include: { employment: { include: { employee: { include: { physicalPerson: true } } } } } }),
      this.prisma.absenceRecord.findMany({ where: { tenantId, employment: { organizationId } }, include: { employment: { include: { employee: { include: { physicalPerson: true } } } } } }),
    ]);
    return [
      ...leaves.map((l) => ({ employee: l.employment.employee.physicalPerson.fullName, type: l.leaveType, start: l.startDate, end: l.endDate, status: l.status })),
      ...absences.map((a) => ({ employee: a.employment.employee.physicalPerson.fullName, type: a.absenceType, start: a.startDate, end: a.endDate, status: a.status })),
    ];
  }
}
