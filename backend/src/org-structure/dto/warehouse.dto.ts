import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() warehouseType?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() warehouseType?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;

  @IsInt() @Min(1) expectedVersion!: number;
}
