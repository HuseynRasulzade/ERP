import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

const TRANSFER_MODES = ['INSTANT', 'TWO_STEP'] as const;

export class CreateCashDeskTransferDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  sourceCashboxId!: string;

  @IsString()
  destinationCashboxId!: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsIn(TRANSFER_MODES)
  transferMode?: (typeof TRANSFER_MODES)[number];

  @IsOptional()
  @IsString()
  description?: string;
}

export class ReceiveCashDeskTransferDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  /** Omit to receive the entire still-in-transit remainder in one call. */
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class AssignCashierDto {
  @IsString()
  cashboxId!: string;

  @IsString()
  personId!: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class EndCashierAssignmentDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateCurrencyDenominationDto {
  @IsString()
  currencyId!: string;

  @IsNumber()
  @IsPositive()
  faceValue!: number;
}

const COUNT_METHODS = ['OPEN', 'BLIND'] as const;

export class StartCashPhysicalCountDto {
  @IsString()
  cashboxId!: string;

  @IsOptional()
  @IsString()
  cashierId?: string;

  @IsOptional()
  @IsIn(COUNT_METHODS)
  countMethod?: (typeof COUNT_METHODS)[number];
}

export class CashCountLineDto {
  @IsNumber()
  @IsPositive()
  faceValue!: number;

  @IsInt()
  @Min(0)
  quantity!: number;
}

export class SubmitCashPhysicalCountDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CashCountLineDto)
  lines!: CashCountLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DecideCashPhysicalCountDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

const ADJUSTMENT_TYPES = [
  'CASH_SURPLUS',
  'CASH_SHORTAGE',
  'DOCUMENT_CORRECTION',
  'CASHIER_RECEIVABLE',
  'OTHER',
] as const;

export class OpenCashDeskDailyCloseDto {
  @IsString()
  cashboxId!: string;

  @IsDateString()
  businessDate!: string;

  @IsOptional()
  @IsString()
  cashierId?: string;
}

export class LinkPhysicalCountDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  physicalCountId!: string;
}

export class CloseCashDeskDailyCloseDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ReopenCashDeskDailyCloseDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  reason!: string;
}

export class CreateCashierHandoverDto {
  @IsString()
  cashboxId!: string;

  @IsString()
  outgoingCashierId!: string;

  @IsString()
  incomingCashierId!: string;

  @IsOptional()
  @IsString()
  denominationCountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CompleteCashierHandoverDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateCashCountAdjustmentDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  countId!: string;

  @IsIn(ADJUSTMENT_TYPES)
  adjustmentType!: (typeof ADJUSTMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  reasonCode?: string;

  /** Required for CASHIER_RECEIVABLE — who the shortage is charged to. */
  @IsOptional()
  @IsString()
  responsiblePersonId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
