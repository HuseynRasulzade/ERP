import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface WorkTimeHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  employmentId: string | null;
  documentType: string | null;
  documentId: string | null;
  message: string;
}

/**
 * WorkTimeHealthService (docx spec Phase 18 section 120) — computed live,
 * same principle as every other *HealthService in this codebase. Covers a
 * practical subset of the spec's own checklist.
 */
@Injectable()
export class WorkTimeHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async check(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ): Promise<WorkTimeHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: WorkTimeHealthIssue[] = [];
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const activeEmployments = await this.prisma.employment.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });

    for (const e of activeEmployments) {
      const assignment = await this.prisma.workScheduleAssignment.findFirst({
        where: {
          employmentId: e.id,
          effectiveFrom: { lte: today },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
        },
      });
      if (!assignment) {
        issues.push({
          severity: 'WARNING',
          code: 'EMPLOYEE_WITHOUT_SCHEDULE',
          employmentId: e.id,
          documentType: 'HR_EMPLOYMENT',
          documentId: e.id,
          message: `Active employment ${e.id} has no work schedule assignment as of today`,
        });
        continue;
      }
      const plan = await this.prisma.employeeDailyWorkPlan.findUnique({
        where: { employmentId_date: { employmentId: e.id, date: today } },
      });
      if (!plan) {
        issues.push({
          severity: 'WARNING',
          code: 'MISSING_DAILY_PLAN',
          employmentId: e.id,
          documentType: 'HR_EMPLOYMENT',
          documentId: e.id,
          message: `Active employment ${e.id} has no generated Daily Work Plan for today`,
        });
      }
    }

    const unresolvedIntervals = await this.prisma.attendanceInterval.findMany({
      where: {
        tenantId,
        status: {
          in: ['MISSING_CLOCK_OUT', 'MISSING_CLOCK_IN', 'DUPLICATE_FLAGGED'],
        },
      },
    });
    for (const i of unresolvedIntervals) {
      const employment = await this.prisma.employment.findFirst({
        where: { id: i.employmentId, organizationId },
      });
      if (!employment) continue;
      issues.push({
        severity: i.status === 'DUPLICATE_FLAGGED' ? 'WARNING' : 'ERROR',
        code: `UNRESOLVED_ATTENDANCE_${i.status}`,
        employmentId: i.employmentId,
        documentType: 'WORK_TIME_ATTENDANCE_INTERVAL',
        documentId: i.id,
        message: `Attendance interval ${i.status} for employment ${i.employmentId} on ${i.workDate.toISOString().slice(0, 10)} is unresolved`,
      });
    }

    const exceptionLines = await this.prisma.timesheetLine.findMany({
      where: {
        tenantId,
        timesheet: { organizationId, status: { not: 'LOCKED' } },
        validationStatus: 'EXCEPTION',
      },
    });
    for (const l of exceptionLines) {
      issues.push({
        severity: 'WARNING',
        code: 'TIMESHEET_LINE_EXCEPTION',
        employmentId: l.employmentId,
        documentType: 'WORK_TIME_TIMESHEET_LINE',
        documentId: l.id,
        message: `Timesheet line for employment ${l.employmentId} on ${l.workDate.toISOString().slice(0, 10)}: ${l.validationNotes ?? 'unresolved exception'}`,
      });
    }

    const pendingRecalculations = await this.prisma.timeCorrection.findMany({
      where: {
        tenantId,
        requiresRecalculation: true,
      },
    });
    for (const c of pendingRecalculations) {
      const employment = await this.prisma.employment.findFirst({
        where: { id: c.employmentId, organizationId },
      });
      if (!employment) continue;
      issues.push({
        severity: 'WARNING',
        code: 'RECALCULATION_REQUIRED',
        employmentId: c.employmentId,
        documentType: 'WORK_TIME_CORRECTION',
        documentId: c.id,
        message: `Correction ${c.id} touches a LOCKED timesheet and requires downstream recalculation`,
      });
    }

    const terminatedEmployments = await this.prisma.employment.findMany({
      where: {
        organizationId,
        status: 'TERMINATED',
        employmentEndDate: { not: null },
      },
    });
    for (const e of terminatedEmployments) {
      const entryAfterTermination = await this.prisma.timeEntry.findFirst({
        where: {
          tenantId,
          employmentId: e.id,
          status: 'ACTIVE',
          workDate: { gt: e.employmentEndDate! },
        },
      });
      if (entryAfterTermination) {
        issues.push({
          severity: 'ERROR',
          code: 'TIME_ENTRY_AFTER_TERMINATION',
          employmentId: e.id,
          documentType: 'WORK_TIME_TIME_ENTRY',
          documentId: entryAfterTermination.id,
          message: `Employment ${e.id} was terminated on ${e.employmentEndDate!.toISOString().slice(0, 10)} but has a time entry dated ${entryAfterTermination.workDate.toISOString().slice(0, 10)}`,
        });
      }
    }

    return issues;
  }
}
