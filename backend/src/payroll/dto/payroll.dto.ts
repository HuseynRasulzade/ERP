import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// ---------------------------------------------------------------------------
// Payroll Period
// ---------------------------------------------------------------------------

export class CreatePayrollPeriodDto {
  @IsInt()
  year!: number;

  @IsInt()
  @Min(1)
  month!: number;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;
}

export class ApprovePayrollPeriodDto {
  @IsInt()
  @Min(1)
  expectedCalculationVersion!: number;
}

export class ReopenPayrollPeriodDto {
  @IsString()
  reason!: string;
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

const PAY_BASIS = ['MONTHLY_SALARY', 'HOURLY', 'DAILY', 'PIECE_RATE', 'FIXED_PERIOD_AMOUNT'] as const;
const FTE_BASIS = ['FULL_FTE_RATE', 'ACTUAL_ASSIGNED_SALARY'] as const;

export class CreateCompensationAssignmentDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  compensationType?: string;

  @IsIn(PAY_BASIS)
  payBasis!: (typeof PAY_BASIS)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyRate?: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsIn(FTE_BASIS)
  fteBasis?: (typeof FTE_BASIS)[number];

  @IsOptional()
  @IsString()
  salaryGrade?: string;
}

// ---------------------------------------------------------------------------
// Earning / Deduction Definitions
// ---------------------------------------------------------------------------

export class CreateEarningDefinitionDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  calculationStrategy!: string;

  @IsOptional() taxableIncome?: boolean;
  @IsOptional() socialInsuranceBase?: boolean;
  @IsOptional() unemploymentBase?: boolean;
  @IsOptional() medicalInsuranceBase?: boolean;
  @IsOptional() averageEarningsInclusion?: boolean;
  @IsOptional() grossPayInclusion?: boolean;
  @IsOptional() employerCostInclusion?: boolean;

  @IsOptional()
  @IsString()
  accountingMappingKey?: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}

const DEDUCTION_CATEGORIES = ['STATUTORY', 'VOLUNTARY'] as const;
const TAX_TREATMENTS = ['PRE_TAX', 'POST_TAX'] as const;
const CALC_METHODS = ['PERCENTAGE', 'FIXED', 'FORMULA', 'BRACKET'] as const;

export class CreateDeductionDefinitionDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsIn(DEDUCTION_CATEGORIES)
  category?: (typeof DEDUCTION_CATEGORIES)[number];

  @IsOptional()
  @IsIn(TAX_TREATMENTS)
  taxTreatment?: (typeof TAX_TREATMENTS)[number];

  @IsIn(CALC_METHODS)
  calculationMethod!: (typeof CALC_METHODS)[number];

  @IsOptional()
  @IsString()
  baseDefinition?: string;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  fixedAmount?: number;

  @IsOptional()
  @IsNumber()
  capAmount?: number;

  @IsOptional()
  @IsNumber()
  floorAmount?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  consentRequired?: boolean;

  @IsOptional()
  @IsString()
  accountingMappingKey?: string;
}

// ---------------------------------------------------------------------------
// Legal Rule Set / Tax Brackets / Contribution Brackets / Tax Relief
// ---------------------------------------------------------------------------

export class CreateLegalRuleSetDto {
  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsString()
  ruleCode!: string;

  @IsOptional()
  @IsString()
  legalSource?: string;

  @IsOptional()
  @IsString()
  articleReference?: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsInt()
  ruleVersion?: number;
}

export class CreateTaxBracketDto {
  @IsString()
  ruleCode!: string;

  @IsOptional()
  @IsString()
  regime?: string;

  @IsNumber()
  @Min(0)
  fromAmount!: number;

  @IsOptional()
  @IsNumber()
  toAmount?: number;

  @IsOptional()
  @IsNumber()
  baseTax?: number;

  @IsNumber()
  rate!: number;

