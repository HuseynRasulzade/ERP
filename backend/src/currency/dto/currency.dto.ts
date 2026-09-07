import { IsDateString, IsNumberString, IsOptional, IsString } from 'class-validator';

export class RecordExchangeRateDto {
  @IsString()
  currencyCode!: string;

  @IsString()
  baseCurrencyCode!: string;

  @IsDateString()
  effectiveDate!: string;

  @IsNumberString()
  rate!: string;

  @IsOptional()
  @IsString()
  rateType?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
