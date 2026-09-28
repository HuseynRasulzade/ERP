import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError } from '../common/errors/app-error';
import { CreateShiftTemplateDto } from './dto/work-time.dto';

@Injectable()
export class ShiftTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, activeOnly = false) {
    return this.prisma.shiftTemplate.findMany({
      where: { tenantId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.shiftTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('ShiftTemplate', id);
    return row;
  }

  async create(tenantId: string, dto: CreateShiftTemplateDto) {
    const existing = await this.prisma.shiftTemplate.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing)
      throw new ConflictAppError(
        `Shift template code already exists: ${dto.code}`,
      );
    return this.prisma.shiftTemplate.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        breakDurationMinutes: dto.breakDurationMinutes ?? 0,
        plannedHours: dto.plannedHours,
        crossesMidnight: dto.crossesMidnight ?? false,
      },
    });
  }
}
