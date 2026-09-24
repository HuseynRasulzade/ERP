import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

const REASONS = ['LATE_INVOICE_DIFFERENCE', 'SUPPLIER_PRICE_CORRECTION', 'LANDED_COST_CORRECTION', 'MANUAL', 'MIGRATION_CORRECTION'];

export class CreateInventoryCostAdjustmentLineDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  sourceReceiptLineId?: string;

  @IsNumber()
  amount!: number;
}

export class CreateInventoryCostAdjustmentDto {
  @IsString()
  documentDate!: string;

  @IsIn(REASONS)
  reason!: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInventoryCostAdjustmentLineDto)
  lines!: CreateInventoryCostAdjustmentLineDto[];
}
