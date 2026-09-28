import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { EmploymentService } from '../hr-core/employment.service';
import { ProductionCalendarService } from './production-calendar.service';
import { ValidationAppError } from '../common/errors/app-error';
import { GenerateDailyPlanDto } from './dto/work-time.dto';

const NOT_EMPLOYED_STATUSES = new Set(['TERMINATED', 'CANCELLED']);

/** Deterministic cycle-day index (1-based) — anchored to the Unix epoch so
 * the same date always maps to the same cycle day regardless of when the
 * schedule was first generated. Exported for TimeEntryService's own break-
 * duration lookup against the same pattern row. */
export function resolveCycleDay(date: Date, cycleLengthDays: number): number {
  const epochDays = Math.floor(date.getTime() / 86_400_000);
  return (epochDays % cycleLengthDays) + 1;
}

/**
 * EmployeeDailyWorkPlan generator (docx spec Phase 18 sections 12-17) — the
 * plan is always DERIVED, never hand-typed. For each date it combines:
 *   - the effective WorkScheduleAssignment (Phase 17) covering that date,
 *     resolved to a WorkScheduleTemplate by code (schedule changes
 *     mid-period naturally fall out of this per-date lookup)
 *   - the WorkSchedulePattern for that date's cycle day
 *   - the ProductionCalendarDay for that date (holiday/weekend/shortened/
 *     transferred always overrides the raw pattern)
 *   - Phase 17 EmploymentService.getState() for department/position/FTE,
 *     which is what makes hire/termination/mid-period-transfer dates
 *     naturally zero out or shift the plan without any special-case code.
 * A row already marked `generationStatus = 'LOCKED'` is left untouched by
 * regeneration (spec section 63 — approved/locked historical plans aren't
 * silently rewritten).
 */
