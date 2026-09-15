import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';

export class CreateCostCenterDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() parentCostCenterId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
}

export class CreateExpenseCategoryDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() accountingMappingProfile?: string;
  @IsOptional() @IsString() vatTreatmentProfile?: string;
  @IsOptional() @IsIn(['REQUIRED', 'OPTIONAL', 'NOT_REQUIRED', 'REQUIRED_ABOVE_THRESHOLD']) receiptRequirement?: string;
  @IsOptional() @IsNumber() receiptThreshold?: number;
  @IsOptional() @IsBoolean() businessPurposeRequired?: boolean;
  @IsOptional() @IsString() allowedPaymentMethods?: string;
  @IsOptional() @IsBoolean() prepaidEligible?: boolean;
  @IsOptional() @IsBoolean() capitalizableEligible?: boolean;
  @IsOptional() @IsBoolean() fixedAssetEligible?: boolean;
  @IsOptional() @IsBoolean() inventoryCostEligible?: boolean;
  @IsOptional() @IsBoolean() allocationRequired?: boolean;
  @IsOptional() @IsNumber() perTransactionLimit?: number;
}

export class ExpenseClaimLineDto {
  @IsISO8601() expenseDate!: string;
  @IsString() expenseCategoryId!: string;
  @IsOptional() @IsString() merchant?: string;
  @IsOptional() @IsString() supplierTaxId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() businessPurpose?: string;
  @IsString() transactionCurrencyId!: string;
  @IsNumber() transactionAmount!: number;
  @IsOptional() @IsNumber() exchangeRate?: number;
  @IsNumber() baseAmount!: number;
  @IsOptional() @IsNumber() taxAmount?: number;
  @IsOptional() @IsNumber() recoverableVat?: number;
  @IsOptional() @IsNumber() nonrecoverableVat?: number;
  @IsIn(['EMPLOYEE_PERSONAL_FUNDS', 'EMPLOYEE_ADVANCE', 'CASH_DESK', 'BANK', 'CORPORATE_CARD', 'SUPPLIER_PAYABLE', 'OTHER']) paymentSourceType!: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsIn(['CURRENT_EXPENSE', 'PREPAID_EXPENSE', 'INVENTORY_COST', 'FIXED_ASSET', 'CIP', 'EMPLOYEE_RECEIVABLE', 'SUPPLIER_SETTLEMENT', 'NONDEDUCTIBLE_EXPENSE', 'OTHER']) classification?: string;
  @IsOptional() @IsBoolean() prepaidCandidate?: boolean;
  @IsOptional() @IsBoolean() capitalizableCandidate?: boolean;
  @IsOptional() @IsBoolean() receiptAttached?: boolean;
}

export class CreateExpenseClaimDto {
  @IsString() employeeId!: string;
  @IsString() employmentId!: string;
  @IsISO8601() documentDate!: string;
  @IsISO8601() expensePeriodStart!: string;
  @IsISO8601() expensePeriodEnd!: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsString() responsibleManagerId?: string;
  @IsOptional() @IsString() comment?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ExpenseClaimLineDto) lines!: ExpenseClaimLineDto[];
}

export class ApproveLineDto {
  @IsNumber() approvedAmount!: number;
  @IsOptional() @IsString() rejectionReason?: string;
}

export class ApproveLineExceptionDto {
  @IsString() comment!: string;
}

export class AttachReceiptDto {
  @IsString() claimLineId!: string;
  @IsOptional() @IsString() assetId?: string;
  @IsString() documentType!: string;
  @IsOptional() @IsString() documentNumber?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() supplierTaxId?: string;
  @IsOptional() @IsISO8601() documentDate?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() attachmentHash?: string;
}

export class AllocationSplitDto {
  @IsString() targetType!: string;
  @IsString() targetId!: string;
  @IsNumber() percentage!: number;
}

export class AllocateExpenseLineDto {
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => AllocationSplitDto) splits!: AllocationSplitDto[];
}

export class CreateAllocationDriverDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsIn(['MANUAL', 'HR_HEADCOUNT', 'HR_FTE', 'WORK_TIME_HOURS', 'MANUAL_MASTER']) sourceType?: string;
}

export class SetDriverValueDto {
  @IsString() driverId!: string;
  @IsISO8601() period!: string;
  @IsString() costCenterId!: string;
  @IsNumber() value!: number;
  @IsOptional() @IsString() source?: string;
}

export class CreateAllocationRuleDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() sourceCostCenterId!: string;
  @IsOptional() @IsString() expenseCategoryFilter?: string;
  @IsOptional() @IsIn(['DIRECT', 'STEP_DOWN', 'RECIPROCAL_FUTURE', 'MANUAL', 'DRIVER_BASED']) allocationType?: string;
  @IsOptional() @IsString() driverId?: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) targetCostCenterIds!: string[];
  @IsOptional() @IsString() allocationFrequency?: string;
  @IsOptional() @IsInt() sequence?: number;
  @IsISO8601() effectiveFrom!: string;
}

export class CreatePrepaidFromLineDto {
  @IsISO8601() recognitionStartDate!: string;
  @IsISO8601() recognitionEndDate!: string;
  @IsOptional() @IsIn(['STRAIGHT_LINE_BY_MONTH', 'STRAIGHT_LINE_BY_DAY', 'FIXED_SCHEDULE', 'MANUAL', 'USAGE_BASED']) allocationMethod?: string;
}

export class SetBudgetDto {
  @IsISO8601() period!: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() expenseCategoryId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsString() currencyId!: string;
  @IsNumber() @IsPositive() budgetAmount!: number;
}
