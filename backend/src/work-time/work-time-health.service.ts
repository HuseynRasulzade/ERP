import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface WorkTimeHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  employmentId?: string;
  message: string;
}

/** WorkTimeHealthService — computed live, same convention as every other
 * health service in this codebase. */
@Injectable()
export class WorkTimeHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<WorkTimeHealthIssue[]> {
    const issues: WorkTimeHealthIssue[] = [];

    const missingPunches = await this.prisma.attendanceInterval.findMany({ where: { tenantId, status: 'MISSING_CLOCK_OUT', employment: { organizationId } } });
    for (const m of missingPunches) issues.push({ code: 'MISSING_CLOCK_OUT_UNRESOLVED', severity: 'WARNING', employmentId: m.employmentId, message: `Attendance interval on ${m.workDate.toISOString().slice(0, 10)} is missing a clock-out.` });

    const pendingRecalc = await this.prisma.timeCorrection.count({ where: { tenantId, requiresRecalculation: true, employment: { organizationId } } });
    if (pendingRecalc > 0) issues.push({ code: 'RECALCULATION_REQUIRED', severity: 'ERROR', message: `${pendingRecalc} time correction(s) require recalculation of a locked timesheet.` });

    const staleGenerated = await this.prisma.timesheet.count({ where: { tenantId, organizationId, status: 'GENERATED', generatedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
    if (staleGenerated > 0) issues.push({ code: 'TIMESHEET_STUCK_IN_GENERATED', severity: 'WARNING', message: `${staleGenerated} timesheet(s) generated over 14 days ago and never submitted.` });

    const unexplained = await this.prisma.timesheetLine.count({ where: { tenantId, validationStatus: 'UNEXPLAINED_DIFFERENCE', timesheet: { organizationId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } } });
    if (unexplained > 0) issues.push({ code: 'UNEXPLAINED_PLAN_ACTUAL_DIFFERENCE', severity: 'WARNING', message: `${unexplained} timesheet line(s) have an unexplained planned-vs-actual difference.` });

    const activeWithoutPlan = await this.prisma.employment.findMany({ where: { tenantId, organizationId, employmentStatus: 'ACTIVE' } });
    for (const e of activeWithoutPlan) {
      const plan = await this.prisma.employeeDailyWorkPlan.findFirst({ where: { tenantId, employmentId: e.id, date: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
      if (!plan) issues.push({ code: 'ACTIVE_EMPLOYMENT_WITHOUT_RECENT_PLAN', severity: 'INFO', employmentId: e.id, message: `No daily work plan generated for employment ${e.id} in the last 7 days.` });
    }

    return issues;
  }
}
