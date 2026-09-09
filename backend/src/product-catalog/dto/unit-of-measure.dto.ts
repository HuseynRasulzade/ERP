import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateUnitOfMeasureDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() symbol?: string;
  @IsOptional() @IsString() unitType?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateUnitOfMeasureDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() symbol?: string;
  @IsOptional() @IsString() unitType?: string;
  @IsOptional() @IsString() description?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
