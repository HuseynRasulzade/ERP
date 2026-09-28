import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError } from '../common/errors/app-error';
import { CreatePositionDto } from './dto/hr-core.dto';

/**
 * Position — generic job title master data (docx spec Phase 17 section 13),
 * tenant-wide like Department/Warehouse. Distinct from StaffingPosition,
 * which is a specific planned seat within an organization's staffing table.
 */
@Injectable()
export class PositionService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, activeOnly = false) {
    return this.prisma.position.findMany({
      where: { tenantId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.position.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('Position', id);
    return row;
  }

  async create(tenantId: string, userId: string, dto: CreatePositionDto) {
    const existing = await this.prisma.position.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing)
      throw new ConflictAppError(`Position code already exists: ${dto.code}`);
    return this.prisma.position.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        jobFamily: dto.jobFamily,
        grade: dto.grade,
        category: dto.category,
        description: dto.description,
        createdBy: userId,
      },
    });
  }

  async deactivate(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.position.update({
      where: { id },
      data: { active: false },
    });
  }
}
