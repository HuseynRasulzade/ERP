import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9-]{2,32}$/, { message: 'code must be lowercase alphanumeric/hyphen, 2-32 chars' })
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  baseCurrencyCode?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  locale?: string;
}
