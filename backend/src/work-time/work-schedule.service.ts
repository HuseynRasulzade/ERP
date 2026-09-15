import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** WorkScheduleTemplateService (spec sections 7-10) — templates, their
 * cyclic patterns, and reusable shift definitions. */
@Injectable()
export class WorkScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createTemplate(tenantId: string, userId: string, dto: { code: string; name: string; scheduleType: string; cycleLengthDays?: number; defaultWeeklyHours?: number; usesProductionCalendar?: boolean; fteAppliesToHours?: boolean }) {
    const row = await this.prisma.workScheduleTemplate.create({ data: { tenantId, code: dto.code, name: dto.name, scheduleType: dto.scheduleType, cycleLengthDays: dto.cycleLengthDays ?? 7, defaultWeeklyHours: (dto.defaultWeeklyHours ?? 40).toString(), usesProductionCalendar: dto.usesProductionCalendar ?? true, fteAppliesToHours: dto.fteAppliesToHours ?? true, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WT_SCHEDULE_TEMPLATE_CREATED', entityType: 'WORK_SCHEDULE_TEMPLATE', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  async createShiftTemplate(tenantId: string, userId: string, dto: { code: string; name: string; startTime: string; endTime: string; breakMinutes?: number; plannedHours: number; crossesMidnight?: boolean }) {
    const row = await this.prisma.shiftTemplate.create({ data: { tenantId, code: dto.code, name: dto.name, startTime: dto.startTime, endTime: dto.endTime, breakMinutes: dto.breakMinutes ?? 0, plannedHours: dto.plannedHours.toString(), crossesMidnight: dto.crossesMidnight ?? false } });
    await this.audit.record({ tenantId, eventType: 'WT_SHIFT_TEMPLATE_CREATED', entityType: 'SHIFT_TEMPLATE', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  async addPattern(tenantId: string, userId: string, scheduleTemplateId: string, dto: { cycleDay: number; workStartTime?: string; workEndTime?: string; breakMinutes?: number; plannedHours?: number; crossesMidnight?: boolean; shiftTemplateId?: string; dayType?: string }) {
    const template = await this.prisma.workScheduleTemplate.findFirst({ where: { id: scheduleTemplateId, tenantId } });
    if (!template) throw new NotFoundAppError('WorkScheduleTemplate', scheduleTemplateId);
    const row = await this.prisma.workSchedulePattern.upsert({
      where: { scheduleTemplateId_cycleDay: { scheduleTemplateId, cycleDay: dto.cycleDay } },
      create: { tenantId, scheduleTemplateId, cycleDay: dto.cycleDay, workStartTime: dto.workStartTime, workEndTime: dto.workEndTime, breakMinutes: dto.breakMinutes ?? 0, plannedHours: (dto.plannedHours ?? 0).toString(), crossesMidnight: dto.crossesMidnight ?? false, shiftTemplateId: dto.shiftTemplateId, dayType: dto.dayType ?? 'WORKDAY' },
      update: { workStartTime: dto.workStartTime, workEndTime: dto.workEndTime, breakMinutes: dto.breakMinutes ?? 0, plannedHours: (dto.plannedHours ?? 0).toString(), crossesMidnight: dto.crossesMidnight ?? false, shiftTemplateId: dto.shiftTemplateId, dayType: dto.dayType ?? 'WORKDAY' },
    });
    await this.audit.record({ tenantId, eventType: 'WT_SCHEDULE_PATTERN_SET', entityType: 'WORK_SCHEDULE_PATTERN', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async getTemplateWithPatterns(tenantId: string, id: string) {
    const row = await this.prisma.workScheduleTemplate.findFirst({ where: { id, tenantId }, include: { patterns: { orderBy: { cycleDay: 'asc' } } } });
    if (!row) throw new NotFoundAppError('WorkScheduleTemplate', id);
    return row;
  }

  list(tenantId: string) {
    return this.prisma.workScheduleTemplate.findMany({ where: { tenantId, active: true }, orderBy: { code: 'asc' } });
  }
}
