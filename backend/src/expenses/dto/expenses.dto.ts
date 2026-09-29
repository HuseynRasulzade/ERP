import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// ---------------------------------------------------------------------------
// Cost Center
// ---------------------------------------------------------------------------

export class CreateCostCenterDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentCostCenterId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  responsiblePersonId?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

// ---------------------------------------------------------------------------
// Expense Category / Policy
// ---------------------------------------------------------------------------

const RECEIPT_REQUIREMENTS = ['REQUIRED', 'OPTIONAL', 'NOT_REQUIRED', 'REQUIRED_ABOVE_THRESHOLD'] as const;

export class CreateExpenseCategoryDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  defaultAccountingMappingKey?: string;

  @IsOptional()
  @IsIn(RECEIPT_REQUIREMENTS)
  receiptRequirement?: (typeof RECEIPT_REQUIREMENTS)[number];

  @IsOptional()
  @IsNumber()
  receiptRequiredThreshold?: number;

  @IsOptional()
  @IsBoolean()
  businessPurposeRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  prepaidEligible?: boolean;

  @IsOptional()
  @IsBoolean()
  capitalizableEligible?: boolean;

  @IsOptional()
  @IsBoolean()
  inventoryCostEligible?: boolean;

  @IsOptional()
  @IsBoolean()
  allocationRequired?: boolean;
}

export class CreateExpensePolicyDto {
  @IsOptional()
  @IsString()
  expenseCategoryId?: string;

  @IsOptional()
  @IsString()
  employeeGrade?: string;

  @IsOptional()
  @IsString()
  positionId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  travelType?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsIn(['PER_DAY', 'PER_NIGHT', 'PER_TRIP', 'PER_CLAIM'])
  maxAmountPeriod?: string;

  @IsOptional()
  @IsIn(RECEIPT_REQUIREMENTS)
  receiptRequiredOverride?: string;

  @IsOptional()
  @IsBoolean()
  businessPurposeRequired?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

// ---------------------------------------------------------------------------
// Expense Claim / Lines / Receipts
// ---------------------------------------------------------------------------

const PAYMENT_SOURCE_TYPES = [
  'EMPLOYEE_PERSONAL_FUNDS',
  'EMPLOYEE_ADVANCE',
  'CASH_DESK',
  'BANK',
  'CORPORATE_CARD',
  'SUPPLIER_PAYABLE',
  'OTHER',
] as const;

export class CreateExpenseClaimLineDto {
  @IsDateString()
  expenseDate!: string;

  @IsString()
  expenseCategoryId!: string;

  @IsOptional()
  @IsString()
  merchant?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  supplierTaxId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  businessPurpose?: string;

  @IsString()
  transactionCurrencyId!: string;

  @IsNumber()
  @Min(0.01)
  transactionAmount!: number;

  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @IsIn(PAYMENT_SOURCE_TYPES)
  paymentSourceType!: (typeof PAYMENT_SOURCE_TYPES)[number];

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  sourceDocumentType?: string;

  @IsOptional()
  @IsString()
  sourceDocumentId?: string;

  @IsOptional()
  @IsBoolean()
  prepaidCandidate?: boolean;

  @IsOptional()
  @IsBoolean()
  capitalizableCandidate?: boolean;
}

export class CreateExpenseClaimDto {
  @IsString()
  employmentId!: string;

  /** The Phase 15 ResponsiblePerson holding this employee's advance
   * balance (if any) — see the schema doc comment on
   * ExpenseClaim.responsiblePersonId for why this is a separate id from
   * employmentId. Omit when this employee has no advance to settle
   * against. */
  @IsOptional()
  @IsString()
  responsiblePersonId?: string;

  @IsDateString()
  claimDate!: string;

  @IsOptional()
  @IsDateString()
  expensePeriodStart?: string;

  @IsOptional()
  @IsDateString()
  expensePeriodEnd?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  responsibleManagerId?: string;

  @IsArray()
  lines!: CreateExpenseClaimLineDto[];
}

export class SubmitExpenseClaimDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ApproveExpenseClaimLineDto {
  @IsString()
  lineId!: string;

