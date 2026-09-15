import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateSettlementPaymentDto {
  @IsIn(['INCOMING', 'OUTGOING']) direction!: string;
  @IsString() counterpartyId!: string;
  @IsIn(['CUSTOMER', 'SUPPLIER']) counterpartyRole!: string;
  @IsOptional() @IsString() contractId?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsNumber() exchangeRate?: number;
  @IsOptional() @IsString() reference?: string;
  @IsISO8601() documentDate!: string;
}

export class AllocationLineDto {
  @IsIn(['SETTLEMENT_OBLIGATION', 'SUPPLIER_PAYABLE']) openItemType!: 'SETTLEMENT_OBLIGATION' | 'SUPPLIER_PAYABLE';
  @IsString() openItemId!: string;
  @IsNumber() amount!: number;
}

export class ManualAllocationDto {
  @IsString() paymentDocumentType!: string;
  @IsString() paymentDocumentId!: string;
  @IsString() counterpartyId!: string;
  @IsIn(['CUSTOMER', 'SUPPLIER']) counterpartyRole!: 'CUSTOMER' | 'SUPPLIER';
  @IsOptional() @IsString() contractId?: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsNumber() exchangeRate?: number;
  @IsISO8601() allocationDate!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AllocationLineDto) lines!: AllocationLineDto[];
}

export class AutoAllocationDto {
  @IsString() paymentDocumentType!: string;
  @IsString() paymentDocumentId!: string;
  @IsString() counterpartyId!: string;
  @IsIn(['CUSTOMER', 'SUPPLIER']) counterpartyRole!: 'CUSTOMER' | 'SUPPLIER';
  @IsOptional() @IsString() contractId?: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsNumber() exchangeRate?: number;
  @IsISO8601() allocationDate!: string;
  @IsNumber() amount!: number;
}

export class ApplyAdvanceDto {
  @IsIn(['SETTLEMENT_OBLIGATION', 'SUPPLIER_PAYABLE']) openItemType!: 'SETTLEMENT_OBLIGATION' | 'SUPPLIER_PAYABLE';
  @IsString() openItemId!: string;
  @IsNumber() amount!: number;
}

export class CreateDebtAdjustmentDto {
  @IsString() counterpartyId!: string;
  @IsIn(['CUSTOMER', 'SUPPLIER']) counterpartyRole!: string;
  @IsOptional() @IsString() contractId?: string;
  @IsIn(['RECEIVABLE_INCREASE', 'RECEIVABLE_DECREASE', 'PAYABLE_INCREASE', 'PAYABLE_DECREASE', 'DEBT_WRITE_OFF', 'CREDIT_RECLASSIFICATION', 'CONTRACT_TRANSFER', 'OTHER']) operationType!: string;
  @IsString() reasonCode!: string;
  @IsOptional() @IsIn(['SETTLEMENT_OBLIGATION', 'SUPPLIER_PAYABLE']) targetOpenItemType?: string;
  @IsOptional() @IsString() targetOpenItemId?: string;
  @IsOptional() @IsString() targetContractId?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsISO8601() documentDate!: string;
  @IsOptional() @IsString() description?: string;
}

export class OffsetLineDto {
  @IsString() openItemId!: string;
  @IsNumber() amount!: number;
}

export class CreateSettlementOffsetDto {
  @IsString() counterpartyId!: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() documentDate!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OffsetLineDto) receivableLines!: OffsetLineDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => OffsetLineDto) payableLines!: OffsetLineDto[];
}

export class GenerateReconciliationDto {
  @IsString() counterpartyId!: string;
  @IsIn(['CUSTOMER', 'SUPPLIER']) counterpartyRole!: 'CUSTOMER' | 'SUPPLIER';
  @IsOptional() @IsString() contractId?: string;
  @IsString() currencyId!: string;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}
