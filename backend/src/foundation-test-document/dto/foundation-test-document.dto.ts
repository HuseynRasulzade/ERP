import { IsDateString, IsInt, IsNumberString, IsOptional, IsString, Min } from 'class-validator';

export class CreateFoundationTestDocumentDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateFoundationTestDocumentDto {
  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
