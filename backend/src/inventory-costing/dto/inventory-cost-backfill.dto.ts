import { IsOptional, IsString } from 'class-validator';

export class InventoryCostBackfillDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;
}
