import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsString() productType!: string; // GOODS | SERVICE | WORK | SET
  @IsString() baseUnitId!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsString() weightUnitId?: string;
  @IsOptional() @IsNumber() volume?: number;
  @IsOptional() @IsString() volumeUnitId?: string;
  @IsOptional() @IsBoolean() trackInventory?: boolean;
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() productType?: string;
  @IsOptional() @IsString() baseUnitId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsString() weightUnitId?: string;
  @IsOptional() @IsNumber() volume?: number;
  @IsOptional() @IsString() volumeUnitId?: string;
  @IsOptional() @IsBoolean() trackInventory?: boolean;
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;

  @IsInt() @Min(1) expectedVersion!: number;
}
