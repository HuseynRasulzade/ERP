import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateInventoryCostingPolicyDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsIn(['FIFO', 'WEIGHTED_AVERAGE'])
  costingMethod!: string;

  @IsOptional()
  @IsIn(['MOVING_AVERAGE', 'PERIODIC_WEIGHTED_AVERAGE'])
  averageMethod?: string;

  @IsOptional()
  @IsString()
  valuationCurrencyId?: string;

  @IsOptional()
  @IsBoolean()
  costByWarehouse?: boolean;

  @IsOptional()
  @IsBoolean()
  costByBatch?: boolean;

  @IsOptional()
  @IsBoolean()
  allowNegativeQuantityCosting?: boolean;

  @IsOptional()
  @IsIn(['LAST_KNOWN_COST', 'CURRENT_AVERAGE', 'STANDARD_COST', 'ZERO_PENDING', 'BLOCK_COSTING'])
  negativeStockCostPolicy?: string;

  @IsOptional()
  @IsBoolean()
  allowMidPeriodChange?: boolean;
}

export class CreateInventoryCostAdjustmentLineDto {
  @IsString()
  productId!: string;

  @IsString()
  costingKey!: string;

  @IsOptional()
  @IsString()
  costLayerId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsNumber()
  quantityReference?: number;

  @IsOptional()
  @IsNumber()
  oldUnitCost?: number;

  @IsNumber()
  adjustmentAmount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInventoryCostAdjustmentDto {
  @IsISO8601()
  documentDate!: string;

  @IsIn(['LATE_INVOICE_DIFFERENCE', 'SUPPLIER_PRICE_CORRECTION', 'LANDED_COST_CORRECTION', 'MANUAL_AUTHORIZED', 'MIGRATION_CORRECTION', 'SYSTEM_RECALCULATION'])
  reason!: string;

  @IsOptional()
  @IsString()
  sourceDocumentType?: string;

  @IsOptional()
  @IsString()
  sourceDocumentId?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInventoryCostAdjustmentLineDto)
  lines!: CreateInventoryCostAdjustmentLineDto[];
}

export class RecalculationRequestDto {
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class FinalizePeriodDto {
  @IsString()
  period!: string; // YYYY-MM
}

export class ReopenPeriodDto {
  @IsString()
  period!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
