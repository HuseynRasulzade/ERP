import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  BulkAddCalendarDaysDto,
  CalendarDayDto,
  CreateCalendarVersionDto,
  CreateProductionCalendarDto,
} from './dto/work-time.dto';

const CALENDAR_TYPE = 'WORK_TIME_PRODUCTION_CALENDAR';

/**
 * ProductionCalendar / ProductionCalendarDay (docx spec Phase 18 sections
 * 4-6) — working days, weekends, official holidays, shortened/transferred
 * workdays. Versioned: a correction to an already-referenced calendar
 * never overwrites its rows in place — `createNewVersion()` supersedes the
 * old row and starts a fresh one, so historical `EmployeeDailyWorkPlan`
 * rows that recorded `sourceCalendarVersion` keep their original meaning.
 * `organizationId` nullable = tenant-wide calendar; set = organization-
 * specific override.
 */
@Injectable()
export class ProductionCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, organizationId?: string) {
    return this.prisma.productionCalendar.findMany({
      where: {
        tenantId,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: [{ year: 'desc' }, { version: 'desc' }],
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.productionCalendar.findFirst({
      where: { id, tenantId },
      include: { days: { orderBy: { date: 'asc' } } },
    });
    if (!row) throw new NotFoundAppError('ProductionCalendar', id);
    return row;
  }

  /** The ACTIVE calendar covering `date` for this org (falls back to the
   * tenant-wide calendar for that year if no org-specific one exists). */
  async resolveForDate(tenantId: string, organizationId: string, date: Date) {
    const year = date.getUTCFullYear();
    const orgCalendar = await this.prisma.productionCalendar.findFirst({
      where: { tenantId, organizationId, year, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (orgCalendar) return orgCalendar;
    return this.prisma.productionCalendar.findFirst({
      where: { tenantId, organizationId: null, year, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateProductionCalendarDto,
  ) {
    const calendar = await this.prisma.productionCalendar.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        countryCode: dto.countryCode,
        year: dto.year,
        name: dto.name,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        createdBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'WORK_TIME_CALENDAR_CREATED',
      entityType: CALENDAR_TYPE,
      entityId: calendar.id,
      action: 'CREATE',
      userId,
    });
    return calendar;
  }

  async bulkAddDays(tenantId: string, id: string, dto: BulkAddCalendarDaysDto) {
    const calendar = await this.get(tenantId, id);
    if (calendar.status !== 'ACTIVE' && calendar.status !== 'DRAFT')
      throw new ValidationAppError(
        `Cannot add days to a calendar in status ${calendar.status} — create a new version instead`,
      );

    for (const day of dto.days) {
      await this.prisma.productionCalendarDay.upsert({
        where: {
          calendarId_date: { calendarId: id, date: this.parseDate(day.date) },
        },
        create: this.dayToCreateData(tenantId, id, day),
        update: this.dayToUpdateData(day),
      });
    }
    return this.get(tenantId, id);
  }

  async createNewVersion(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreateCalendarVersionDto,
  ) {
    const calendar = await this.get(tenantId, id);
    return this.prisma.runInTransaction(async (tx) => {
      await tx.productionCalendar.update({
        where: { id },
        data: { status: 'SUPERSEDED' },
      });
      const newCalendar = await tx.productionCalendar.create({
        data: {
          tenantId,
          organizationId: calendar.organizationId,
          countryCode: calendar.countryCode,
          year: calendar.year,
          name: dto.name ?? calendar.name,
          version: calendar.version + 1,
          effectiveFrom: this.parseDate(dto.effectiveFrom),
          status: 'ACTIVE',
          createdBy: userId,
        },
      });
      if (dto.copyDays !== false) {
        for (const day of calendar.days) {
          await tx.productionCalendarDay.create({
            data: {
              tenantId,
              calendarId: newCalendar.id,
              date: day.date,
              dayType: day.dayType,
              defaultWorkingHours: day.defaultWorkingHours,
              holidayCode: day.holidayCode,
              shortenedByHours: day.shortenedByHours,
              transferredFromDate: day.transferredFromDate,
              transferredToDate: day.transferredToDate,
              notes: day.notes,
            },
          });
        }
      }
      await this.audit.record(
        {
          tenantId,
          eventType: 'WORK_TIME_CALENDAR_NEW_VERSION',
          entityType: CALENDAR_TYPE,
          entityId: newCalendar.id,
          action: 'CREATE',
          userId,
          oldValues: { supersededCalendarId: id, oldVersion: calendar.version },
        },
        tx,
      );
      return tx.productionCalendar.findFirst({
        where: { id: newCalendar.id },
        include: { days: true },
      });
    });
  }

  /** Returns the day type/hours for `date`, defaulting to WORKDAY/8h when
   * the calendar has no explicit row (Mon-Fri) or WEEKEND (Sat/Sun). */
  async resolveDay(tenantId: string, calendarId: string | null, date: Date) {
    if (calendarId) {
      const day = await this.prisma.productionCalendarDay.findFirst({
        where: { tenantId, calendarId, date },
      });
      if (day) return day;
    }
    const dow = date.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    return {
      dayType: isWeekend ? 'WEEKEND' : 'WORKDAY',
      defaultWorkingHours: isWeekend ? 0 : 8,
      shortenedByHours: null as number | null,
    };
  }

  private dayToCreateData(
    tenantId: string,
    calendarId: string,
    day: CalendarDayDto,
  ) {
    return {
      tenantId,
      calendarId,
      date: this.parseDate(day.date),
      dayType: day.dayType,
      defaultWorkingHours: day.defaultWorkingHours ?? 8,
      holidayCode: day.holidayCode,
      shortenedByHours: day.shortenedByHours,
      transferredFromDate: day.transferredFromDate
        ? this.parseDate(day.transferredFromDate)
        : undefined,
      transferredToDate: day.transferredToDate
        ? this.parseDate(day.transferredToDate)
        : undefined,
      notes: day.notes,
    };
  }

  private dayToUpdateData(day: CalendarDayDto) {
    return {
      dayType: day.dayType,
      defaultWorkingHours: day.defaultWorkingHours ?? 8,
      holidayCode: day.holidayCode,
      shortenedByHours: day.shortenedByHours,
      transferredFromDate: day.transferredFromDate
        ? this.parseDate(day.transferredFromDate)
        : undefined,
      transferredToDate: day.transferredToDate
        ? this.parseDate(day.transferredToDate)
        : undefined,
      notes: day.notes,
    };
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
