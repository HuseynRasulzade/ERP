/**
 * ComparativeReportingService (docx spec Phase 23, sections 56-59).
 * Fiscal-calendar-aware period alignment — "Sep 2026 vs Sep 2025" and
 * "Jan-Sep 2026 YTD vs Jan-Sep 2025 YTD" are computed from the SAME
 * fiscal calendar the current period uses (spec section 57's own "Do not
 * simply subtract 365 days"), never a raw day-count offset. Multi-year
 * lookback works for any fiscal year length since it operates on
 * (year, month) pairs, not day arithmetic — the non-calendar
 * fiscal-year foundation (spec section 58) is satisfied by the caller
 * supplying `fiscalYearStartMonth` (1 = January, the default).
 */
import { Injectable } from '@nestjs/common';

export interface ComparativePeriod {
  columnCode: string;
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class ComparativeReportingService {
  /** Same calendar month one fiscal year earlier. */
  priorYearSamePeriod(periodStart: Date, periodEnd: Date): ComparativePeriod {
    return {
      columnCode: 'PRIOR_YEAR_SAME_PERIOD',
      periodStart: new Date(Date.UTC(periodStart.getUTCFullYear() - 1, periodStart.getUTCMonth(), periodStart.getUTCDate())),
      periodEnd: new Date(Date.UTC(periodEnd.getUTCFullYear() - 1, periodEnd.getUTCMonth(), periodEnd.getUTCDate())),
    };
  }

  /** Year-to-date range from the fiscal year's own start month through
   * `periodEnd`'s month (spec section 57's own Jan-Sep example). */
  yearToDate(periodEnd: Date, fiscalYearStartMonth = 1): ComparativePeriod {
    const fyStartMonthIndex = fiscalYearStartMonth - 1;
    const fiscalYear = periodEnd.getUTCMonth() >= fyStartMonthIndex ? periodEnd.getUTCFullYear() : periodEnd.getUTCFullYear() - 1;
    return { columnCode: 'CURRENT_YTD', periodStart: new Date(Date.UTC(fiscalYear, fyStartMonthIndex, 1)), periodEnd };
  }

  priorYearToDate(periodEnd: Date, fiscalYearStartMonth = 1): ComparativePeriod {
    const currentYtd = this.yearToDate(periodEnd, fiscalYearStartMonth);
    return {
      columnCode: 'PRIOR_YTD',
      periodStart: new Date(Date.UTC(currentYtd.periodStart.getUTCFullYear() - 1, currentYtd.periodStart.getUTCMonth(), currentYtd.periodStart.getUTCDate())),
      periodEnd: new Date(Date.UTC(currentYtd.periodEnd.getUTCFullYear() - 1, currentYtd.periodEnd.getUTCMonth(), currentYtd.periodEnd.getUTCDate())),
    };
  }

  /** Immediately preceding period of the same length (month/quarter). */
  priorPeriod(periodStart: Date, periodEnd: Date): ComparativePeriod {
    const lengthDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
    const priorEnd = new Date(periodStart.getTime() - 86400000);
    const priorStart = new Date(priorEnd.getTime() - (lengthDays - 1) * 86400000);
    return { columnCode: 'PRIOR_PERIOD', periodStart: priorStart, periodEnd: priorEnd };
  }

  variance(current: string, prior: string): { variance: string; variancePercent: string | null } {
    const c = Number(current);
    const p = Number(prior);
    const variance = (c - p).toFixed(2);
    const variancePercent = p === 0 ? null : (((c - p) / Math.abs(p)) * 100).toFixed(2);
    return { variance, variancePercent };
  }
}
