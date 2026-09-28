/**
 * Azerbaijan 2026 non-oil private-sector payroll localization — SEED DATA,
 * never referenced by name/value from the calculation engine itself (docx
 * spec Phase 19 section 51: "BUNU CORE ENGINE-DƏ HARDCODE ETMƏ").
 *
 * IMPORTANT: the specific rates/thresholds below are illustrative,
 * derived from the docx spec's own narrative description of the 2026
 * regime (income tax 3%/10%/14% at 2,500/8,000; social insurance split at
 * 200/8,000; unemployment 0.5%/0.5%; medical insurance threshold moved to
 * 2,500). They demonstrate the effective-dated bracket MECHANISM this
 * phase is required to build — they are not a substitute for verified
 * official rates, and a real deployment must confirm and, if needed,
 * correct them via `POST /payroll/setup/tax-brackets` /
 * `contribution-brackets` before going live. This is exactly why the
 * engine resolves brackets from the database instead of hardcoding them:
 * fixing a rate here never requires a code change.
 */

export const AZ_INCOME_TAX_RULE_CODE = 'AZ_PRIVATE_NONOIL_INCOME_TAX_2026';
export const AZ_LEAVE_AVERAGE_RULE_CODE = 'AZ_LEAVE_AVERAGE_PAY';
export const AZ_OVERTIME_MIN_RATE_RULE_CODE = 'AZ_OVERTIME_MIN_RATE';
export const AZ_LEAVE_AVERAGE_COEFFICIENT = 30.4;
export const AZ_OVERTIME_STATUTORY_MULTIPLIER = 2.0;
export const AZ_NIGHT_PREMIUM_STATUTORY_RATE = 0.5;
export const AZ_HOLIDAY_PREMIUM_STATUTORY_MULTIPLIER = 2.0;

export const AZ_EFFECTIVE_FROM = new Date('2026-01-01');

export const AZ_LEGAL_RULE_SETS = [
  {
    ruleCode: AZ_INCOME_TAX_RULE_CODE,
    legalSource: 'Tax legislation, effective 01.01.2026',
    articleReference: 'Non-oil private sector income tax schedule',
  },
  {
    ruleCode: AZ_LEAVE_AVERAGE_RULE_CODE,
    legalSource: 'Labor Code',
    articleReference: 'Article 140',
  },
  {
    ruleCode: AZ_OVERTIME_MIN_RATE_RULE_CODE,
    legalSource: 'Labor Code',
    articleReference: 'Article 165',
  },
  {
    ruleCode: 'AZ_NIGHT_PREMIUM_MIN_RATE',
    legalSource: 'Labor Code',
    articleReference: 'Article 166',
  },
  {
    ruleCode: 'AZ_HOLIDAY_REST_DAY_PAY',
    legalSource: 'Labor Code',
    articleReference: 'Article 164',
  },
  {
    ruleCode: 'AZ_DEDUCTION_LEGAL_BASIS',
    legalSource: 'Labor Code',
    articleReference: 'Article 175',
  },
  {
    ruleCode: 'AZ_DEDUCTION_LIMITS',
    legalSource: 'Labor Code',
    articleReference: 'Article 176',
  },
  {
    ruleCode: 'AZ_PAYMENT_SCHEDULE',
    legalSource: 'Labor Code',
    articleReference: 'Article 172',
  },
  {
    ruleCode: 'AZ_PAYSLIP_REQUIREMENT',
    legalSource: 'Labor Code',
    articleReference: 'Article 173',
  },
];

export const AZ_INCOME_TAX_BRACKETS = [
  { fromAmount: 0, toAmount: 2500, rate: 0.03, sequence: 1 },
  { fromAmount: 2500, toAmount: 8000, rate: 0.10, sequence: 2 },
  { fromAmount: 8000, toAmount: null, rate: 0.14, sequence: 3 },
];

export const AZ_SOCIAL_INSURANCE_BRACKETS = {
  EMPLOYEE: [
    { thresholdFrom: 0, thresholdTo: 200, percentage: 0.03, sequence: 1 },
    { thresholdFrom: 200, thresholdTo: null, percentage: 0.10, sequence: 2 },
  ],
  EMPLOYER: [
    { thresholdFrom: 0, thresholdTo: 200, percentage: 0.22, sequence: 1 },
    { thresholdFrom: 200, thresholdTo: 8000, percentage: 0.15, sequence: 2 },
    { thresholdFrom: 8000, thresholdTo: null, percentage: 0.02, sequence: 3 },
  ],
};

export const AZ_UNEMPLOYMENT_BRACKETS = {
  EMPLOYEE: [{ thresholdFrom: 0, thresholdTo: null, percentage: 0.005, sequence: 1 }],
  EMPLOYER: [{ thresholdFrom: 0, thresholdTo: null, percentage: 0.005, sequence: 1 }],
};

export const AZ_MEDICAL_INSURANCE_BRACKETS = {
  EMPLOYEE: [
    { thresholdFrom: 0, thresholdTo: 2500, percentage: 0.02, sequence: 1 },
    { thresholdFrom: 2500, thresholdTo: null, percentage: 0.005, sequence: 2 },
  ],
  EMPLOYER: [
    { thresholdFrom: 0, thresholdTo: 2500, percentage: 0.02, sequence: 1 },
    { thresholdFrom: 2500, thresholdTo: null, percentage: 0.005, sequence: 2 },
  ],
};
