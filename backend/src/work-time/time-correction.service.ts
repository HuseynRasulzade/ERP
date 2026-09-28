import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CreateTimeCorrectionDto } from './dto/work-time.dto';

const CORRECTION_TYPE = 'WORK_TIME_CORRECTION';

/**
 * TimeCorrection (docx spec Phase 18 sections 57-59) — never overwrites the
 * original TimeEntry. Applying a correction creates a brand-new TimeEntry
 * (source = CORRECTION) and marks the original REPLACED, keeping the full
 * chain for audit. If the date's Timesheet is already LOCKED, the
 * correction is still recorded (silent-replace is forbidden, but so is
 * silently blocking a legitimate late-arriving correction) — instead
 * `requiresRecalculation` is set and an audit event is raised so payroll
 * dependency can be tracked (spec section 59's WorkTimeRecalculationRequired
 * — this codebase has no separate event bus, so the audit log is the event
 * record, same convention as every other module here).
 */
@Injectable()
export class TimeCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, employmentId: string) {
    return this.prisma.timeCorrection.findMany({
      where: { tenantId, employmentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateTimeCorrectionDto) {
    return this.prisma.timeCorrection.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        workDate: this.parseDate(dto.workDate),
        originalTimeEntryId: dto.originalTimeEntryId,
        correctedTimeCode: dto.correctedTimeCode,
        correctedHours:
          dto.correctedHours !== undefined
            ? new Decimal(dto.correctedHours)
            : undefined,
        reason: dto.reason,
        createdBy: userId,
      },
    });
  }

  async apply(tenantId: string, userId: string, id: string) {
    const correction = await this.prisma.timeCorrection.findFirst({
      where: { id, tenantId },
    });
    if (!correction) throw new NotFoundAppError('TimeCorrection', id);
    if (correction.status !== 'DRAFT')
      throw new ValidationAppError(
        `Cannot apply a correction in status ${correction.status}`,
      );

    return this.prisma.runInTransaction(async (tx) => {
      let original = null;
      if (correction.originalTimeEntryId) {
        original = await tx.timeEntry.findFirst({
          where: { id: correction.originalTimeEntryId, tenantId },
        });
        if (!original)
          throw new ValidationAppError('originalTimeEntryId no longer exists');
      }

      const lockedLine = await tx.timesheetLine.findFirst({
        where: {
          tenantId,
          employmentId: correction.employmentId,
          workDate: correction.workDate,
          timesheet: { status: 'LOCKED' },
        },
      });

      const newEntry = await tx.timeEntry.create({
        data: {
          tenantId,
          employmentId: correction.employmentId,
          workDate: correction.workDate,
          hours: correction.correctedHours ?? original?.hours ?? new Decimal(0),
          timeCode:
            correction.correctedTimeCode ?? original?.timeCode ?? 'OTHER',
          source: 'CORRECTION',
          sourceDocumentType: CORRECTION_TYPE,
          sourceDocumentId: correction.id,
          createdBy: userId,
          version: (original?.version ?? 0) + 1,
        },
      });

      if (original) {
        await tx.timeEntry.update({
          where: { id: original.id },
          data: { status: 'REPLACED', supersededById: newEntry.id },
        });
      }

      const updated = await tx.timeCorrection.update({
        where: { id },
        data: {
          status: 'APPLIED',
          newTimeEntryId: newEntry.id,
          requiresRecalculation: !!lockedLine,
          appliedAt: new Date(),
          appliedBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: lockedLine
            ? 'WORK_TIME_RECALCULATION_REQUIRED'
            : 'WORK_TIME_CORRECTION_APPLIED',
          entityType: CORRECTION_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: {
            newTimeEntryId: newEntry.id,
            lockedTimesheetId: lockedLine?.timesheetId,
          },
        },
        tx,
      );

      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
