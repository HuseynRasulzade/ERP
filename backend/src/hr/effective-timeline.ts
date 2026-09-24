import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ErrorCode, HrRuleError } from '../common/errors/app-error';
import { addDays, fmtHr } from './hr-date.util';

/** The three authoritative effective-dated history tables of an employment. */
export type TimelineModel = 'employeeAssignment' | 'workScheduleAssignment' | 'employmentStatusHistory';

const LABEL: Record<TimelineModel, string> = {
  employeeAssignment: 'assignment',
  workScheduleAssignment: 'work schedule assignment',
  employmentStatusHistory: 'employment status',
};

/**
 * Shared mechanics of an effective-dated, non-overlapping, immutable history
 * (spec 22/26/27/74). Rules:
 *  - rows are inclusive [effectiveFrom, effectiveTo]; `null` = open-ended;
 *  - a change at date D closes the row covering D at D-1 and starts a new
 *    row at D (the old row is never overwritten — only its end is set);
 *  - a same-day change leaves the superseded row as a zero-length range
 *    (effectiveTo = effectiveFrom - 1), ordered by `sequence` (spec 27);
 *  - a change is refused when a LATER change already exists (it would
 *    silently rewrite that later state) — reverse the later change first;
 *  - reversal never deletes: the row is marked REVERSED and its
 *    predecessor's end is restored.
 * Callers MUST hold the employment row lock (EmploymentService.lock) so
 * concurrent HR writers for one employment are serialized (spec 77/141).
 */
export class EffectiveTimeline {
  constructor(
    private readonly tx: PrismaTransactionClient,
    private readonly model: TimelineModel,
    private readonly scope: Record<string, unknown> = {},
  ) {}

  private get delegate(): any {
    return (this.tx as any)[this.model];
  }

  private where(employmentId: string, extra: Record<string, unknown> = {}) {
    return { employmentId, recordStatus: 'ACTIVE', ...this.scope, ...extra };
  }

  covering(employmentId: string, date: Date) {
    return this.delegate.findFirst({
      where: this.where(employmentId, { effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }),
      orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
    });
  }

  later(employmentId: string, date: Date) {
    return this.delegate.findFirst({ where: this.where(employmentId, { effectiveFrom: { gt: date } }), orderBy: [{ effectiveFrom: 'asc' }, { sequence: 'asc' }] });
  }

