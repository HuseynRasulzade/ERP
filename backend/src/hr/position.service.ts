import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** PositionService (spec section 13) — generic job title, never confused
 * with `StaffingPosition` (a specific department's headcount slot, spec
 * section 16). */
@Injectable()
export class PositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.position.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.position.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('Position', id);
    return row;
  }

  async create(tenantId: string, userId: string, dto: { code: string; name: string; jobFamily?: string; grade?: string; category?: string; description?: string }) {
    const row = await this.prisma.position.create({ data: { tenantId, code: dto.code, name: dto.name, jobFamily: dto.jobFamily, grade: dto.grade, category: dto.category, description: dto.description, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_POSITION_CREATED', entityType: 'POSITION', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code, name: dto.name } });
    return row;
  }
}
