import { IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateTaxProfileDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsBoolean() vatRegistered?: boolean;
  @IsOptional() @IsDateString() vatRegistrationDate?: string;
  @IsOptional() @IsDateString() vatDeregistrationDate?: string;
  @IsOptional() @IsString() taxRegimeCode?: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateTaxProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsBoolean() vatRegistered?: boolean;
  @IsOptional() @IsDateString() vatRegistrationDate?: string;
  @IsOptional() @IsDateString() vatDeregistrationDate?: string;
  @IsOptional() @IsString() taxRegimeCode?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;

  @IsInt() @Min(1) expectedVersion!: number;
}
