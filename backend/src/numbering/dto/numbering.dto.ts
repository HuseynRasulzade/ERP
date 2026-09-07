import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateNumberSequenceDto {
  @IsString()
  code!: string;

  @IsString()
  documentType!: string;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  padding?: number;

  @IsOptional()
  @IsIn(['NEVER', 'YEARLY', 'MONTHLY'])
  resetPolicy?: 'NEVER' | 'YEARLY' | 'MONTHLY';
}
