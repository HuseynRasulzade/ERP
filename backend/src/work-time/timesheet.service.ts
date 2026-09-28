import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { OvertimeService } from './overtime.service';
import { WorkTimeRegisterService } from './work-time-register.service';
import { computeNightOverlapMinutes } from './night-hours.util';
import { TimeCode, TimeCodes } from './time-codes';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  ApproveTimesheetDto,
  GenerateTimesheetDto,
  LockTimesheetDto,
  ReopenTimesheetDto,
  SubmitTimesheetDto,
} from './dto/work-time.dto';

const TIMESHEET_TYPE = 'WORK_TIME_TIMESHEET';
const EDITABLE_STATUSES = ['DRAFT', 'GENERATED', 'IN_PROGRESS', 'REOPENED'];
const NON_SCHEDULED_DAY_TYPES = new Set([
  'HOLIDAY',
  'WEEKEND',
  'NON_WORKING_DAY',
  'TRANSFERRED_WORKDAY',
]);
const ABSENCE_LIKE_CODES = new Set<TimeCode>([
  TimeCodes.ABSENCE,
  TimeCodes.DOWNTIME,
  TimeCodes.OTHER,
]);

/**
 * TimesheetService (docx spec Phase 18 sections 26-31, 47-48) — combines
 * EmployeeDailyWorkPlan + TimeEntry into TimesheetLine per employment/day.
 * The critical rule (sections 47-48): REGULAR_WORK/OVERTIME are the only
 * two buckets that make up "total worked hours"; NIGHT/HOLIDAY/WEEKEND are
 * separate premium OVERLAY measures computed independently from the same
 * source hours — they are never added into the worked-hours total, so an
 * hour that is both overtime and night is never double-counted.
 *
 * Plan-vs-actual (section 31): a positive difference between actual
 * REGULAR_WORK hours and (planned hours + approved overtime) is never
 * silently absorbed as overtime, absence, or dropped — it is excluded from
 * every hours bucket and the line is flagged `EXCEPTION` with a note
 * naming the unexplained amount, for a human to review.
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly overtime: OvertimeService,
    private readonly register: WorkTimeRegisterService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    status?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.timesheet.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { periodStart: 'desc' },
    });
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.timesheet.findFirst({
      where: { id, organizationId },
      include: {
        lines: { orderBy: [{ employmentId: 'asc' }, { workDate: 'asc' }] },
      },
    });
    if (!row) throw new NotFoundAppError('Timesheet', id);
    return row;
  }

  async generate(
    tenantId: string,
    membershipId: string,
    userId: string,
    dto: GenerateTimesheetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    const periodStart = this.parseDate(dto.periodStart);
    const periodEnd = this.parseDate(dto.periodEnd);
    if (periodEnd < periodStart)
      throw new ValidationAppError('periodEnd cannot be before periodStart');

    let timesheet = await this.prisma.timesheet.findFirst({
      where: {
        organizationId: dto.organizationId,
        departmentId: dto.departmentId ?? null,
        periodStart,
        periodEnd,
      },
    });
    if (timesheet && !EDITABLE_STATUSES.includes(timesheet.status))
      throw new ValidationAppError(
        `Cannot regenerate a timesheet in status ${timesheet.status} — reopen it first`,
      );
    if (!timesheet) {
      timesheet = await this.prisma.timesheet.create({
        data: {
          tenantId,
          organizationId: dto.organizationId,
          departmentId: dto.departmentId,
          periodStart,
          periodEnd,
          status: 'GENERATED',
          generatedAt: new Date(),
          createdBy: userId,
        },
      });
    } else {
      timesheet = await this.prisma.timesheet.update({
        where: { id: timesheet.id },
        data: { status: 'GENERATED', generatedAt: new Date() },
      });
    }

    for (const employmentId of dto.employmentIds) {
      for (
        let d = new Date(periodStart);
        d <= periodEnd;
        d = this.addDays(d, 1)
      ) {
        await this.generateLine(
          tenantId,
          timesheet.id,
          employmentId,
          new Date(d),
        );
      }
    }

    await this.audit.record({
      tenantId,
      eventType: 'WORK_TIME_TIMESHEET_GENERATED',
      entityType: TIMESHEET_TYPE,
      entityId: timesheet.id,
      action: 'CREATE',
      userId,
    });
    return this.get(tenantId, membershipId, dto.organizationId, timesheet.id);
  }

  private async generateLine(
    tenantId: string,
    timesheetId: string,
    employmentId: string,
    date: Date,
  ) {
    const [plan, entries] = await Promise.all([
      this.prisma.employeeDailyWorkPlan.findUnique({
        where: { employmentId_date: { employmentId, date } },
      }),
      this.prisma.timeEntry.findMany({
        where: { tenantId, employmentId, workDate: date, status: 'ACTIVE' },
      }),
    ]);

    const plannedHours = plan?.plannedHours
      ? new Decimal(plan.plannedHours.toString())
      : new Decimal(0);
    const plannedDayType = plan?.plannedDayType ?? 'NO_SCHEDULE';

    const regularSourceEntries = entries.filter(
      (e) => e.timeCode === TimeCodes.REGULAR_WORK,
    );
    const regularSourceHours = this.sumHours(regularSourceEntries);
    const trainingHours = this.sumHours(
      entries.filter((e) => e.timeCode === TimeCodes.TRAINING),
    );
    const businessTripHours = this.sumHours(
      entries.filter((e) => e.timeCode === TimeCodes.BUSINESS_TRIP),
    );
    const paidLeaveHours = this.sumHours(
      entries.filter(
        (e) =>
          e.timeCode === TimeCodes.ANNUAL_LEAVE ||
          e.timeCode === TimeCodes.SICK_LEAVE,
      ),
    );
    const unpaidLeaveHours = this.sumHours(
      entries.filter((e) => e.timeCode === TimeCodes.UNPAID_LEAVE),
    );
    const leaveHours = paidLeaveHours.plus(unpaidLeaveHours);
    const absenceHours = this.sumHours(
      entries.filter((e) => ABSENCE_LIKE_CODES.has(e.timeCode as TimeCode)),
    );

    let regularHours: Decimal;
    let overtimeHours = new Decimal(0);
    let holidayHours = new Decimal(0);
    let weekendHours = new Decimal(0);
    let validationStatus = 'OK';
    let validationNotes: string | null = null;

    const isNonScheduledWork =
      plannedHours.lte(0) &&
      regularSourceHours.gt(0) &&
      NON_SCHEDULED_DAY_TYPES.has(plannedDayType);

    if (isNonScheduledWork) {
      regularHours = regularSourceHours.plus(trainingHours);
      if (plannedDayType === 'HOLIDAY') holidayHours = regularSourceHours;
      else weekendHours = regularSourceHours;
    } else {
      const approvedOvertime = await this.overtime.getApprovedHours(
        tenantId,
        employmentId,
        date,
      );
      const cappedRegular = Decimal.min(regularSourceHours, plannedHours);
      const excess = Decimal.max(0, regularSourceHours.minus(plannedHours));
      overtimeHours = Decimal.min(excess, approvedOvertime);
      const unexplained = Decimal.max(0, excess.minus(approvedOvertime));
      regularHours = cappedRegular.plus(trainingHours);
      if (unexplained.gt(0)) {
        validationStatus = 'EXCEPTION';
        validationNotes = `${unexplained.toFixed(2)}h worked beyond plan + approved overtime`;
      }
    }

    // Night-hours overlay — independent of the regular/overtime split,
    // computed from the same source entries' actual clock intervals.
    let nightMinutes = 0;
    for (const e of regularSourceEntries) {
      if (e.startTime && e.endTime)
        nightMinutes += computeNightOverlapMinutes(e.startTime, e.endTime);
    }
    const nightHours = new Decimal(nightMinutes).div(60);

    const hasMissingPunch = await this.prisma.attendanceInterval.findFirst({
      where: {
        tenantId,
        employmentId,
        workDate: date,
        status: {
          in: ['MISSING_CLOCK_OUT', 'MISSING_CLOCK_IN', 'DUPLICATE_FLAGGED'],
        },
      },
    });
    if (hasMissingPunch && validationStatus === 'OK') {
      validationStatus = 'EXCEPTION';
      validationNotes = `Unresolved attendance exception: ${hasMissingPunch.status}`;
    }

    const paidHours = regularHours
      .plus(overtimeHours)
      .plus(businessTripHours)
      .plus(paidLeaveHours);
    const unpaidHours = unpaidLeaveHours.plus(absenceHours);
    const workedDayFraction =
      regularHours.gt(0) || overtimeHours.gt(0) || businessTripHours.gt(0)
        ? new Decimal(plan?.fte?.toString() ?? '1')
        : new Decimal(0);

    await this.prisma.timesheetLine.upsert({
      where: {
        timesheetId_employmentId_workDate: {
          timesheetId,
          employmentId,
          workDate: date,
        },
      },
      create: {
        tenantId,
        timesheetId,
        employmentId,
        workDate: date,
        departmentId: plan?.departmentId,
        plannedHours,
        regularHours,
        overtimeHours,
        nightHours,
        holidayHours,
        weekendHours,
        leaveHours,
        absenceHours,
        businessTripHours,
        paidHours,
        unpaidHours,
        workedDayFraction,
        validationStatus,
        validationNotes,
      },
      update: {
        departmentId: plan?.departmentId,
        plannedHours,
        regularHours,
        overtimeHours,
        nightHours,
        holidayHours,
        weekendHours,
        leaveHours,
        absenceHours,
        businessTripHours,
        paidHours,
        unpaidHours,
        workedDayFraction,
        validationStatus,
        validationNotes,
      },
    });
  }

  async submit(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: SubmitTimesheetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (!['GENERATED', 'IN_PROGRESS'].includes(timesheet.status))
      throw new ValidationAppError(
        `Cannot submit a timesheet in status ${timesheet.status}`,
      );
    if (timesheet.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const result = await this.prisma.timesheet.updateMany({
      where: { id, version: dto.expectedVersion },
      data: {
        status: 'PENDING_APPROVAL',
        submittedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ApproveTimesheetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (timesheet.status !== 'PENDING_APPROVAL')
      throw new ValidationAppError(
        `Cannot approve a timesheet in status ${timesheet.status}`,
      );
    if (timesheet.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const openExceptions = timesheet.lines.filter(
      (l) => l.validationStatus === 'EXCEPTION',
    );
    if (openExceptions.length > 0)
      throw new ValidationAppError(
        `Cannot approve: ${openExceptions.length} line(s) still have unresolved validation exceptions`,
      );

    const result = await this.prisma.timesheet.updateMany({
      where: { id, version: dto.expectedVersion },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'WORK_TIME_TIMESHEET_APPROVED',
      entityType: TIMESHEET_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  /** Locks an APPROVED timesheet and writes its lines to WorkTimeRegister
   * (spec sections 108-110) — the only path that ever populates the
   * approved-layer register, and it happens exactly once per timesheet. */
  async lock(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: LockTimesheetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (timesheet.status !== 'APPROVED')
      throw new ValidationAppError(
        `Cannot lock a timesheet in status ${timesheet.status}`,
      );
    if (timesheet.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      await this.register.writeFromTimesheet(tenantId, id, tx);

      const result = await tx.timesheet.updateMany({
        where: { id, version: dto.expectedVersion },
        data: {
          status: 'LOCKED',
          lockedAt: new Date(),
          lockedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'WORK_TIME_TIMESHEET_LOCKED',
          entityType: TIMESHEET_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
        },
        tx,
      );
      return tx.timesheet.findFirst({
        where: { id },
        include: { lines: true },
      });
    });
  }

  async reopen(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ReopenTimesheetDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (!['APPROVED', 'LOCKED'].includes(timesheet.status))
      throw new ValidationAppError(
        `Cannot reopen a timesheet in status ${timesheet.status}`,
      );

    const result = await this.prisma.timesheet.updateMany({
      where: { id },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenReason: dto.reason,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'WORK_TIME_TIMESHEET_REOPENED',
      entityType: TIMESHEET_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      reason: dto.reason,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async assertEditable(tenantId: string, employmentId: string, workDate: Date) {
    const line = await this.prisma.timesheetLine.findFirst({
      where: {
        tenantId,
        employmentId,
        workDate,
        timesheet: { status: 'LOCKED' },
      },
    });
    if (line)
      throw new ValidationAppError(
        'This date belongs to a LOCKED timesheet — use a Time Correction instead of a direct edit',
      );
  }

  private sumHours(entries: { hours: Decimal }[]): Decimal {
    return entries.reduce(
      (sum, e) => sum.plus(e.hours.toString()),
      new Decimal(0),
    );
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
