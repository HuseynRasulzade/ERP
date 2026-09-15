import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateCashPaymentDto {
  @IsIn(['INCOMING', 'OUTGOING']) direction!: string;
  @IsOptional() @IsString() counterpartyId?: string;
  @IsOptional() @IsString() counterpartyRole?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsString() cashDeskId!: string;
  @IsOptional() @IsString() cashierId?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsNumber() exchangeRate?: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() operationType?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateCashDeskTransferDto {
  @IsString() sourceCashDeskId!: string;
  @IsString() destinationCashDeskId!: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsIn(['INSTANT', 'TWO_STEP']) transferMode?: string;
  @IsISO8601() documentDate!: string;
}

export class ReceiveCashDeskTransferDto {
  @IsNumber() receivedAmount!: number;
}

export class DenominationLineDto {
  @IsNumber() value!: number;
  @IsNumber() quantity!: number;
}

export class CashPhysicalCountDto {
  @IsString() cashDeskId!: string;
  @IsOptional() @IsString() cashierId?: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DenominationLineDto) denominations?: DenominationLineDto[];
  @IsOptional() @IsNumber() manualTotal?: number;
  @IsOptional() @IsBoolean() blind?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class SeedDenominationMasterDto {
  @IsString() currencyId!: string;
  @IsArray() @ArrayMinSize(1) @IsNumber({}, { each: true }) values!: number[];
}

export class CreateCashCountAdjustmentDto {
  @IsString() cashDeskId!: string;
  @IsOptional() @IsString() physicalCountId?: string;
  @IsIn(['CASH_SURPLUS', 'CASH_SHORTAGE', 'DOCUMENT_CORRECTION', 'CASHIER_RECEIVABLE', 'OTHER']) adjustmentType!: string;
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsISO8601() documentDate!: string;
}

export class AssignCashierDto {
  @IsString() cashDeskId!: string;
  @IsString() assignedUserId!: string;
  @IsISO8601() validFrom!: string;
  @IsOptional() @IsISO8601() validTo?: string;
}

export class InitiateHandoverDto {
  @IsString() cashDeskId!: string;
  @IsString() outgoingCashierId!: string;
  @IsString() incomingCashierId!: string;
  @IsString() currencyId!: string;
  @IsNumber() physicalBalance!: number;
  @IsOptional() @IsString() denominationCountId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class DailyCloseAttemptDto {
  @IsString() cashDeskId!: string;
  @IsString() currencyId!: string;
  @IsISO8601() businessDate!: string;
  @IsOptional() @IsString() cashierId?: string;
}

export class ReopenDailyCloseDto {
  @IsString() reason!: string;
}
