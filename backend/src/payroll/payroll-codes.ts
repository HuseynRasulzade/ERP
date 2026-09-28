/**
 * Standard earning/deduction codes (docx spec Phase 19 sections 13/15).
 * The spec asks for a fully admin-configurable catalog; this build seeds a
 * fixed standard set as constants that the calculation engine dispatches
 * on by `calculationStrategy` (disclosed simplification, same convention
 * as `TimeCodes` in Work Time) — the PayrollEarningDefinition/
 * PayrollDeductionDefinition ROWS themselves are still fully DB-backed and
 * editable (inclusion flags, accounting mapping, priority), only the set
 * of strategy codes the engine knows how to compute is fixed.
 */
export const EarningCodes = {
  BASE_SALARY: 'BASE_SALARY',
  OVERTIME_PAY: 'OVERTIME_PAY',
  NIGHT_PREMIUM: 'NIGHT_PREMIUM',
  HOLIDAY_PREMIUM: 'HOLIDAY_PREMIUM',
  WEEKEND_PREMIUM: 'WEEKEND_PREMIUM',
  BONUS: 'BONUS',
  ALLOWANCE: 'ALLOWANCE',
  LEAVE_PAY: 'LEAVE_PAY',
  SICK_PAY: 'SICK_PAY',
  BUSINESS_TRIP_PAY: 'BUSINESS_TRIP_PAY',
  UNUSED_LEAVE_COMPENSATION: 'UNUSED_LEAVE_COMPENSATION',
} as const;
export type EarningCode = (typeof EarningCodes)[keyof typeof EarningCodes];

export const DeductionCodes = {
  INCOME_TAX: 'INCOME_TAX',
  EMPLOYEE_SOCIAL_INSURANCE: 'EMPLOYEE_SOCIAL_INSURANCE',
  EMPLOYEE_UNEMPLOYMENT_INSURANCE: 'EMPLOYEE_UNEMPLOYMENT_INSURANCE',
  EMPLOYEE_MEDICAL_INSURANCE: 'EMPLOYEE_MEDICAL_INSURANCE',
  EXECUTION_ORDER: 'EXECUTION_ORDER',
} as const;
export type DeductionCode = (typeof DeductionCodes)[keyof typeof DeductionCodes];

export const EmployerContributionCodes = {
  EMPLOYER_SOCIAL_INSURANCE: 'EMPLOYER_SOCIAL_INSURANCE',
  EMPLOYER_UNEMPLOYMENT_INSURANCE: 'EMPLOYER_UNEMPLOYMENT_INSURANCE',
  EMPLOYER_MEDICAL_INSURANCE: 'EMPLOYER_MEDICAL_INSURANCE',
} as const;

/** Default earning definitions seeded per tenant (spec section 14's own
 * attribute list). NIGHT_PREMIUM/HOLIDAY_PREMIUM/WEEKEND_PREMIUM read
 * Phase 18's separate premium-hour measures — they are never derived from
 * `regularHours`/`overtimeHours` again (no double counting, spec 175). */
