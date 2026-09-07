import { IsDateString, IsOptional, IsString } from 'class-validator';

export class SetTenantSettingDto {
  @IsString()
  key!: string;

  value!: unknown;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}
