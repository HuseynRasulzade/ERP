import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * TimeCorrectionService (spec sections 57-60, 98). Never overwrites the
 * original `TimeEntry` in place — marks it `SUPERSEDED` and creates a
 * fresh one, linked by this row (spec section 58). A correction touching
 * a date whose `Timesheet` is already `LOCKED` sets
 * `requiresRecalculation: true` (spec section 59's own
 * `WorkTimeRecalculationRequired`) rather than silently changing locked,
 * already-approved numbers.
 */
@Injectable()
export class TimeCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async correct(tenantId: string, userId: string, dto: { employmentId: string; workDate: string; originalTimeEntryId?: string; timeCodeCode: string; hours: number; reason: string; comment?: string }) {
    const workDate = new Date(dto.workDate);
    const timeCode = await this.prisma.timeCode.findUnique({ where: { tenantId_code: { tenantId, code: dto.timeCodeCode } } });
    if (!timeCode) throw new NotFoundAppError('TimeCode', dto.timeCodeCode);

    const lockedTimesheet = await this.prisma.timesheet.findFirst({ where: { tenantId, status: 'LOCKED', periodStart: { lte: workDate }, periodEnd: { gte: workDate }, lines: { some: { employmentId: dto.employmentId } } } });

    return this.prisma.runInTransaction(async (tx) => {
      if (dto.originalTimeEntryId) {
        const original = await tx.timeEntry.findFirst({ where: { id: dto.originalTimeEntryId, tenantId } });
        if (!original) throw new NotFoundAppError('TimeEntry', dto.originalTimeEntryId);
        await tx.timeEntry.update({ where: { id: dto.originalTimeEntryId }, data: { status: 'SUPERSEDED' } });
      }
      const newEntry = await tx.timeEntry.create({ data: { tenantId, employmentId: dto.employmentId, workDate, hours: dto.hours.toString(), timeCodeId: timeCode.id, source: 'CORRECTION', createdBy: userId } });
      const correction = await tx.timeCorrection.create({ data: { tenantId, employmentId: dto.employmentId, workDate, originalTimeEntryId: dto.originalTimeEntryId, newTimeEntryId: newEntry.id, reason: dto.reason, comment: dto.comment, requiresRecalculation: !!lockedTimesheet, createdBy: userId } });
      await this.audit.record({ tenantId, eventType: 'WT_TIME_ENTRY_CORRECTED', entityType: 'TIME_CORRECTION', entityId: correction.id, action: 'CREATE', userId, newValues: { reason: dto.reason, hours: dto.hours, requiresRecalculation: !!lockedTimesheet } }, tx);
      return { correction, newEntry, requiresRecalculation: !!lockedTimesheet, affectedTimesheetId: lockedTimesheet?.id };
    });
  }

  list(tenantId: string, employmentId?: string) {
    return this.prisma.timeCorrection.findMany({ where: { tenantId, employmentId }, orderBy: { createdAt: 'desc' } });
  }

  pendingRecalculation(tenantId: string) {
    return this.prisma.timeCorrection.findMany({ where: { tenantId, requiresRecalculation: true } });
  }
}