export const DEFAULT_EARNING_DEFINITIONS: Array<{
  code: string;
  name: string;
  calculationStrategy: string;
  taxableIncome: boolean;
  socialInsuranceBase: boolean;
  unemploymentBase: boolean;
  medicalInsuranceBase: boolean;
  averageEarningsInclusion: boolean;
  grossPayInclusion: boolean;
  employerCostInclusion: boolean;
  accountingMappingKey: string;
}> = [
  { code: EarningCodes.BASE_SALARY, name: 'Base Salary', calculationStrategy: 'MONTHLY_SALARY_PRORATED', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: true, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.OVERTIME_PAY, name: 'Overtime Pay', calculationStrategy: 'OVERTIME_STATUTORY', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: true, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.NIGHT_PREMIUM, name: 'Night Premium', calculationStrategy: 'NIGHT_PREMIUM_STATUTORY', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: true, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.HOLIDAY_PREMIUM, name: 'Holiday/Rest-Day Premium', calculationStrategy: 'HOLIDAY_PREMIUM_STATUTORY', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: true, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.WEEKEND_PREMIUM, name: 'Weekend Work Premium', calculationStrategy: 'HOLIDAY_PREMIUM_STATUTORY', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: true, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.BONUS, name: 'Bonus', calculationStrategy: 'VARIABLE_INPUT', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: false, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.ALLOWANCE, name: 'Allowance', calculationStrategy: 'VARIABLE_INPUT', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: true, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.LEAVE_PAY, name: 'Annual Leave Pay', calculationStrategy: 'AVERAGE_EARNINGS_LEAVE', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: false, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.SICK_PAY, name: 'Sick Pay', calculationStrategy: 'AVERAGE_EARNINGS_SICK', taxableIncome: true, socialInsuranceBase: false, unemploymentBase: false, medicalInsuranceBase: false, averageEarningsInclusion: false, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.BUSINESS_TRIP_PAY, name: 'Business Trip Pay', calculationStrategy: 'AVERAGE_EARNINGS_BUSINESS_TRIP', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: false, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
  { code: EarningCodes.UNUSED_LEAVE_COMPENSATION, name: 'Unused Leave Compensation', calculationStrategy: 'AVERAGE_EARNINGS_LEAVE', taxableIncome: true, socialInsuranceBase: true, unemploymentBase: true, medicalInsuranceBase: true, averageEarningsInclusion: false, grossPayInclusion: true, employerCostInclusion: true, accountingMappingKey: 'SALARY_EXPENSE' },
];

/** `accountingMappingKey` here is the GL LIABILITY the deduction is
 * credited to when PayrollPostingHandler posts the period (docx spec
 * Phase 19 sections 97-103) — never the same account for two different
 * withholding types (spec section 114). */
export const DEFAULT_DEDUCTION_DEFINITIONS: Array<{
  code: string;
  name: string;
  category: string;
  taxTreatment: string;
  calculationMethod: string;
  priority: number;
  accountingMappingKey: string;
}> = [
  { code: DeductionCodes.INCOME_TAX, name: 'Income Tax', category: 'STATUTORY', taxTreatment: 'POST_TAX', calculationMethod: 'BRACKET', priority: 10, accountingMappingKey: 'INCOME_TAX_PAYABLE' },
  { code: DeductionCodes.EMPLOYEE_SOCIAL_INSURANCE, name: 'Employee Social Insurance', category: 'STATUTORY', taxTreatment: 'PRE_TAX', calculationMethod: 'BRACKET', priority: 5, accountingMappingKey: 'SOCIAL_INSURANCE_PAYABLE' },
  { code: DeductionCodes.EMPLOYEE_UNEMPLOYMENT_INSURANCE, name: 'Employee Unemployment Insurance', category: 'STATUTORY', taxTreatment: 'PRE_TAX', calculationMethod: 'BRACKET', priority: 6, accountingMappingKey: 'UNEMPLOYMENT_INSURANCE_PAYABLE' },
  { code: DeductionCodes.EMPLOYEE_MEDICAL_INSURANCE, name: 'Employee Medical Insurance', category: 'STATUTORY', taxTreatment: 'PRE_TAX', calculationMethod: 'BRACKET', priority: 7, accountingMappingKey: 'MEDICAL_INSURANCE_PAYABLE' },
  { code: DeductionCodes.EXECUTION_ORDER, name: 'Execution Order / Alimony', category: 'STATUTORY', taxTreatment: 'POST_TAX', calculationMethod: 'FORMULA', priority: 50, accountingMappingKey: 'EXECUTION_ORDER_PAYABLE' },
];

/** Employer contribution codes have no PayrollDeductionDefinition catalog
 * row (spec never asks for one — they are the employer's own cost, not an
 * employee withholding), so their GL liability mapping is fixed here
 * instead of being admin-configurable per tenant (disclosed
 * simplification, see docs/PAYROLL.md). */
export const EMPLOYER_CONTRIBUTION_PAYABLE_MAPPING: Record<string, string> = {
  [EmployerContributionCodes.EMPLOYER_SOCIAL_INSURANCE]: 'SOCIAL_INSURANCE_PAYABLE',
  [EmployerContributionCodes.EMPLOYER_UNEMPLOYMENT_INSURANCE]: 'UNEMPLOYMENT_INSURANCE_PAYABLE',
  [EmployerContributionCodes.EMPLOYER_MEDICAL_INSURANCE]: 'MEDICAL_INSURANCE_PAYABLE',
};
