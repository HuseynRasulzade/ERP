import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError } from '../common/errors/app-error';
import { ProductionCalendarService } from './production-calendar.service';

/**
 * DailyWorkPlanService (spec sections 12-17, 63). The plan is ALWAYS
 * derived — never manually overwritten (spec section 13); an "override"
 * is a separate future extension point, not built here (disclosed
 * simplification). Regeneration is idempotent (upsert by
 * `[employmentId, date]`) and refuses to touch a day whose plan is
 * already `LOCKED` (spec section 63 — "Approved/locked historical plan
 * silent dəyişdirilməməlidir").
 */
@Injectable()
export class DailyWorkPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly calendar: ProductionCalendarService,
  ) {}

  async generate(tenantId: string, userId: string, employmentId: string, dateFrom: Date, dateTo: Date) {
    const employment = await this.prisma.employment.findFirstOrThrow({ where: { id: employmentId, tenantId } });
    let generated = 0;
    for (let d = new Date(dateFrom); d <= dateTo; d = new Date(d.getTime() + 86_400_000)) {
      const existing = await this.prisma.employeeDailyWorkPlan.findUnique({ where: { employmentId_date: { employmentId, date: d } } });
      if (existing?.generationStatus === 'LOCKED') continue;

      const plan = await this.computeDay(tenantId, employment, d);
      await this.prisma.employeeDailyWorkPlan.upsert({
        where: { employmentId_date: { employmentId, date: d } },
        create: { tenantId, employmentId, date: d, ...plan, generationVersion: 1 },
        update: { ...plan, generationVersion: (existing?.generationVersion ?? 0) + 1, generationStatus: 'GENERATED' },
      });
      generated += 1;
    }
    await this.audit.record({ tenantId, eventType: 'WT_DAILY_PLAN_GENERATED', entityType: 'EMPLOYEE_DAILY_WORK_PLAN', entityId: employmentId, action: 'CREATE', userId, newValues: { dateFrom, dateTo, generated } });
    return { generated };
  }

  private async computeDay(tenantId: string, employment: { id: string; organizationId: string; employmentStartDate: Date; employmentEndDate: Date | null; fte: unknown }, date: Date) {
    // Hire/termination impact (spec section 15): 0 planned hours outside
    // the employment's own active window.
    if (date < employment.employmentStartDate || (employment.employmentEndDate && date > employment.employmentEndDate)) {
      return { scheduleAssignmentId: null, productionCalendarId: null, shiftTemplateId: null, plannedStart: null, plannedEnd: null, plannedHours: '0', plannedWorkdayFraction: '0', plannedDayType: 'NON_WORKING_DAY', fte: employment.fte as any };
    }

    const assignment = await this.prisma.workScheduleAssignment.findFirst({ where: { tenantId, employmentId: employment.id, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' } });
    const fte = new Decimal((employment.fte as any).toString());
    const { dayType: calendarDayType, defaultWorkingHours } = await this.calendar.resolveDayType(tenantId, employment.organizationId, date);

    if (!assignment) {
      // No schedule assigned yet — plan reflects the calendar alone, 0 hours.
      return { scheduleAssignmentId: null, productionCalendarId: null, shiftTemplateId: null, plannedStart: null, plannedEnd: null, plannedHours: '0', plannedWorkdayFraction: '0', plannedDayType: calendarDayType, fte: fte.toString() };
    }

    const template = await this.prisma.workScheduleTemplate.findUnique({ where: { id: assignment.workScheduleId }, include: { patterns: true } }).catch(() => null);
    if (!template) {
      // workScheduleId doesn't resolve to a known WorkScheduleTemplate (a
      // soft reference to something else entirely) — plan the calendar
      // default alone rather than guessing.
      return { scheduleAssignmentId: assignment.id, productionCalendarId: null, shiftTemplateId: null, plannedStart: null, plannedEnd: null, plannedHours: calendarDayType === 'WORKDAY' ? defaultWorkingHours.toString() : '0', plannedWorkdayFraction: calendarDayType === 'WORKDAY' ? '1' : '0', plannedDayType: calendarDayType, fte: fte.toString() };
    }

    const daysSinceStart = Math.floor((date.getTime() - assignment.effectiveFrom.getTime()) / 86_400_000);
    const cycleDay = (((daysSinceStart % template.cycleLengthDays) + template.cycleLengthDays) % template.cycleLengthDays) + 1;
    const pattern = template.patterns.find((p) => p.cycleDay === cycleDay);

    if (template.usesProductionCalendar && ['WEEKEND', 'HOLIDAY', 'NON_WORKING_DAY'].includes(calendarDayType) && pattern?.dayType !== 'WORKDAY') {
      return { scheduleAssignmentId: assignment.id, productionCalendarId: null, shiftTemplateId: pattern?.shiftTemplateId ?? null, plannedStart: null, plannedEnd: null, plannedHours: '0', plannedWorkdayFraction: '0', plannedDayType: calendarDayType, fte: fte.toString() };
    }
    if (!pattern || pattern.dayType === 'OFF') {
      return { scheduleAssignmentId: assignment.id, productionCalendarId: null, shiftTemplateId: null, plannedStart: null, plannedEnd: null, plannedHours: '0', plannedWorkdayFraction: '0', plannedDayType: 'OFF', fte: fte.toString() };
    }

    let hours = new Decimal(pattern.plannedHours.toString());
    if (calendarDayType === 'SHORTENED_WORKDAY') {
      const shortDay = await this.calendar.getDay(tenantId, (await this.calendar.findApplicableCalendar(tenantId, employment.organizationId, date))!.id, date);
      if (shortDay?.shortenedByHours) hours = hours.minus(shortDay.shortenedByHours.toString());
    }
    if (template.fteAppliesToHours) hours = hours.mul(fte);
    if (hours.lt(0)) hours = new Decimal(0);

    return {
      scheduleAssignmentId: assignment.id,
      productionCalendarId: null,
      shiftTemplateId: pattern.shiftTemplateId,
      plannedStart: pattern.workStartTime,
      plannedEnd: pattern.workEndTime,
      plannedHours: hours.toString(),
      plannedWorkdayFraction: hours.gt(0) ? '1' : '0',
      plannedDayType: calendarDayType === 'WORKDAY' || calendarDayType === 'SHORTENED_WORKDAY' || calendarDayType === 'TRANSFERRED_WORKDAY' ? calendarDayType : 'WORKDAY',
      fte: fte.toString(),
    };
  }

  async getPlan(tenantId: string, employmentId: string, dateFrom: Date, dateTo: Date) {
    return this.prisma.employeeDailyWorkPlan.findMany({ where: { tenantId, employmentId, date: { gte: dateFrom, lte: dateTo } }, orderBy: { date: 'asc' } });
  }

  /** Employee Monthly Norm (spec sections 81-82). */
  async monthlyNorm(tenantId: string, employmentId: string, monthStart: Date) {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const days = await this.getPlan(tenantId, employmentId, monthStart, monthEnd);
    const plannedHours = days.reduce((s, d) => s.plus(d.plannedHours.toString()), new Decimal(0));
    const plannedDays = days.filter((d) => new Decimal(d.plannedHours.toString()).gt(0)).length;
    return { plannedHours: plannedHours.toString(), plannedDays };
  }
}
