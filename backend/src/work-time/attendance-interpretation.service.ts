import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

interface RawEvent {
  id: string;
  eventTimestamp: Date;
  eventType: string;
}

interface IntervalDraft {
  workDate: Date;
  startTime: Date | null;
  endTime: Date | null;
  durationMinutes: number | null;
  status: string;
  sourceEventIds: string[];
}

/**
 * AttendanceInterpretationService (docx spec Phase 18 sections 20-23) —
 * pairs raw CLOCK_IN/CLOCK_OUT events into AttendanceInterval rows. A shift
 * crossing midnight is anchored to its CLOCK_IN date (SHIFT_START_DATE,
 * spec section 17's configurable options — only this anchor is
 * implemented, disclosed simplification). BREAK_START/BREAK_END/OTHER
 * events are stored as raw data but not used for interval pairing or
 * actual-clock-based break deduction (disclosed — see
 * docs/WORK_TIME.md: break minutes come from the schedule pattern
 * uniformly instead).
 */
@Injectable()
export class AttendanceInterpretationService {
  constructor(private readonly prisma: PrismaService) {}

  async interpret(
    tenantId: string,
    employmentId: string,
    fromDate: string,
    toDate: string,
  ) {
    const from = this.parseDate(fromDate);
    const to = this.parseDate(toDate);
    if (to < from)
      throw new ValidationAppError('toDate cannot be before fromDate');

    // Pad the window so a shift starting the day before `from` (or ending
    // the day after `to`) still pairs correctly.
    const paddedFrom = this.addDays(from, -1);
    const paddedTo = this.addDays(to, 2);

    const events = await this.prisma.attendanceEvent.findMany({
      where: {
        tenantId,
        employmentId,
        eventTimestamp: { gte: paddedFrom, lt: paddedTo },
      },
      orderBy: { eventTimestamp: 'asc' },
    });

    const drafts = this.pairEvents(events);
    const inRange = drafts.filter(
      (d) => d.workDate >= from && d.workDate <= to,
    );

    return this.prisma.runInTransaction(async (tx) => {
      await tx.attendanceInterval.deleteMany({
        where: {
          tenantId,
          employmentId,
          workDate: { gte: from, lte: to },
          status: { not: 'MANUAL' },
        },
      });
      const created = [];
      for (const draft of inRange) {
        created.push(
          await tx.attendanceInterval.create({
            data: {
              tenantId,
              employmentId,
              workDate: draft.workDate,
              startTime: draft.startTime,
              endTime: draft.endTime,
              durationMinutes: draft.durationMinutes,
              status: draft.status,
              sourceEventIds: draft.sourceEventIds,
            },
          }),
        );
      }
      return created;
    });
  }

  private pairEvents(events: RawEvent[]): IntervalDraft[] {
    const drafts: IntervalDraft[] = [];
    let pending: RawEvent | null = null;

    for (const event of events) {
      if (event.eventType === 'CLOCK_IN') {
        if (pending) {
          const gapMs =
            event.eventTimestamp.getTime() - pending.eventTimestamp.getTime();
          if (gapMs >= 0 && gapMs <= DUPLICATE_WINDOW_MS) {
            drafts.push({
              workDate: this.dateOnly(pending.eventTimestamp),
              startTime: pending.eventTimestamp,
              endTime: null,
              durationMinutes: null,
              status: 'DUPLICATE_FLAGGED',
              sourceEventIds: [pending.id, event.id],
            });
            continue;
          }
          drafts.push({
            workDate: this.dateOnly(pending.eventTimestamp),
            startTime: pending.eventTimestamp,
            endTime: null,
            durationMinutes: null,
            status: 'MISSING_CLOCK_OUT',
            sourceEventIds: [pending.id],
          });
        }
        pending = event;
        continue;
      }

      if (event.eventType === 'CLOCK_OUT') {
        if (!pending) {
          drafts.push({
            workDate: this.dateOnly(event.eventTimestamp),
            startTime: null,
            endTime: event.eventTimestamp,
            durationMinutes: null,
            status: 'MISSING_CLOCK_IN',
            sourceEventIds: [event.id],
          });
          continue;
        }
        const durationMinutes = Math.round(
          (event.eventTimestamp.getTime() - pending.eventTimestamp.getTime()) /
            60_000,
        );
        drafts.push({
          workDate: this.dateOnly(pending.eventTimestamp),
          startTime: pending.eventTimestamp,
          endTime: event.eventTimestamp,
          durationMinutes: durationMinutes > 0 ? durationMinutes : 0,
          status: durationMinutes > 0 ? 'OK' : 'MISSING_CLOCK_OUT',
          sourceEventIds: [pending.id, event.id],
        });
        pending = null;
      }
      // BREAK_START/BREAK_END/OTHER — raw data only, not paired here.
    }

    if (pending) {
      drafts.push({
        workDate: this.dateOnly(pending.eventTimestamp),
        startTime: pending.eventTimestamp,
        endTime: null,
        durationMinutes: null,
        status: 'MISSING_CLOCK_OUT',
        sourceEventIds: [pending.id],
      });
    }

    return drafts;
  }

  private dateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
