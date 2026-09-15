import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/** WorkScheduleAssignmentService (spec sections 32-33) — a standalone
 * effective-dated schedule change, independent of a Transfer document.
 * Full schedule mechanics (calendars, shift patterns) are Phase 18's own
 * scope — this build only tracks the assignment history itself. */
@Injectable()
export class WorkScheduleAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async change(tenantId: string, userId: string, dto: { employmentId: string; workScheduleId: string; effectiveFrom: string; reason?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const effectiveFrom = new Date(dto.effectiveFrom);

    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.workScheduleAssignment.findFirst({ where: { tenantId, employmentId: dto.employmentId, effectiveTo: null } });
      if (current) {
        if (current.effectiveFrom >= effectiveFrom) throw new ValidationAppError('New schedule effective date must be after the current assignment\'s own effective date');
        await tx.workScheduleAssignment.update({ where: { id: current.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) } });
      }
      const row = await tx.workScheduleAssignment.create({ data: { tenantId, employmentId: dto.employmentId, workScheduleId: dto.workScheduleId, effectiveFrom, reason: dto.reason ?? 'SCHEDULE_CHANGE' } });
      await tx.employment.update({ where: { id: dto.employmentId }, data: { workScheduleId: dto.workScheduleId } });
      await this.audit.record({ tenantId, eventType: 'HR_SCHEDULE_CHANGED', entityType: 'WORK_SCHEDULE_ASSIGNMENT', entityId: row.id, action: 'CREATE', userId, newValues: dto }, tx);
      return row;
    });
  }

  history(tenantId: string, employmentId: string) {
    return this.prisma.workScheduleAssignment.findMany({ where: { tenantId, employmentId }, orderBy: { effectiveFrom: 'asc' } });
  }
}