  latest(employmentId: string) {
    return this.delegate.findFirst({ where: this.where(employmentId), orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }] });
  }

  all(employmentId: string) {
    return this.delegate.findMany({ where: this.where(employmentId), orderBy: [{ effectiveFrom: 'asc' }, { sequence: 'asc' }] });
  }

  /** First row of the history (used for "no row yet" initial inserts). */
  async insertInitial(employmentId: string, data: Record<string, unknown>) {
    const existing = await this.latest(employmentId);
    return this.delegate.create({ data: { ...data, employmentId, sequence: existing ? existing.sequence + 1 : 1 } });
  }

  /**
   * Closes the row covering `date` at date-1 and inserts `data` from `date`.
   * `expectedPreviousId` is the effective-date optimistic lock: the row the
   * caller based its change on must still be the one in effect (spec 77).
   */
  async change(
    employmentId: string,
    date: Date,
    build: (previous: any) => Record<string, unknown>,
    opts: { expectedPreviousId?: string | null; allowNoPrevious?: boolean } = {},
  ) {
    const later = await this.later(employmentId, date);
    if (later) {
      throw new HrRuleError(
        ErrorCode.HR_EFFECTIVE_DATE_CONFLICT,
        `Change effective ${fmtHr(date)} conflicts with a later ${LABEL[this.model]} change effective ${fmtHr(later.effectiveFrom)}; reverse the later change first`,
        409,
      );
    }
    const previous = await this.covering(employmentId, date);
    if (!previous && !opts.allowNoPrevious) {
      throw new HrRuleError(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, `No ${LABEL[this.model]} is in effect on ${fmtHr(date)}`, 409);
    }
    if (opts.expectedPreviousId && previous?.id !== opts.expectedPreviousId) {
      throw new HrRuleError(
        ErrorCode.HR_EFFECTIVE_DATE_CONFLICT,
        `Transfer effective date ${fmtHr(date)} overlaps an existing ${LABEL[this.model]} created after this document was prepared (by another HR change); refresh and re-create it`,
        409,
      );
    }
    let sequence = 1;
    let effectiveTo: Date | null = null;
    if (previous) {
      sequence = previous.sequence + 1;
      effectiveTo = previous.effectiveTo ?? null;
      const closed = await this.delegate.updateMany({
        where: { id: previous.id, recordStatus: 'ACTIVE', effectiveTo: previous.effectiveTo },
        data: { effectiveTo: addDays(date, -1) },
      });
      if (closed.count !== 1) throw new HrRuleError(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, `The ${LABEL[this.model]} in effect on ${fmtHr(date)} was changed concurrently; retry`, 409);
    }
    const created = await this.delegate.create({
      data: { ...build(previous), employmentId, effectiveFrom: date, effectiveTo, sequence },
    });
    return { previous, created };
  }

  /** Ends the history at `endDate` (termination). Refuses when a change is
   * already recorded after `endDate`. Returns the closed row (if any). */
  async closeAt(employmentId: string, endDate: Date) {
    const later = await this.later(employmentId, endDate);
    if (later) {
      throw new HrRuleError(
        ErrorCode.HR_EFFECTIVE_DATE_CONFLICT,
        `A ${LABEL[this.model]} change is already recorded effective ${fmtHr(later.effectiveFrom)}, after ${fmtHr(endDate)}; reverse it first`,
        409,
      );
    }
    const row = await this.covering(employmentId, endDate);
    if (!row) return null;
    if (!row.effectiveTo || row.effectiveTo > endDate) {
      await this.delegate.update({ where: { id: row.id }, data: { effectiveTo: endDate } });
    }
    return row;
  }

  /** Re-opens the row that was closed at `closedAt` (termination reversal). */
  async reopenClosedAt(employmentId: string, closedAt: Date, restoreTo: Date | null = null) {
    const row = await this.delegate.findFirst({ where: this.where(employmentId, { effectiveTo: closedAt }), orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }] });
    if (row) await this.delegate.update({ where: { id: row.id }, data: { effectiveTo: restoreTo } });
    return row;
  }

  /**
   * Reverses every active row written by one source document: marks it
   * REVERSED (kept for audit) and restores its predecessor's end. Refused if
   * a later change was built on top of it.
   */
  async reverseSource(employmentId: string, sourceDocumentType: string, sourceDocumentId: string) {
    const rows = await this.delegate.findMany({
      where: this.where(employmentId, { sourceDocumentType, sourceDocumentId }),
      orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
    });
    for (const row of rows) {
      const newer = await this.delegate.findFirst({
        where: this.where(employmentId, {
          id: { not: row.id },
          OR: [{ effectiveFrom: { gt: row.effectiveFrom } }, { effectiveFrom: row.effectiveFrom, sequence: { gt: row.sequence } }],
        }),
      });
      if (newer) {
        throw new HrRuleError(
          ErrorCode.HR_EFFECTIVE_DATE_CONFLICT,
          `Cannot reverse: a later ${LABEL[this.model]} change effective ${fmtHr(newer.effectiveFrom)} depends on it; reverse that change first`,
          409,
        );
      }
      await this.delegate.update({ where: { id: row.id }, data: { recordStatus: 'REVERSED' } });
      const predecessor = await this.delegate.findFirst({
        where: this.where(employmentId, {
          OR: [{ effectiveFrom: { lt: row.effectiveFrom } }, { effectiveFrom: row.effectiveFrom, sequence: { lt: row.sequence } }],
        }),
        orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
      });
      if (predecessor) await this.delegate.update({ where: { id: predecessor.id }, data: { effectiveTo: row.effectiveTo } });
    }
    return rows;
  }
}
