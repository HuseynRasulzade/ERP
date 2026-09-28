import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * WorkTimeReportingService — a practical subset of the docx spec Phase 18
 * reporting checklist (sections 111-119): monthly summary, plan-vs-actual,
 * overtime, night/holiday-weekend work, attendance exceptions, monthly
 * norm. Built directly from TimesheetLine/OvertimeRecord/AttendanceInterval
 * — never from raw attendance for anything payroll-adjacent.
 */
@Injectable()
export class WorkTimeReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async monthlySummary(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: string,
    toDate: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employments = await this.prisma.employment.findMany({
      where: { organizationId },
    });
    const results = [];
    for (const e of employments) {
      const agg = await this.prisma.timesheetLine.aggregate({
        where: {
          tenantId,
          employmentId: e.id,
          workDate: {
            gte: this.parseDate(fromDate),
            lte: this.parseDate(toDate),
          },
        },
        _sum: {
          plannedHours: true,
          regularHours: true,
          overtimeHours: true,
          nightHours: true,
          holidayHours: true,
          weekendHours: true,
          leaveHours: true,
          absenceHours: true,
          businessTripHours: true,
          paidHours: true,
          unpaidHours: true,
          workedDayFraction: true,
        },
      });
      if (!agg._sum.plannedHours && !agg._sum.regularHours) continue;
      results.push({ employmentId: e.id, ...this.toPlain(agg._sum) });
    }
    return results;
  }

  async planVsActual(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: string,
    toDate: string,
  ) {
    const summaries = await this.monthlySummary(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
    return summaries.map((s) => ({
      employmentId: s.employmentId,
      plannedHours: s.plannedHours,
      workedHours: Number(s.regularHours) + Number(s.overtimeHours),
      difference:
        Number(s.plannedHours) -
        (Number(s.regularHours) + Number(s.overtimeHours)),
      leaveHours: s.leaveHours,
      absenceHours: s.absenceHours,
      overtimeHours: s.overtimeHours,
    }));
  }

  async overtimeReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: string,
    toDate: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employments = await this.prisma.employment.findMany({
      where: { organizationId },
      select: { id: true, departmentId: true },
    });
    const employmentIds = employments.map((e) => e.id);
    const records = await this.prisma.overtimeRecord.findMany({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        date: { gte: this.parseDate(fromDate), lte: this.parseDate(toDate) },
      },
      orderBy: { date: 'asc' },
    });
    return records.map((r) => ({
      employmentId: r.employmentId,
      departmentId: employments.find((e) => e.id === r.employmentId)
        ?.departmentId,
      date: r.date,
      requestedHours: r.requestedHours,
      approvedHours: r.approvedHours,
      actualHours: r.actualHours,
      status: r.status,
    }));
  }

  async nightWorkReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: string,
    toDate: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employmentIds = (
      await this.prisma.employment.findMany({
        where: { organizationId },
        select: { id: true },
      })
    ).map((e) => e.id);
    return this.prisma.timesheetLine.findMany({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        workDate: {
          gte: this.parseDate(fromDate),
          lte: this.parseDate(toDate),
        },
        nightHours: { gt: 0 },
      },
      orderBy: { workDate: 'asc' },
    });
  }

  async holidayWeekendReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: string,
    toDate: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employmentIds = (
      await this.prisma.employment.findMany({
        where: { organizationId },
        select: { id: true },
      })
    ).map((e) => e.id);
    return this.prisma.timesheetLine.findMany({
      where: {
        tenantId,
        employmentId: { in: employmentIds },
        workDate: {
          gte: this.parseDate(fromDate),
          lte: this.parseDate(toDate),
        },
        OR: [{ holidayHours: { gt: 0 } }, { weekendHours: { gt: 0 } }],
      },
      orderBy: { workDate: 'asc' },
    });
  }

  async attendanceExceptionsReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: string,
    toDate: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employmentIds = (
      await this.prisma.employment.findMany({
        where: { organizationId },
        select: { id: true },
      })
    ).map((e) => e.id);
    const [intervals, lines] = await Promise.all([
      this.prisma.attendanceInterval.findMany({
        where: {
          tenantId,
          employmentId: { in: employmentIds },
          workDate: {
            gte: this.parseDate(fromDate),
            lte: this.parseDate(toDate),
          },
          status: { not: 'OK' },
        },
      }),
      this.prisma.timesheetLine.findMany({
        where: {
          tenantId,
          employmentId: { in: employmentIds },
          workDate: {
            gte: this.parseDate(fromDate),
            lte: this.parseDate(toDate),
          },
          validationStatus: 'EXCEPTION',
        },
      }),
    ]);
    return { attendanceIntervals: intervals, timesheetLines: lines };
  }

  private toPlain(sum: Record<string, Decimal | null>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(sum))
      out[k] = (v ?? new Decimal(0)).toString();
    return out;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