  @IsNumber()
  @Min(0)
  approvedAmount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveExpenseClaimDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsArray()
  lines!: ApproveExpenseClaimLineDto[];
}

// ---------------------------------------------------------------------------
// Prepaid Expense
// ---------------------------------------------------------------------------

const ALLOCATION_METHODS = ['STRAIGHT_LINE_BY_MONTH', 'STRAIGHT_LINE_BY_DAY', 'FIXED_SCHEDULE', 'MANUAL', 'USAGE_BASED'] as const;

export class CreatePrepaidExpenseDto {
  @IsOptional()
  @IsString()
  sourceClaimLineId?: string;

  @IsString()
  expenseCategoryId!: string;

  @IsNumber()
  @Min(0.01)
  originalAmount!: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsDateString()
  recognitionStartDate!: string;

  @IsDateString()
  recognitionEndDate!: string;

  @IsOptional()
  @IsIn(ALLOCATION_METHODS)
  allocationMethod?: (typeof ALLOCATION_METHODS)[number];

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Cost Allocation
// ---------------------------------------------------------------------------

export class SetAllocationDriverValueDto {
  @IsString()
  allocationDriverId!: string;

  @IsInt()
  periodYear!: number;

  @IsInt()
  @Min(1)
  periodMonth!: number;

  @IsString()
  targetType!: string;

  @IsString()
  targetId!: string;

  @IsNumber()
  value!: number;
}

export class ComputeDriverValuesDto {
  @IsString()
  allocationDriverId!: string;

  @IsInt()
  periodYear!: number;

  @IsInt()
  @Min(1)
  periodMonth!: number;

  @IsArray()
  @IsString({ each: true })
  targetDepartmentIds!: string[];
}

class AllocationRuleTargetDto {
  @IsString()
  targetType!: string;

  @IsString()
  targetId!: string;

  @IsOptional()
  @IsNumber()
  fixedWeight?: number;
}

export class CreateAllocationRuleDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  sourceCostCenterId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expenseCategoryFilter?: string[];

  @IsIn(['DIRECT', 'DRIVER_BASED', 'MANUAL'])
  allocationType!: string;

  @IsOptional()
  @IsString()
  allocationDriverId?: string;

  @IsArray()
  targets!: AllocationRuleTargetDto[];

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class RunCostAllocationDto {
  @IsInt()
  periodYear!: number;

  @IsInt()
  @Min(1)
  periodMonth!: number;
}

export class RunPrepaidRecognitionDto {
  @IsInt()
  periodYear!: number;

  @IsInt()
  @Min(1)
  periodMonth!: number;
}

// ---------------------------------------------------------------------------
// Budget / Period / Adjustment
// ---------------------------------------------------------------------------

export class CreateExpenseBudgetDto {
  @IsInt()
  periodYear!: number;

  @IsInt()
  @Min(1)
  periodMonth!: number;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  expenseCategoryId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumber()
  @Min(0)
  budgetAmount!: number;

  @IsOptional()
  @IsNumber()
  committedAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateExpensePeriodDto {
  @IsInt()
  year!: number;

  @IsInt()
  @Min(1)
  month!: number;
}

export class ReclassifyExpenseLineDto {
  @IsString()
  claimLineId!: string;

  @IsString()
  newCostCenterId!: string;

  @IsString()
  reason!: string;
}

export class UploadExpenseReceiptDto {
  @IsString()
  claimLineId!: string;

  @IsOptional()
  @IsString()
  fileId?: string;

  @IsIn(['FISCAL_RECEIPT', 'INVOICE', 'E_INVOICE', 'TICKET', 'HOTEL_INVOICE', 'BOARDING_PASS', 'CONTRACT', 'PAYMENT_CONFIRMATION', 'OTHER'])
  documentType!: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  supplierTaxId?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsNumber()
  taxAmount?: number;

  @IsOptional()
  @IsString()
  attachmentHash?: string;
}
