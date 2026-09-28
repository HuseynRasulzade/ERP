import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { TimeCodes } from './time-codes';
import { resolveCycleDay } from './daily-work-plan.service';
import { WorkTimePeriodService } from './work-time-period.service';
import { CreateManualTimeEntryDto } from './dto/work-time.dto';

const OVERRIDE_SOURCES = new Set(['MANUAL', 'CORRECTION']);

const LEAVE_TYPE_TO_TIME_CODE: Record<string, string> = {
  ANNUAL: TimeCodes.ANNUAL_LEAVE,
  UNPAID: TimeCodes.UNPAID_LEAVE,
  SICK: TimeCodes.SICK_LEAVE,
  MATERNITY: TimeCodes.UNPAID_LEAVE,
  PATERNITY: TimeCodes.UNPAID_LEAVE,
  STUDY: TimeCodes.UNPAID_LEAVE,
  OTHER: TimeCodes.UNPAID_LEAVE,
};

/**
 * TimeEntryService (docx spec Phase 18 section 23) — normalizes
 * AttendanceInterval rows and Phase 17 Leave/Absence records into TimeEntry
 * rows. A date that already carries a MANUAL or CORRECTION-sourced active
 * entry is never touched by regeneration — manual/corrected data always
 * wins over auto-derived data (spec section 58's correction model).
 *
 * Disclosed simplification: Phase 17's AbsenceRecord/LeaveRecord are whole
 * date-range records with no partial-day hour field, so auto-generation
 * here only produces whole-day entries (hours = that date's planned
 * hours). Partial-day leave/absence (spec test 149: 6h regular + 2h
 * absence) is entered directly as a manual TimeEntry alongside the
 * attendance-derived entry for the same date — Timesheet generation sums
 * every TimeEntry for a date, so this composes correctly without needing
 * Phase 17's schema to carry hour granularity it doesn't have.
 */