  @IsInt()
  sequence!: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

const CONTRIBUTION_TYPES = ['SOCIAL_INSURANCE', 'UNEMPLOYMENT', 'MEDICAL_INSURANCE'] as const;
const PAYER_TYPES = ['EMPLOYEE', 'EMPLOYER'] as const;

export class CreateContributionBracketDto {
  @IsIn(CONTRIBUTION_TYPES)
  contributionType!: (typeof CONTRIBUTION_TYPES)[number];

  @IsIn(PAYER_TYPES)
  payerType!: (typeof PAYER_TYPES)[number];

  @IsOptional()
  @IsString()
  regime?: string;

  @IsNumber()
  @Min(0)
  thresholdFrom!: number;

  @IsOptional()
  @IsNumber()
  thresholdTo?: number;

  @IsOptional()
  @IsNumber()
  fixedComponent?: number;

  @IsNumber()
  percentage!: number;

  @IsInt()
  sequence!: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class CreateTaxReliefDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsIn(['ADDITIVE', 'MUTUALLY_EXCLUSIVE', 'LARGEST_ONLY'])
  combinability?: string;

  @IsOptional()
  mainWorkplaceRequired?: boolean;

  @IsOptional()
  @IsString()
  legalReference?: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class CreateTaxProfileDto {
  @IsString()
  employmentId!: string;

  @IsOptional()
  @IsString()
  taxResidency?: string;

  @IsOptional()
  mainWorkplace?: boolean;

  @IsOptional()
  @IsString()
  sectorCategory?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exemptionCodes?: string[];

  @IsOptional()
  @IsString()
  taxRegime?: string;

  @IsDateString()
  effectiveFrom!: string;
}

// ---------------------------------------------------------------------------
// Variable Inputs / Execution Orders
// ---------------------------------------------------------------------------

export class CreateVariableInputDto {
  @IsString()
  employmentId!: string;

  @IsString()
  earningCode!: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsDateString()
  effectiveDate!: string;

  @IsOptional()
  @IsString()
  sourceDocumentType?: string;

  @IsOptional()
  @IsString()
  sourceDocumentId?: string;
}

const EXECUTION_ORDER_TYPES = ['ALIMONY', 'EXECUTION_ORDER', 'UNION_DUES', 'EMPLOYEE_LOAN', 'OTHER'] as const;

export class CreateExecutionOrderDto {
  @IsString()
  employmentId!: string;

  @IsIn(EXECUTION_ORDER_TYPES)
  orderType!: (typeof EXECUTION_ORDER_TYPES)[number];

  @IsOptional()
  @IsString()
  creditor?: string;

  @IsOptional()
  @IsString()
  executionDocumentReference?: string;

  @IsIn(['PERCENTAGE', 'FIXED'])
  calculationMethod!: string;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  fixedAmount?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsNumber()
  capAmount?: number;

  @IsOptional()
  @IsString()
  protectedMinimumRule?: string;
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

const RUN_TYPES = ['PREVIEW', 'REGULAR', 'RECALCULATION', 'RETROACTIVE', 'TERMINATION', 'OFF_CYCLE', 'FINAL'] as const;

export class CalculatePayrollDto {
  @IsOptional()
  @IsIn(RUN_TYPES)
  runType?: (typeof RUN_TYPES)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  employmentIds?: string[];
}

export class RequestRecalculationDto {
  @IsString()
  employmentId!: string;

  @IsString()
  earliestAffectedPeriodId!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  sourceDocumentType?: string;

  @IsOptional()
  @IsString()
  sourceDocumentId?: string;
}

// ---------------------------------------------------------------------------
// Payment Batch
// ---------------------------------------------------------------------------

export class CreatePaymentBatchDto {
  @IsIn(['BANK', 'CASH'])
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  cashDeskId?: string;

  @IsDateString()
  paymentDate!: string;

  @IsArray()
  @IsString({ each: true })
  employmentIds!: string[];
}

export class RecordPaymentDto {
  @IsString()
  employmentId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  allocationDate!: string;

  @IsOptional()
  @IsString()
  paymentDocumentType?: string;

  @IsOptional()
  @IsString()
  paymentDocumentId?: string;
}