@Injectable()
export class DailyWorkPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employments: EmploymentService,
    private readonly calendars: ProductionCalendarService,
  ) {}

  async list(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    return this.prisma.employeeDailyWorkPlan.findMany({
      where: {
        tenantId,
        employmentId,
        date: { gte: this.parseDate(fromDate), lte: this.parseDate(toDate) },
      },
      orderBy: { date: 'asc' },
    });
  }

  async generate(tenantId: string, dto: GenerateDailyPlanDto) {
    const from = this.parseDate(dto.fromDate);
    const to = this.parseDate(dto.toDate);
    if (to < from)
      throw new ValidationAppError('toDate cannot be before fromDate');

    const results = [];
    for (let d = new Date(from); d <= to; d = this.addDays(d, 1)) {
      results.push(
        await this.generateOneDay(tenantId, dto.employmentId, new Date(d)),
      );
    }
    return results;
  }

  private async generateOneDay(
    tenantId: string,
    employmentId: string,
    date: Date,
  ) {
    const existing = await this.prisma.employeeDailyWorkPlan.findUnique({
      where: { employmentId_date: { employmentId, date } },
    });
    if (existing && existing.generationStatus === 'LOCKED') return existing;

    const state = await this.employments.getState(employmentId, date);
    if (
      !state.status ||
      NOT_EMPLOYED_STATUSES.has(state.status) ||
      !state.organizationId
    ) {
      return this.upsertPlan(tenantId, employmentId, date, {
        organizationId: existing?.organizationId ?? state.organizationId ?? '',
        plannedHours: new Decimal(0),
        plannedWorkdayFraction: new Decimal(0),
        plannedDayType: 'NOT_EMPLOYED',
        fte: new Decimal(0),
        departmentId: null,
        positionId: null,
        scheduleTemplateId: null,
        productionCalendarId: null,
        shiftTemplateId: null,
        plannedStart: null,
        plannedEnd: null,
        sourceScheduleVersion: null,
        sourceCalendarVersion: null,
      });
    }

    const assignment = await this.prisma.workScheduleAssignment.findFirst({
      where: {
        employmentId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const scheduleCode = assignment?.workScheduleCode;
    const template = scheduleCode
      ? await this.prisma.workScheduleTemplate.findUnique({
          where: { tenantId_code: { tenantId, code: scheduleCode } },
        })
      : null;

    const calendar = await this.calendars.resolveForDate(
      tenantId,
      state.organizationId,
      date,
    );
    const calendarDay = await this.calendars.resolveDay(
      tenantId,
      calendar?.id ?? null,
      date,
    );

    if (!template) {
      return this.upsertPlan(tenantId, employmentId, date, {
        organizationId: state.organizationId,
        plannedHours: new Decimal(0),
        plannedWorkdayFraction: new Decimal(0),
        plannedDayType: 'NO_SCHEDULE',
        fte: new Decimal(state.fte ?? '1'),
        departmentId: state.departmentId,
        positionId: state.positionId,
        scheduleTemplateId: null,
        productionCalendarId: calendar?.id ?? null,
        shiftTemplateId: null,
        plannedStart: null,
        plannedEnd: null,
        sourceScheduleVersion: null,
        sourceCalendarVersion: calendar?.version ?? null,
      });
    }

    const cycleDay = resolveCycleDay(date, template.cycleLengthDays);
    const pattern = await this.prisma.workSchedulePattern.findUnique({
      where: {
        scheduleTemplateId_cycleDay: {
          scheduleTemplateId: template.id,
          cycleDay,
        },
      },
    });

    const { plannedHours: basePlannedHours, plannedDayType } =
      this.computePlannedHours(calendarDay, pattern);
    const fte = new Decimal(state.fte ?? '1');
    const plannedHours = basePlannedHours.times(fte);

    return this.upsertPlan(tenantId, employmentId, date, {
      organizationId: state.organizationId,
      plannedHours,
      plannedWorkdayFraction: plannedHours.gt(0) ? fte : new Decimal(0),
      plannedDayType,
      fte,
      departmentId: state.departmentId,
      positionId: state.positionId,
      scheduleTemplateId: template.id,
      productionCalendarId: calendar?.id ?? null,
      shiftTemplateId: pattern?.shiftTemplateId ?? null,
      plannedStart: pattern?.workStartTime ?? null,
      plannedEnd: pattern?.workEndTime ?? null,
      sourceScheduleVersion: template.version,
      sourceCalendarVersion: calendar?.version ?? null,
    });
  }

  /** Calendar always wins over the raw weekly pattern for holiday/weekend/
   * shortened/transferred days (spec sections 44-45); a TRANSFERRED_WORKDAY
   * turns an otherwise-OFF pattern day into a working day at the calendar's
   * own default hours (compensating for a midweek holiday). */
  private computePlannedHours(
    calendarDay: {
      dayType: string;
      defaultWorkingHours: number | Decimal;
      shortenedByHours: number | Decimal | null;
    },
    pattern: { dayType: string; plannedHours: Decimal } | null,
  ): { plannedHours: Decimal; plannedDayType: string } {
    if (
      ['WEEKEND', 'HOLIDAY', 'NON_WORKING_DAY'].includes(calendarDay.dayType)
    ) {
      return {
        plannedHours: new Decimal(0),
        plannedDayType: calendarDay.dayType,
      };
    }
    if (calendarDay.dayType === 'TRANSFERRED_WORKDAY') {
      return {
        plannedHours: new Decimal(calendarDay.defaultWorkingHours.toString()),
        plannedDayType: 'TRANSFERRED_WORKDAY',
      };
    }
    if (!pattern || pattern.dayType === 'OFF') {
      return { plannedHours: new Decimal(0), plannedDayType: 'WEEKEND' };
    }
    if (calendarDay.dayType === 'SHORTENED_WORKDAY') {
      const reduced = pattern.plannedHours.minus(
        new Decimal(calendarDay.shortenedByHours?.toString() ?? '0'),
      );
      return {
        plannedHours: reduced.lt(0) ? new Decimal(0) : reduced,
        plannedDayType: 'SHORTENED_WORKDAY',
      };
    }
    return { plannedHours: pattern.plannedHours, plannedDayType: 'WORKDAY' };
  }

  private async upsertPlan(
    tenantId: string,
    employmentId: string,
    date: Date,
    data: {
      organizationId: string;
      plannedHours: Decimal;
      plannedWorkdayFraction: Decimal;
      plannedDayType: string;
      fte: Decimal;
      departmentId: string | null;
      positionId: string | null;
      scheduleTemplateId: string | null;
      productionCalendarId: string | null;
      shiftTemplateId: string | null;
      plannedStart: string | null;
      plannedEnd: string | null;
      sourceScheduleVersion: number | null;
      sourceCalendarVersion: number | null;
    },
  ) {
    return this.prisma.employeeDailyWorkPlan.upsert({
      where: { employmentId_date: { employmentId, date } },
      create: {
        tenantId,
        employmentId,
        date,
        organizationId: data.organizationId,
        scheduleTemplateId: data.scheduleTemplateId,
        productionCalendarId: data.productionCalendarId,
        shiftTemplateId: data.shiftTemplateId,
        plannedStart: data.plannedStart,
        plannedEnd: data.plannedEnd,
        plannedHours: data.plannedHours,
        plannedWorkdayFraction: data.plannedWorkdayFraction,
        plannedDayType: data.plannedDayType,
        fte: data.fte,
        departmentId: data.departmentId,
        positionId: data.positionId,
        sourceScheduleVersion: data.sourceScheduleVersion,
        sourceCalendarVersion: data.sourceCalendarVersion,
        generationStatus: 'GENERATED',
      },
      update: {
        organizationId: data.organizationId,
        scheduleTemplateId: data.scheduleTemplateId,
        productionCalendarId: data.productionCalendarId,
        shiftTemplateId: data.shiftTemplateId,
        plannedStart: data.plannedStart,
        plannedEnd: data.plannedEnd,
        plannedHours: data.plannedHours,
        plannedWorkdayFraction: data.plannedWorkdayFraction,
        plannedDayType: data.plannedDayType,
        fte: data.fte,
        departmentId: data.departmentId,
        positionId: data.positionId,
        sourceScheduleVersion: data.sourceScheduleVersion,
        sourceCalendarVersion: data.sourceCalendarVersion,
        generationStatus: 'GENERATED',
      },
    });
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