@Injectable()
export class TimeEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: WorkTimePeriodService,
  ) {}

  list(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    return this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        employmentId,
        workDate: {
          gte: this.parseDate(fromDate),
          lte: this.parseDate(toDate),
        },
        status: 'ACTIVE',
      },
      orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createManual(
    tenantId: string,
    userId: string,
    dto: CreateManualTimeEntryDto,
  ) {
    const workDate = this.parseDate(dto.workDate);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, tenantId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this tenant',
      );
    await this.periods.assertOpen(
      tenantId,
      employment.organizationId,
      workDate,
    );

    return this.prisma.timeEntry.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        workDate,
        startTime: dto.startTime ? new Date(dto.startTime) : undefined,
        endTime: dto.endTime ? new Date(dto.endTime) : undefined,
        hours: new Decimal(dto.hours),
        timeCode: dto.timeCode,
        source: 'MANUAL',
        createdBy: userId,
      },
    });
  }

  /** Generates REGULAR_WORK TimeEntry rows from interpreted attendance
   * intervals, subtracting that date's scheduled break (spec section 50). */
  async generateFromAttendance(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    const from = this.parseDate(fromDate);
    const to = this.parseDate(toDate);
    const created = [];

    for (let d = new Date(from); d <= to; d = this.addDays(d, 1)) {
      const date = new Date(d);
      if (await this.hasOverride(tenantId, employmentId, date)) continue;

      const intervals = await this.prisma.attendanceInterval.findMany({
        where: { tenantId, employmentId, workDate: date, status: 'OK' },
      });
      await this.clearAutoSource(tenantId, employmentId, date, 'ATTENDANCE');
      if (intervals.length === 0) continue;

      const breakMinutes = await this.resolveBreakMinutes(
        tenantId,
        employmentId,
        date,
      );
      let totalMinutes = intervals.reduce(
        (sum, i) => sum + (i.durationMinutes ?? 0),
        0,
      );
      totalMinutes = Math.max(0, totalMinutes - breakMinutes);
      if (totalMinutes === 0) continue;

      const hours = new Decimal(totalMinutes).div(60);
      const earliestStart = intervals.reduce<Date | null>(
        (min, i) =>
          i.startTime && (!min || i.startTime < min) ? i.startTime : min,
        null,
      );
      const latestEnd = intervals.reduce<Date | null>(
        (max, i) => (i.endTime && (!max || i.endTime > max) ? i.endTime : max),
        null,
      );
      created.push(
        await this.prisma.timeEntry.create({
          data: {
            tenantId,
            employmentId,
            workDate: date,
            startTime: earliestStart ?? undefined,
            endTime: latestEnd ?? undefined,
            hours,
            timeCode: TimeCodes.REGULAR_WORK,
            source: 'ATTENDANCE',
            sourceDocumentType: 'ATTENDANCE_INTERVAL',
            sourceDocumentId: intervals[0].id,
          },
        }),
      );
    }
    return created;
  }

  /** Generates whole-day TimeEntry rows from Phase 17 LeaveRecord
   * (APPROVED) and AbsenceRecord over the date range (spec sections 32-37). */
  async generateFromLeaveAbsence(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    const from = this.parseDate(fromDate);
    const to = this.parseDate(toDate);
    const created = [];

    const [leaves, absences] = await Promise.all([
      this.prisma.leaveRecord.findMany({
        where: {
          employmentId,
          status: 'APPROVED',
          startDate: { lte: to },
          endDate: { gte: from },
        },
      }),
      this.prisma.absenceRecord.findMany({
        where: { employmentId, startDate: { lte: to }, endDate: { gte: from } },
      }),
    ]);

    for (let d = new Date(from); d <= to; d = this.addDays(d, 1)) {
      const date = new Date(d);
      if (await this.hasOverride(tenantId, employmentId, date)) continue;

      const leave = leaves.find(
        (l) => l.startDate <= date && l.endDate >= date,
      );
      const absence = absences.find(
        (a) => a.startDate <= date && a.endDate >= date,
      );
      await this.clearAutoSource(tenantId, employmentId, date, 'LEAVE');
      await this.clearAutoSource(tenantId, employmentId, date, 'ABSENCE');
      await this.clearAutoSource(tenantId, employmentId, date, 'BUSINESS_TRIP');
      if (!leave && !absence) continue;

      const plan = await this.prisma.employeeDailyWorkPlan.findUnique({
        where: { employmentId_date: { employmentId, date } },
      });
      const plannedHours = plan?.plannedHours ?? new Decimal(0);
      if (plannedHours.lte(0)) continue;

      if (leave) {
        created.push(
          await this.prisma.timeEntry.create({
            data: {
              tenantId,
              employmentId,
              workDate: date,
              hours: plannedHours,
              timeCode:
                LEAVE_TYPE_TO_TIME_CODE[leave.leaveType] ??
                TimeCodes.UNPAID_LEAVE,
              source: 'LEAVE',
              sourceDocumentType: 'HR_LEAVE_RECORD',
              sourceDocumentId: leave.id,
            },
          }),
        );
      } else if (absence) {
        const isBusinessTrip = absence.absenceType === 'BUSINESS_TRIP';
        created.push(
          await this.prisma.timeEntry.create({
            data: {
              tenantId,
              employmentId,
              workDate: date,
              hours: plannedHours,
              timeCode: isBusinessTrip
                ? TimeCodes.BUSINESS_TRIP
                : TimeCodes.ABSENCE,
              source: isBusinessTrip ? 'BUSINESS_TRIP' : 'ABSENCE',
              sourceDocumentType: 'HR_ABSENCE_RECORD',
              sourceDocumentId: absence.id,
            },
          }),
        );
      }
    }
    return created;
  }

  private async hasOverride(
    tenantId: string,
    employmentId: string,
    date: Date,
  ): Promise<boolean> {
    const override = await this.prisma.timeEntry.findFirst({
      where: {
        tenantId,
        employmentId,
        workDate: date,
        status: 'ACTIVE',
        source: { in: Array.from(OVERRIDE_SOURCES) },
      },
    });
    return !!override;
  }

  private async clearAutoSource(
    tenantId: string,
    employmentId: string,
    date: Date,
    source: string,
  ) {
    await this.prisma.timeEntry.deleteMany({
      where: {
        tenantId,
        employmentId,
        workDate: date,
        source,
        status: 'ACTIVE',
      },
    });
  }

  private async resolveBreakMinutes(
    tenantId: string,
    employmentId: string,
    date: Date,
  ): Promise<number> {
    const plan = await this.prisma.employeeDailyWorkPlan.findUnique({
      where: { employmentId_date: { employmentId, date } },
    });
    if (!plan?.scheduleTemplateId) return 0;
    const template = await this.prisma.workScheduleTemplate.findUnique({
      where: { id: plan.scheduleTemplateId },
    });
    if (!template) return 0;
    const cycleDay = resolveCycleDay(date, template.cycleLengthDays);
    const pattern = await this.prisma.workSchedulePattern.findUnique({
      where: {
        scheduleTemplateId_cycleDay: {
          scheduleTemplateId: template.id,
          cycleDay,
        },
      },
    });
    return pattern?.breakDurationMinutes ?? 0;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
