/**
 * TimeCode catalog (docx spec Phase 18 sections 24-25). The spec asks for a
 * fully configurable per-tenant catalog; this build hardcodes the standard
 * set as constants instead (disclosed simplification, same convention as
 * `DEPRECIATION_METHODS` in Fixed Assets) — `countsAsWorkedTime`/
 * `countsAsPaidTime` are exactly the flags spec section 53's paid-vs-worked
 * distinction depends on, so they're modeled precisely even though the
 * catalog itself isn't admin-editable yet.
 */
export const TimeCodes = {
  REGULAR_WORK: 'REGULAR_WORK',
  OVERTIME: 'OVERTIME',
  NIGHT_WORK: 'NIGHT_WORK',
  WEEKEND_WORK: 'WEEKEND_WORK',
  HOLIDAY_WORK: 'HOLIDAY_WORK',
  ANNUAL_LEAVE: 'ANNUAL_LEAVE',
  UNPAID_LEAVE: 'UNPAID_LEAVE',
  SICK_LEAVE: 'SICK_LEAVE',
  BUSINESS_TRIP: 'BUSINESS_TRIP',
  ABSENCE: 'ABSENCE',
  TRAINING: 'TRAINING',
  DOWNTIME: 'DOWNTIME',
  OTHER: 'OTHER',
} as const;

export type TimeCode = (typeof TimeCodes)[keyof typeof TimeCodes];

export interface TimeCodeAttributes {
  countsAsWorkedTime: boolean;
  countsAsPaidTime: boolean;
  /** true for NIGHT_WORK/WEEKEND_WORK/HOLIDAY_WORK — a premium OVERLAY on
   * top of base worked hours, never counted again in the base total (spec
   * sections 47-48). */
  isPremiumOverlay: boolean;
}

export const TIME_CODE_ATTRIBUTES: Record<TimeCode, TimeCodeAttributes> = {
  REGULAR_WORK: {
    countsAsWorkedTime: true,
    countsAsPaidTime: true,
    isPremiumOverlay: false,
  },
  OVERTIME: {
    countsAsWorkedTime: true,
    countsAsPaidTime: true,
    isPremiumOverlay: false,
  },
  NIGHT_WORK: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: true,
  },
  WEEKEND_WORK: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: true,
  },
  HOLIDAY_WORK: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: true,
  },
  ANNUAL_LEAVE: {
    countsAsWorkedTime: false,
    countsAsPaidTime: true,
    isPremiumOverlay: false,
  },
  UNPAID_LEAVE: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: false,
  },
  SICK_LEAVE: {
    countsAsWorkedTime: false,
    countsAsPaidTime: true,
    isPremiumOverlay: false,
  },
  BUSINESS_TRIP: {
    countsAsWorkedTime: true,
    countsAsPaidTime: true,
    isPremiumOverlay: false,
  },
  ABSENCE: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: false,
  },
  TRAINING: {
    countsAsWorkedTime: true,
    countsAsPaidTime: true,
    isPremiumOverlay: false,
  },
  DOWNTIME: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: false,
  },
  OTHER: {
    countsAsWorkedTime: false,
    countsAsPaidTime: false,
    isPremiumOverlay: false,
  },
};

export const NIGHT_WINDOW_START_HOUR = 22;
export const NIGHT_WINDOW_END_HOUR = 6;
