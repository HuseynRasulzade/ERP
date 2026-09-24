import { HrRuleError, ErrorCode } from '../common/errors/app-error';

/**
 * HR effective-date semantics (spec 27): HR changes are dated by calendar
 * day, never by timestamp. Every HR date is a UTC-midnight `Date` that maps
 * 1:1 onto a Postgres `DATE` column. Ranges are inclusive on both ends:
 * [effectiveFrom, effectiveTo], `effectiveTo = null` meaning open-ended.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const OPEN_END = new Date(Date.UTC(9999, 11, 31));

export function parseHrDate(value: string | Date | undefined | null, field = 'date'): Date {
  if (value === undefined || value === null || value === '') {
    throw new HrRuleError(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `${field} is required`, 400);
  }
  if (value instanceof Date) return toHrDate(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new HrRuleError(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `${field} must be a YYYY-MM-DD date, got '${value}'`, 400);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new HrRuleError(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `${field} is not a valid date`, 400);
  return d;
}

export function parseOptionalHrDate(value: string | Date | undefined | null, field = 'date'): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return parseHrDate(value, field);
}

/** Truncates any Date to its UTC calendar day. */
export function toHrDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function todayHr(): Date {
  return toHrDate(new Date());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((toHrDate(to).getTime() - toHrDate(from).getTime()) / DAY_MS);
}

/** dd.mm.yyyy — the format used in every user-facing HR error message. */
export function fmtHr(d: Date | null | undefined): string {
  if (!d) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

export function isoHr(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function covers(from: Date, to: Date | null | undefined, d: Date): boolean {
  return from.getTime() <= d.getTime() && (!to || to.getTime() >= d.getTime());
}

export function rangesOverlapHr(aFrom: Date, aTo: Date | null | undefined, bFrom: Date, bTo: Date | null | undefined): boolean {
  const aEnd = (aTo ?? OPEN_END).getTime();
  const bEnd = (bTo ?? OPEN_END).getTime();
  return aFrom.getTime() <= bEnd && bFrom.getTime() <= aEnd;
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
