import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * AttendanceImportService + AttendanceInterpretationService combined
 * (spec sections 18-22, 72-76). Raw events are immutable (spec section
 * 19); `[tenantId, sourceSystem, externalEventId]` is unique so
 * re-importing the same biometric punch twice is a no-op (spec section
 * 104). `interpretDay` never silently invents an 8-hour day for a
 * missing punch (spec section 21) — it flags `MISSING_CLOCK_OUT` and
 * leaves the interval incomplete for a human to review.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recordEvent(tenantId: string, userId: string, dto: { employmentId: string; eventTimestamp: string; eventType: string; locationId?: string; deviceId?: string; sourceSystem?: string; externalEventId?: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new ValidationAppError('Attendance event references an unknown employment — silent employee matching is not performed (spec section 72).');
    if (!['ACTIVE', 'PLANNED', 'ON_LEAVE'].includes(employment.employmentStatus)) throw new ValidationAppError(`Cannot record attendance for a ${employment.employmentStatus} employment.`);

    const sourceSystem = dto.sourceSystem ?? 'MANUAL';
    if (dto.externalEventId) {
      const existing = await this.prisma.attendanceEvent.findUnique({ where: { tenantId_sourceSystem_externalEventId: { tenantId, sourceSystem, externalEventId: dto.externalEventId } } });
      if (existing) return existing; // idempotent re-import — spec section 104
    }

    const row = await this.prisma.attendanceEvent.create({ data: { tenantId, employmentId: dto.employmentId, eventTimestamp: new Date(dto.eventTimestamp), eventType: dto.eventType, locationId: dto.locationId, deviceId: dto.deviceId, sourceSystem, externalEventId: dto.externalEventId, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WT_ATTENDANCE_IMPORTED', entityType: 'ATTENDANCE_EVENT', entityId: row.id, action: 'CREATE', userId, newValues: { eventType: dto.eventType, sourceSystem } });
    return row;
  }

  /** Pairs CLOCK_IN/CLOCK_OUT events for one employment/day into
   * AttendanceInterval rows — deterministic chronological pairing,
   * duplicate IN-after-IN flagged rather than silently dropped (spec
   * section 22). */
  async interpretDay(tenantId: string, userId: string, employmentId: string, workDate: Date) {
    const dayStart = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const events = await this.prisma.attendanceEvent.findMany({ where: { tenantId, employmentId, eventTimestamp: { gte: dayStart, lt: dayEnd }, eventType: { in: ['CLOCK_IN', 'CLOCK_OUT'] } }, orderBy: { eventTimestamp: 'asc' } });

    await this.prisma.attendanceInterval.deleteMany({ where: { tenantId, employmentId, workDate: dayStart } });
    const intervals = [];
    let pendingIn: (typeof events)[number] | null = null;
    for (const event of events) {
      if (event.eventType === 'CLOCK_IN') {
        if (pendingIn) {
          intervals.push(await this.prisma.attendanceInterval.create({ data: { tenantId, employmentId, workDate: dayStart, startEventId: pendingIn.id, startTime: pendingIn.eventTimestamp, status: 'DUPLICATE' } }));
        }
        pendingIn = event;
      } else if (event.eventType === 'CLOCK_OUT') {
        if (!pendingIn) {
          intervals.push(await this.prisma.attendanceInterval.create({ data: { tenantId, employmentId, workDate: dayStart, endEventId: event.id, endTime: event.eventTimestamp, status: 'DUPLICATE' } }));
          continue;
        }
        const durationMinutes = Math.round((event.eventTimestamp.getTime() - pendingIn.eventTimestamp.getTime()) / 60_000);
        intervals.push(await this.prisma.attendanceInterval.create({ data: { tenantId, employmentId, workDate: dayStart, startEventId: pendingIn.id, endEventId: event.id, startTime: pendingIn.eventTimestamp, endTime: event.eventTimestamp, durationMinutes, status: 'COMPLETE' } }));
        pendingIn = null;
      }
    }
    if (pendingIn) {
      intervals.push(await this.prisma.attendanceInterval.create({ data: { tenantId, employmentId, workDate: dayStart, startEventId: pendingIn.id, startTime: pendingIn.eventTimestamp, status: 'MISSING_CLOCK_OUT' } }));
    }

    await this.prisma.attendanceEvent.updateMany({ where: { tenantId, employmentId, eventTimestamp: { gte: dayStart, lt: dayEnd } }, data: { status: 'INTERPRETED' } });
    await this.audit.record({ tenantId, eventType: 'WT_ATTENDANCE_INTERPRETED', entityType: 'ATTENDANCE_INTERVAL', entityId: employmentId, action: 'CREATE', userId, newValues: { workDate: dayStart, intervalCount: intervals.length } });
    return intervals;
  }

  async reviewInterval(tenantId: string, userId: string, id: string) {
    const interval = await this.prisma.attendanceInterval.findFirst({ where: { id, tenantId } });
    if (!interval) throw new NotFoundAppError('AttendanceInterval', id);
    return this.prisma.attendanceInterval.update({ where: { id }, data: { status: 'REVIEWED', reviewedBy: userId, reviewedAt: new Date() } });
  }

  listExceptions(tenantId: string, employmentId?: string) {
    return this.prisma.attendanceInterval.findMany({ where: { tenantId, employmentId, status: { in: ['MISSING_CLOCK_OUT', 'DUPLICATE'] } }, orderBy: { workDate: 'desc' } });
  }
}
