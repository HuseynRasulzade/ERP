import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictAppError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  BulkSetSchedulePatternDto,
  CreateWorkScheduleTemplateDto,
  SetSchedulePatternDto,
} from './dto/work-time.dto';

/**
 * WorkScheduleTemplate / WorkSchedulePattern (docx spec Phase 18 sections
 * 7-9) — the cycle-day pattern (STANDARD_WEEK's 7-day week is just the
 * common case of a general N-day cycle) a schedule is built from. Every
 * `scheduleType` uses the exact same pattern-by-cycle-day generation
 * algorithm; FLEXIBLE's own "core hours" policy modeling (spec section 80)
 * and ROTATING's multi-crew rotation aren't separately implemented —
 * disclosed simplification, see docs/WORK_TIME.md.
 */
@Injectable()
export class WorkScheduleTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, activeOnly = false) {
    return this.prisma.workScheduleTemplate.findMany({
      where: { tenantId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.workScheduleTemplate.findFirst({
      where: { id, tenantId },
      include: { patterns: { orderBy: { cycleDay: 'asc' } } },
    });
    if (!row) throw new NotFoundAppError('WorkScheduleTemplate', id);
    return row;
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateWorkScheduleTemplateDto,
  ) {
    const existing = await this.prisma.workScheduleTemplate.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing)
      throw new ConflictAppError(
        `Schedule template code already exists: ${dto.code}`,
      );
    return this.prisma.workScheduleTemplate.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        scheduleType: dto.scheduleType,
        cycleLengthDays: dto.cycleLengthDays ?? 7,
        defaultWeeklyHours: dto.defaultWeeklyHours ?? 40,
        usesProductionCalendar: dto.usesProductionCalendar ?? true,
        createdBy: userId,
      },
    });
  }

  async setPattern(
    tenantId: string,
    templateId: string,
    dto: SetSchedulePatternDto,
  ) {
    const template = await this.get(tenantId, templateId);
    if (dto.cycleDay < 1 || dto.cycleDay > template.cycleLengthDays)
      throw new ValidationAppError(
        `cycleDay must be between 1 and ${template.cycleLengthDays} for this template`,
      );
    if (dto.shiftTemplateId) {
      const shift = await this.prisma.shiftTemplate.findFirst({
        where: { id: dto.shiftTemplateId, tenantId },
      });
      if (!shift)
        throw new ValidationAppError(
          'shiftTemplateId does not belong to this tenant',
        );
    }
    return this.prisma.workSchedulePattern.upsert({
      where: {
        scheduleTemplateId_cycleDay: {
          scheduleTemplateId: templateId,
          cycleDay: dto.cycleDay,
        },
      },
      create: {
        tenantId,
        scheduleTemplateId: templateId,
        cycleDay: dto.cycleDay,
        dayType: dto.dayType ?? 'WORK',
        workStartTime: dto.workStartTime,
        workEndTime: dto.workEndTime,
        breakDurationMinutes: dto.breakDurationMinutes ?? 0,
        plannedHours: dto.plannedHours ?? 0,
        crossesMidnight: dto.crossesMidnight ?? false,
        shiftTemplateId: dto.shiftTemplateId,
      },
      update: {
        dayType: dto.dayType ?? 'WORK',
        workStartTime: dto.workStartTime,
        workEndTime: dto.workEndTime,
        breakDurationMinutes: dto.breakDurationMinutes ?? 0,
        plannedHours: dto.plannedHours ?? 0,
        crossesMidnight: dto.crossesMidnight ?? false,
        shiftTemplateId: dto.shiftTemplateId,
      },
    });
  }

  async bulkSetPattern(
    tenantId: string,
    templateId: string,
    dto: BulkSetSchedulePatternDto,
  ) {
    for (const p of dto.patterns) {
      await this.setPattern(tenantId, templateId, p);
    }
    return this.get(tenantId, templateId);
  }
}
