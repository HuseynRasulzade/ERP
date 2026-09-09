import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateAccountDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsIn(['ASSET', 'CONTRA_ASSET', 'LIABILITY', 'CONTRA_LIABILITY', 'EQUITY', 'CONTRA_EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE', 'PROFIT_LOSS', 'TAX_EXPENSE', 'OFF_BALANCE'])
  accountClass!: string;
  @IsIn(['DEBIT', 'CREDIT', 'BOTH']) normalBalance!: string;
  @IsOptional() @IsString() parentAccountId?: string;
  @IsOptional() @IsBoolean() postingAllowed?: boolean;
  @IsOptional() @IsBoolean() currencyTracking?: boolean;
  @IsOptional() @IsBoolean() quantityTracking?: boolean;
  @IsOptional() @IsString() organizationId?: string;
}

export class UpdateAccountDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class AccountingMappingDto {
  @IsString() mappingKey!: string;
  @IsString() accountId!: string;
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsDateString() validFrom?: string;
}

export class JournalLineDimensionDto {
  @IsString() dimensionCode!: string;
  @IsString() referenceId!: string;
}

export class ManualOperationLineDto {
  @IsString() accountId!: string;
  @IsIn(['DEBIT', 'CREDIT']) side!: 'DEBIT' | 'CREDIT';
  @IsNumberString() amountBase!: string;
  @IsOptional() @IsString() transactionCurrencyId?: string;
  @IsOptional() @IsNumberString() amountTransaction?: string;
  @IsOptional() @IsNumberString() exchangeRate?: string;
  @IsOptional() @IsNumberString() quantity?: string;
  @IsOptional() @IsString() quantityUnitId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDimensionDto)
  dimensions?: JournalLineDimensionDto[];
}

export class CreateManualOperationDto {
  @IsDateString() businessDate!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ManualOperationLineDto)
  lines!: ManualOperationLineDto[];
}

export class PostJournalEntryDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class TrialBalanceQueryDto {
  @IsDateString() fromDate!: string;
  @IsDateString() toDate!: string;
  @IsOptional() @IsString() accountId?: string;
}

export class GeneralLedgerQueryDto {
  @IsDateString() fromDate!: string;
  @IsDateString() toDate!: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsInt() limit?: number;
  @IsOptional() @IsInt() offset?: number;
}
