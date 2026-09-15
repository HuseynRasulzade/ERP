import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateFinancialPeriodDto {
  @IsInt() fiscalYear!: number;
  @IsInt() periodNumber!: number;
  @IsOptional() @IsIn(['MONTH', 'QUARTER', 'YEAR', 'ADJUSTMENT_PERIOD']) periodType?: string;
}

export class UpsertClosePolicyDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() requireBankReconciliation?: boolean;
  @IsOptional() @IsBoolean() requireCashDailyClose?: boolean;
  @IsOptional() @IsBoolean() requireInventoryCostFinalization?: boolean;
  @IsOptional() @IsBoolean() requireInventoryCount?: boolean;
  @IsOptional() @IsBoolean() requirePayrollClose?: boolean;
  @IsOptional() @IsBoolean() requireFaDepreciation?: boolean;
  @IsOptional() @IsBoolean() requirePrepaidRecognition?: boolean;
  @IsOptional() @IsBoolean() requireProductionCosting?: boolean;
  @IsOptional() @IsBoolean() requireFxRevaluation?: boolean;
  @IsOptional() @IsString() toleranceProfile?: string;
  @IsOptional() @IsBoolean() softCloseAllowed?: boolean;
  @IsOptional() @IsString() reopenPolicy?: string;
  @IsOptional() @IsString() approvalProfile?: string;
}

export class StartCloseRunDto {
  @IsIn(['PREVIEW', 'PRE_CLOSE', 'REGULAR_CLOSE', 'RECLOSE', 'YEAR_END_CLOSE', 'DIAGNOSTIC']) closeType!: string;
}

export class ResolveIssueDto {
  @IsOptional() @IsString() note?: string;
}

export class WaiveIssueDto {
  @IsString() reason!: string;
}

export class CreateAccrualDto {
  @IsString() organizationId!: string;
  @IsString() financialPeriodId!: string;
  @IsIn(['EXPENSE_ACCRUAL', 'REVENUE_ACCRUAL', 'PAYROLL_ACCRUAL', 'INTEREST_ACCRUAL', 'UTILITIES_ACCRUAL', 'SERVICE_ACCRUAL', 'OTHER']) accrualType!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsNumber() @IsPositive() amount!: number;
  @IsString() currencyId!: string;
  @IsString() basis!: string;
  @IsOptional() @IsString() estimateSource?: string;
  @IsOptional() @IsIn(['AUTO_REVERSE_NEXT_PERIOD', 'CLEAR_AGAINST_ACTUAL', 'MANUAL', 'NO_REVERSAL']) reversalPolicy?: string;
}

export class PostAccrualDto {
  @IsISO8601() businessDate!: string;
}

export class MatchAccrualDto {
  @IsString() actualDocumentType!: string;
  @IsString() actualDocumentId!: string;
  @IsNumber() actualAmount!: number;
}

export class CreateDeferredRevenueDto {
  @IsString() organizationId!: string;
  @IsString() sourceDocumentType!: string;
  @IsString() sourceDocumentId!: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsNumber() @IsPositive() totalAmount!: number;
  @IsString() currencyId!: string;
  @IsISO8601() recognitionStartDate!: string;
  @IsISO8601() recognitionEndDate!: string;
}

export class ReopenRequestDto {
  @IsString() financialPeriodId!: string;
  @IsString() reason!: string;
  @IsOptional() @IsArray() affectedModules?: string[];
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
}
