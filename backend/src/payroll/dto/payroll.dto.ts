import { IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateRateBracketDto {
  @IsString() bracketType!: string;
  @IsOptional() @IsIn(['EMPLOYEE', 'EMPLOYER']) payerType?: string;
  @IsOptional() @IsString() regime?: string;
  @IsOptional() @IsInt() sequence?: number;
  @IsOptional() @IsNumber() thresholdFrom?: number;
  @IsOptional() @IsNumber() thresholdTo?: number;
  @IsOptional() @IsNumber() fixedComponent?: number;
  @IsOptional() @IsNumber() percentage?: number;
  @IsOptional() @IsNumber() flatValue?: number;
  @IsOptional() @IsString() legalReference?: string;
  @IsISO8601() effectiveFrom!: string;
}

export class CreateEarningDefinitionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() calculationStrategy?: string;
  @IsOptional() @IsBoolean() taxableIncome?: boolean;
  @IsOptional() @IsBoolean() socialInsuranceBase?: boolean;
  @IsOptional() @IsBoolean() unemploymentBase?: boolean;
  @IsOptional() @IsBoolean() medicalInsuranceBase?: boolean;
  @IsOptional() @IsBoolean() averageEarningsInclusion?: boolean;
  @IsOptional() @IsIn(['EMPLOYER', 'SOCIAL_INSURANCE_FUND', 'GOVERNMENT', 'OTHER']) benefitPayer?: string;
  @IsOptional() @IsNumber() defaultMultiplier?: number;
  @IsOptional() @IsInt() priority?: number;
}

export class CreateDeductionDefinitionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsBoolean() isStatutory?: boolean;
  @IsOptional() @IsBoolean() preTax?: boolean;
  @IsOptional() @IsInt() calculationOrder?: number;
  @IsOptional() @IsIn(['PERCENTAGE', 'FIXED', 'FORMULA', 'BRACKET']) calculationMethod?: string;
  @IsOptional() @IsNumber() percentage?: number;
  @IsOptional() @IsNumber() fixedAmount?: number;
  @IsOptional() @IsNumber() capAmount?: number;
  @IsOptional() @IsNumber() floorAmount?: number;
  @IsOptional() @IsBoolean() consentRequired?: boolean;
}

export class AssignCompensationDto {
  @IsString() employmentId!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsIn(['MONTHLY_SALARY', 'HOURLY', 'DAILY', 'PIECE_RATE', 'FIXED_PERIOD_AMOUNT']) payBasis!: string;
  @IsOptional() @IsNumber() @IsPositive() baseSalary?: number;
  @IsOptional() @IsNumber() @IsPositive() hourlyRate?: number;
  @IsOptional() @IsNumber() @IsPositive() dailyRate?: number;
  @IsString() currencyId!: string;
  @IsOptional() @IsIn(['FULL_FTE_RATE', 'ACTUAL_ASSIGNED_SALARY']) fteBasis?: string;
  @IsOptional() @IsString() salaryGrade?: string;
  @IsOptional() @IsIn(['WORKING_DAYS', 'WORKING_HOURS', 'CALENDAR_DAYS', 'FIXED_RULE']) normBasis?: string;
}

export class AssignTaxProfileDto {
  @IsString() employmentId!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsIn(['RESIDENT', 'NON_RESIDENT']) taxResidency?: string;
  @IsOptional() @IsBoolean() mainWorkplace?: boolean;
  @IsOptional() @IsString() sectorCategory?: string;
  @IsOptional() @IsString() taxRegime?: string;
  @IsOptional() @IsNumber() exemptionAmount?: number;
  @IsOptional() @IsString() exemptionCodes?: string;
}

export class CreateVariableInputDto {
  @IsString() employmentId!: string;
  @IsString() earningCode!: string;
  @IsISO8601() payrollPeriod!: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsNumber() percentage?: number;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
  @IsISO8601() effectiveDate!: string;
}

export class CreateExecutionOrderDto {
  @IsString() employmentId!: string;
  @IsIn(['ALIMONY', 'EXECUTION_ORDER', 'OTHER']) orderType!: string;
  @IsString() creditor!: string;
  @IsOptional() @IsString() courtReference?: string;
  @IsOptional() @IsIn(['PERCENTAGE', 'FIXED']) calculationMethod?: string;
  @IsOptional() @IsNumber() percentage?: number;
  @IsOptional() @IsNumber() fixedAmount?: number;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsNumber() capAmount?: number;
  @IsOptional() @IsNumber() protectedMinimum?: number;
  @IsISO8601() effectiveFrom!: string;
}

export class OpenPayrollPeriodDto {
  @IsInt() year!: number;
  @IsInt() month!: number;
  @IsOptional() @IsISO8601() paymentDate?: string;
}

export class ReopenPayrollPeriodDto {
  @IsString() reason!: string;
}

export class CalculatePayrollDto {
  @IsOptional() @IsIn(['PREVIEW', 'REGULAR', 'RECALCULATION', 'RETROACTIVE', 'TERMINATION', 'OFF_CYCLE', 'FINAL']) runType?: 'PREVIEW' | 'REGULAR' | 'RECALCULATION' | 'RETROACTIVE' | 'TERMINATION' | 'OFF_CYCLE' | 'FINAL';
  @IsOptional() @IsString() regime?: string;
}

export class AllocatePaymentDto {
  @IsString() paymentDocumentType!: string;
  @IsString() paymentDocumentId!: string;
  @IsNumber() @IsPositive() amount!: number;
  @IsISO8601() allocationDate!: string;
}

export class FlagRecalculationDto {
  @IsString() employmentId!: string;
  @IsISO8601() earliestAffectedPeriod!: string;
  @IsIn(['SALARY_CHANGE', 'TIME_CORRECTION', 'LEAVE_CORRECTION', 'TAX_PROFILE_CHANGE', 'LEGAL_RULE_CORRECTION', 'HR_ASSIGNMENT_CORRECTION', 'MANUAL_ADJUSTMENT']) reason!: string;
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
}
