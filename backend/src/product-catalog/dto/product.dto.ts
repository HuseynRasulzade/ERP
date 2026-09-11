import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

const TRACKING_MODES = ['NONE', 'OPTIONAL', 'REQUIRED'];

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
  // Phase 10 — batch/serial capture policy (spec sections 19-23), enforced
  // by BatchSerialService.validateCapture on Goods Receipt/Shipment/Returns.
  @IsOptional() @IsIn(TRACKING_MODES) batchTrackingMode?: string;
  @IsOptional() @IsIn(TRACKING_MODES) serialTrackingMode?: string;
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
  @IsOptional() @IsIn(TRACKING_MODES) batchTrackingMode?: string;
  @IsOptional() @IsIn(TRACKING_MODES) serialTrackingMode?: string;

  @IsInt() @Min(1) expectedVersion!: number;
}
