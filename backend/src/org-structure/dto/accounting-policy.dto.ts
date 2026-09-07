import { IsDateString, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateAccountingPolicyDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() inventoryCostingMethod?: string;
  @IsOptional() @IsString() baseCurrencyId?: string;
  @IsOptional() @IsString() taxProfileId?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class UpdateAccountingPolicyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() inventoryCostingMethod?: string;
  @IsOptional() @IsString() baseCurrencyId?: string;
  @IsOptional() @IsString() taxProfileId?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;

  @IsInt() @Min(1) expectedVersion!: number;
}
