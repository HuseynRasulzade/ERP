import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { ProductionCalendarService } from './production-calendar.service';
import { TimeCodeService } from './time-code.service';

const NIGHT_WINDOW = { startHour: 22, endHour: 6 }; // 22:00-06:00 (spec section 42's own example) — not per-tenant configurable in this build, disclosed simplification, see docs/WORK_TIME.md

/**
 * TimeEntryService (spec sections 23, 42-51). Base classification
 * (REGULAR_WORK vs OVERTIME) is a SEPARATE TimeEntry from premium
 * attributes (night/holiday/weekend hours stored as columns on the same
 * entry) — the base+premium model of spec section 47, so 2h of overtime
 * worked at night is reported as `hours: 2` (OVERTIME) with `nightHours:
 * 2`, never as 4h worked (spec section 48).
 */
@Injectable()
export class TimeEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calendar: ProductionCalendarService,
    private readonly timeCodes: TimeCodeService,
  ) {}

  /** Builds the day's TimeEntry rows from its COMPLETE AttendanceInterval(s)
   * and daily plan — auto-deducts the shift's own break (spec section 50),
   * caps REGULAR_WORK at planned hours, and only classifies the excess as
   * OVERTIME up to whatever an OvertimeRecord has actually approved for
   * that date (spec sections 38-39 — actual > plan is never automatic
   * overtime). */
  async generateFromAttendance(tenantId: string, userId: string, employmentId: string, workDate: Date) {
    const dayStart = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate()));
    const intervals = await this.prisma.attendanceInterval.findMany({ where: { tenantId, employmentId, workDate: dayStart, status: 'COMPLETE' } });
    if (intervals.length === 0) throw new ValidationAppError('No complete attendance interval for this date — resolve MISSING_CLOCK_OUT/DUPLICATE exceptions first.');

    const plan = await this.prisma.employeeDailyWorkPlan.findUnique({ where: { employmentId_date: { employmentId, date: dayStart } } });
    const plannedHours = plan ? new Decimal(plan.plannedHours.toString()) : new Decimal(0);
    const shiftTemplate = plan?.shiftTemplateId ? await this.prisma.shiftTemplate.findUnique({ where: { id: plan.shiftTemplateId } }) : null;

    let grossMinutes = intervals.reduce((s, i) => s + (i.durationMinutes ?? 0), 0);
    if (shiftTemplate) grossMinutes -= shiftTemplate.breakMinutes;
    const eligibleHours = new Decimal(Math.max(grossMinutes, 0)).dividedBy(60);

    const overtimeRecord = await this.prisma.overtimeRecord.findFirst({ where: { tenantId, employmentId, date: dayStart, status: 'APPROVED' } });
    const approvedOvertime = overtimeRecord?.approvedHours ? new Decimal(overtimeRecord.approvedHours.toString()) : new Decimal(0);
    const regularHours = Decimal.min(eligibleHours, plannedHours);
    const excessHours = Decimal.max(eligibleHours.minus(plannedHours), 0);
    const overtimeHours = Decimal.min(excessHours, approvedOvertime);

    let nightMinutes = 0;
    for (const i of intervals) if (i.startTime && i.endTime) nightMinutes += this.overlapWithNightWindow(i.startTime, i.endTime);
    const nightHours = new Decimal(nightMinutes).dividedBy(60);

    const { dayType } = await this.calendar.resolveDayType(tenantId, (await this.prisma.employment.findUniqueOrThrow({ where: { id: employmentId } })).organizationId, dayStart);
    const isHoliday = dayType === 'HOLIDAY';
    const isWeekend = dayType === 'WEEKEND';

    const entries = [];
    if (regularHours.gt(0)) entries.push(await this.createEntry(tenantId, userId, employmentId, dayStart, 'REGULAR_WORK', regularHours, nightHours, isHoliday ? regularHours : new Decimal(0), isWeekend ? regularHours : new Decimal(0), 'ATTENDANCE'));
    if (overtimeHours.gt(0)) entries.push(await this.createEntry(tenantId, userId, employmentId, dayStart, 'OVERTIME', overtimeHours, regularHours.gt(0) ? new Decimal(0) : nightHours, regularHours.gt(0) ? new Decimal(0) : (isHoliday ? overtimeHours : new Decimal(0)), regularHours.gt(0) ? new Decimal(0) : (isWeekend ? overtimeHours : new Decimal(0)), 'ATTENDANCE'));
    if (isHoliday && (regularHours.gt(0) || overtimeHours.gt(0))) {
      const worked = regularHours.plus(overtimeHours);
      entries.push(await this.createEntry(tenantId, userId, employmentId, dayStart, 'HOLIDAY_WORK', worked, new Decimal(0), worked, new Decimal(0), 'ATTENDANCE'));
    } else if (isWeekend && (regularHours.gt(0) || overtimeHours.gt(0))) {
      const worked = regularHours.plus(overtimeHours);
      entries.push(await this.createEntry(tenantId, userId, employmentId, dayStart, 'WEEKEND_WORK', worked, new Decimal(0), new Decimal(0), worked, 'ATTENDANCE'));
    }
    return entries;
  }

  async createManual(tenantId: string, userId: string, dto: { employmentId: string; workDate: string; hours: number; timeCode: string; nightHours?: number; holidayHours?: number; weekendHours?: number; startTime?: string; endTime?: string; sourceDocumentType?: string; sourceDocumentId?: string }) {
    const timeCode = await this.timeCodes.byCode(tenantId, dto.timeCode);
    if (!timeCode) throw new NotFoundAppError('TimeCode', dto.timeCode);
    const workDate = new Date(dto.workDate);
    const row = await this.prisma.timeEntry.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        workDate,
        startTime: dto.startTime ? new Date(dto.startTime) : undefined,
        endTime: dto.endTime ? new Date(dto.endTime) : undefined,
        hours: dto.hours.toString(),
        timeCodeId: timeCode.id,
        nightHours: (dto.nightHours ?? 0).toString(),
        holidayHours: (dto.holidayHours ?? 0).toString(),
        weekendHours: (dto.weekendHours ?? 0).toString(),
        source: 'MANUAL',
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'WT_TIME_ENTRY_CREATED', entityType: 'TIME_ENTRY', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  private async createEntry(tenantId: string, userId: string, employmentId: string, workDate: Date, code: string, hours: Decimal, nightHours: Decimal, holidayHours: Decimal, weekendHours: Decimal, source: string) {
    const timeCode = await this.timeCodes.byCode(tenantId, code);
    if (!timeCode) throw new NotFoundAppError('TimeCode', code);
    return this.prisma.timeEntry.create({ data: { tenantId, employmentId, workDate, hours: hours.toString(), timeCodeId: timeCode.id, nightHours: nightHours.toString(), holidayHours: holidayHours.toString(), weekendHours: weekendHours.toString(), source, createdBy: userId } });
  }

  /** Overlap of [start,end) with the configured night window, correctly
   * handling a window that crosses midnight (spec section 43's own
   * 20:00-04:00 shift example). Minutes, not hours, to stay integer-exact. */
  private overlapWithNightWindow(start: Date, end: Date): number {
    let minutes = 0;
    for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + 60_000)) {
      const hour = cursor.getUTCHours();
      const inNight = NIGHT_WINDOW.startHour > NIGHT_WINDOW.endHour ? hour >= NIGHT_WINDOW.startHour || hour < NIGHT_WINDOW.endHour : hour >= NIGHT_WINDOW.startHour && hour < NIGHT_WINDOW.endHour;
      if (inNight) minutes += 1;
    }
    return minutes;
  }

  list(tenantId: string, employmentId: string, dateFrom: Date, dateTo: Date) {
    return this.prisma.timeEntry.findMany({ where: { tenantId, employmentId, workDate: { gte: dateFrom, lte: dateTo }, status: 'ACTIVE' }, include: { timeCode: true }, orderBy: { workDate: 'asc' } });
  }
}
