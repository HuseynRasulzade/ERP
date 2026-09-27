import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

const ALLOCATION_TYPES = ['MANUAL', 'AUTOMATIC', 'ADVANCE_APPLICATION', 'OFFSET', 'RETURN', 'CREDIT_NOTE', 'DEBT_ADJUSTMENT', 'SYSTEM_RECONCILIATION'];
const AUTO_STRATEGIES = ['FIFO_BY_DUE_DATE', 'FIFO_BY_DOCUMENT_DATE', 'OLDEST_OVERDUE_FIRST'];
const DEBT_OPERATION_TYPES = ['RECEIVABLE_INCREASE', 'RECEIVABLE_DECREASE', 'PAYABLE_INCREASE', 'PAYABLE_DECREASE', 'DEBT_WRITE_OFF', 'CREDIT_RECLASSIFICATION', 'CONTRACT_TRANSFER', 'COUNTERPARTY_TRANSFER', 'OTHER'];

export class AllocationLineDto {
  @IsString()
  targetOpenItemId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class ManualAllocateDto {
  @IsString()
  counterpartyId!: string;

  @IsIn(['CUSTOMER', 'SUPPLIER'])
  role!: 'CUSTOMER' | 'SUPPLIER';

  @IsString()
  paymentDocumentType!: string;

  @IsString()
  paymentDocumentId!: string;

  @IsOptional()
  @IsString()
  paymentLineId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsString()
  paymentCurrencyId!: string;

  @IsDateString()
  paymentDate!: string;

  @IsOptional()
  @IsIn(ALLOCATION_TYPES)
  allocationType?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationLineDto)
  lines!: AllocationLineDto[];
}

export class AutoAllocateDto {
  @IsString()
  counterpartyId!: string;

  @IsIn(['CUSTOMER', 'SUPPLIER'])
  role!: 'CUSTOMER' | 'SUPPLIER';

  @IsString()
  paymentDocumentType!: string;

  @IsString()
  paymentDocumentId!: string;

  @IsString()
  paymentCurrencyId!: string;

  @IsDateString()
  paymentDate!: string;

  @IsNumber()
  @Min(0.01)
  paymentAmount!: number;

  @IsOptional()
  @IsIn(AUTO_STRATEGIES)
  strategy?: string;

  @IsOptional()
  @IsString()
  contractId?: string;
}

export class ApplyAdvanceDto {
  @IsString()
  advanceOpenItemId!: string;

  @IsString()
  targetOpenItemId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class CreateOffsetDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  offsetDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class DebtAdjustmentLineDto {
  @IsOptional()
  @IsString()
  openItemId?: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  targetContractId?: string;

  @IsOptional()
  @IsString()
  targetCounterpartyId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateDebtAdjustmentDto {
  @IsString()
  counterpartyId!: string;

  @IsDateString()
  documentDate!: string;

  @IsIn(DEBT_OPERATION_TYPES)
  operationType!: string;

  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DebtAdjustmentLineDto)
  lines!: DebtAdjustmentLineDto[];
}

export class GenerateReconciliationDto {
  @IsString()
  counterpartyId!: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;
}

export class ConfirmReconciliationDto {
  @IsOptional()
  @IsBoolean()
  confirmedByUs?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmedByCounterparty?: boolean;

  @IsOptional()
  @IsNumber()
  theirBalance?: number;

  @IsOptional()
  @IsString()
  differenceReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
