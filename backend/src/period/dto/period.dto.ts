import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePeriodDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsInt()
  @Min(2000)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class ReopenPeriodDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreatePeriodReopenRequestDto {
  @IsString()
  periodId!: string;

  @IsString()
  reason!: string;
}

export class DecidePeriodReopenRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
