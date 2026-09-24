import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const COSTING_METHODS = ['FIFO', 'WEIGHTED_AVERAGE'];
const AVERAGE_METHODS = ['MOVING_AVERAGE', 'PERIODIC_WEIGHTED_AVERAGE'];
const NEGATIVE_STOCK_POLICIES = ['LAST_KNOWN_COST', 'CURRENT_AVERAGE', 'STANDARD_COST', 'ZERO_PENDING', 'BLOCK_COSTING'];

export class UpsertInventoryCostingPolicyDto {
  @IsString()
  effectiveFrom!: string;

  @IsOptional()
  @IsIn(COSTING_METHODS)
  costingMethod?: 'FIFO' | 'WEIGHTED_AVERAGE';

  @IsOptional()
  @IsIn(AVERAGE_METHODS)
  averageMethod?: 'MOVING_AVERAGE' | 'PERIODIC_WEIGHTED_AVERAGE';

  @IsOptional()
  @IsString()
  valuationCurrencyId?: string;

  @IsOptional()
  @IsBoolean()
  includePurchaseAdditionalCosts?: boolean;

  @IsOptional()
  @IsBoolean()
  includeCustomsCost?: boolean;

  @IsOptional()
  @IsBoolean()
  includeFreight?: boolean;

  @IsOptional()
  @IsBoolean()
  allowProvisionalCost?: boolean;

  @IsOptional()
  @IsBoolean()
  allowNegativeQuantityCosting?: boolean;

  @IsOptional()
  @IsIn(NEGATIVE_STOCK_POLICIES)
  negativeStockCostPolicy?: 'LAST_KNOWN_COST' | 'CURRENT_AVERAGE' | 'STANDARD_COST' | 'ZERO_PENDING' | 'BLOCK_COSTING';

  @IsOptional()
  @IsBoolean()
  recalculateBackdatedDocuments?: boolean;

  @IsOptional()
  @IsBoolean()
  costByWarehouse?: boolean;

  @IsOptional()
  @IsBoolean()
  costByCharacteristic?: boolean;

  @IsOptional()
  @IsBoolean()
  costByBatch?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  roundingPrecision?: number;

  @IsOptional()
  @IsBoolean()
  consignmentIncludedInValuation?: boolean;
}
