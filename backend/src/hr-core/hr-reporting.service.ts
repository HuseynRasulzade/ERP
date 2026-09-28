import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * HrReportingService — a practical subset of the docx spec Phase 17
 * reporting checklist (org chart, headcount, staffing capacity, contract
 * expiry, probation). Full drill-down/export tooling is a later reporting
 * phase's own job (disclosed simplification, same convention as every
 * other *ReportingService in this codebase).
 */
@Injectable()
export class HrReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async orgChart(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    asOfDate: Date = new Date(),
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employments = await this.prisma.employment.findMany({
      where: {
        organizationId,
        employmentStartDate: { lte: asOfDate },
        OR: [
          { employmentEndDate: null },
          { employmentEndDate: { gte: asOfDate } },
        ],
      },
      include: {
        employee: { include: { physicalPerson: true } },
        position: true,
      },
      orderBy: { employmentStartDate: 'asc' },
    });
    return employments.map((e) => ({
      employmentId: e.id,
      employeeName: e.employee.physicalPerson.fullName,
      personnelNumber: e.employee.personnelNumber,
      positionId: e.positionId,
      positionName: e.position.name,
      departmentId: e.departmentId,
      managerEmploymentId: e.managerEmploymentId,
      status: e.status,
    }));
  }

  async headcountReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employments = await this.prisma.employment.findMany({
      where: {
        organizationId,
        status: { in: ['ACTIVE', 'PLANNED', 'SUSPENDED', 'ON_LEAVE'] },
      },
    });
    const byDepartment = new Map<string, { headcount: number; fte: number }>();
    for (const e of employments) {
      const bucket = byDepartment.get(e.departmentId) ?? {
        headcount: 0,
        fte: 0,
      };
      bucket.headcount += 1;
      bucket.fte += Number(e.fte);
      byDepartment.set(e.departmentId, bucket);
    }
    return Array.from(byDepartment.entries()).map(([departmentId, v]) => ({
      departmentId,
      headcount: v.headcount,
      totalFte: Number(v.fte.toFixed(2)),
    }));
  }

  async staffingCapacityReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const table = await this.prisma.staffingTable.findFirst({
      where: { organizationId, status: 'ACTIVE' },
      include: { positions: true },
    });
    if (!table) return [];

    const results = [];
    for (const sp of table.positions) {
      const employments = await this.prisma.employment.findMany({
        where: {
          staffingPositionId: sp.id,
          status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ON_LEAVE'] },
        },
      });
      const usedHeadcount = employments.length;
      const usedFte = employments.reduce((sum, e) => sum + Number(e.fte), 0);
      results.push({
        staffingPositionId: sp.id,
        departmentId: sp.departmentId,
        positionId: sp.positionId,
        headcountLimit: Number(sp.headcountLimit),
        fteLimit: Number(sp.fteLimit),
        usedHeadcount,
        usedFte: Number(usedFte.toFixed(2)),
        remainingHeadcount: Number(sp.headcountLimit) - usedHeadcount,
        remainingFte: Number((Number(sp.fteLimit) - usedFte).toFixed(2)),
      });
    }
    return results;
  }

  async contractExpiryReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    withinDays = 30,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 86_400_000);
    const contracts = await this.prisma.employmentContract.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        effectiveTo: { not: null, lte: horizon, gte: now },
        employment: { organizationId },
      },
      include: {
        employment: {
          include: { employee: { include: { physicalPerson: true } } },
        },
      },
    });
    return contracts.map((c) => ({
      contractId: c.id,
      employmentId: c.employmentId,
      employeeName: c.employment.employee.physicalPerson.fullName,
      effectiveTo: c.effectiveTo,
      contractType: c.contractType,
    }));
  }

  async probationReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employments = await this.prisma.employment.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        probationEndDate: { not: null },
      },
      include: { employee: { include: { physicalPerson: true } } },
      orderBy: { probationEndDate: 'asc' },
    });
    const now = new Date();
    return employments.map((e) => ({
      employmentId: e.id,
      employeeName: e.employee.physicalPerson.fullName,
      probationEndDate: e.probationEndDate,
      status:
        e.probationEndDate && e.probationEndDate < now
          ? 'OVERDUE'
          : 'IN_PROGRESS',
    }));
  }
}
