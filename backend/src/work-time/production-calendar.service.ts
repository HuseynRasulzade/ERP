import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * ProductionCalendarService (spec sections 4-6). A new government-holiday
 * update creates a NEW `ProductionCalendar` version effective from a
 * date — it never rewrites an existing (possibly already-locked-period)
 * calendar's own days (spec section 6).
 */
@Injectable()
export class ProductionCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createCalendar(tenantId: string, userId: string, dto: { organizationId?: string; localizationCode?: string; year: number; name: string; effectiveFrom: string; supersedesId?: string }) {
    return this.prisma.runInTransaction(async (tx) => {
      let version = 1;
      if (dto.supersedesId) {
        const previous = await tx.productionCalendar.findFirst({ where: { id: dto.supersedesId, tenantId } });
        if (!previous) throw new NotFoundAppError('ProductionCalendar', dto.supersedesId);
        await tx.productionCalendar.update({ where: { id: dto.supersedesId }, data: { status: 'SUPERSEDED' } });
        version = previous.version + 1;
      }
      const row = await tx.productionCalendar.create({ data: { tenantId, organizationId: dto.organizationId, localizationCode: dto.localizationCode ?? 'AZ', year: dto.year, name: dto.name, version, effectiveFrom: new Date(dto.effectiveFrom), status: 'ACTIVE', createdBy: userId } });
      await this.audit.record({ tenantId, eventType: 'WT_CALENDAR_CREATED', entityType: 'PRODUCTION_CALENDAR', entityId: row.id, action: 'CREATE', userId, newValues: { year: dto.year, version } }, tx);
      return row;
    });
  }

  async setDay(tenantId: string, userId: string, calendarId: string, dto: { date: string; dayType: string; defaultWorkingHours?: number; holidayCode?: string; shortenedByHours?: number; transferredFromDate?: string; transferredToDate?: string; notes?: string }) {
    const calendar = await this.prisma.productionCalendar.findFirst({ where: { id: calendarId, tenantId } });
    if (!calendar) throw new NotFoundAppError('ProductionCalendar', calendarId);
    const row = await this.prisma.productionCalendarDay.upsert({
      where: { calendarId_date: { calendarId, date: new Date(dto.date) } },
      create: { tenantId, calendarId, date: new Date(dto.date), dayType: dto.dayType, defaultWorkingHours: (dto.defaultWorkingHours ?? 8).toString(), holidayCode: dto.holidayCode, shortenedByHours: dto.shortenedByHours?.toString(), transferredFromDate: dto.transferredFromDate ? new Date(dto.transferredFromDate) : undefined, transferredToDate: dto.transferredToDate ? new Date(dto.transferredToDate) : undefined, notes: dto.notes },
      update: { dayType: dto.dayType, defaultWorkingHours: (dto.defaultWorkingHours ?? 8).toString(), holidayCode: dto.holidayCode, shortenedByHours: dto.shortenedByHours?.toString(), notes: dto.notes },
    });
    await this.audit.record({ tenantId, eventType: 'WT_CALENDAR_DAY_SET', entityType: 'PRODUCTION_CALENDAR_DAY', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async bulkSeed(tenantId: string, userId: string, calendarId: string, days: { date: string; dayType: string; defaultWorkingHours?: number; holidayCode?: string }[]) {
    for (const d of days) await this.setDay(tenantId, userId, calendarId, d);
    return { seeded: days.length };
  }

  async findApplicableCalendar(tenantId: string, organizationId: string | null, date: Date) {
    const calendar = await this.prisma.productionCalendar.findFirst({
      where: { tenantId, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ organizationId }, { organizationId: null }] },
      orderBy: [{ organizationId: 'desc' }, { effectiveFrom: 'desc' }],
    });
    return calendar;
  }

  async getDay(tenantId: string, calendarId: string, date: Date) {
    return this.prisma.productionCalendarDay.findUnique({ where: { calendarId_date: { calendarId, date } } });
  }

  /** Convenience used by DailyWorkPlanService/TimeEntryService — falls
   * back to WORKDAY (Mon-Fri) / WEEKEND (Sat-Sun) if no calendar day row
   * exists at all (a tenant that hasn't seeded holidays yet still gets a
   * sane default rather than an error). */
  async resolveDayType(tenantId: string, organizationId: string | null, date: Date): Promise<{ dayType: string; defaultWorkingHours: number }> {
    const calendar = await this.findApplicableCalendar(tenantId, organizationId, date);
    if (calendar) {
      const day = await this.getDay(tenantId, calendar.id, date);
      if (day) return { dayType: day.dayType, defaultWorkingHours: Number(day.defaultWorkingHours.toString()) };
    }
    const weekday = date.getUTCDay();
    return weekday === 0 || weekday === 6 ? { dayType: 'WEEKEND', defaultWorkingHours: 0 } : { dayType: 'WORKDAY', defaultWorkingHours: 8 };
  }

  list(tenantId: string, organizationId?: string) {
    return this.prisma.productionCalendar.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' }, orderBy: { year: 'desc' } });
  }
}
