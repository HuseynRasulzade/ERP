import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateUnitConversionDto {
  @IsString() fromUnitId!: string;
  @IsString() toUnitId!: string;
  @IsNumber() factor!: number;
  @IsOptional() @IsString() description?: string;
}

export class UpdateUnitConversionDto {
  @IsOptional() @IsNumber() factor?: number;
  @IsOptional() @IsString() description?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
