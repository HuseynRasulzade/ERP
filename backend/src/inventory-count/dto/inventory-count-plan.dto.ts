import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

const COUNT_TYPES = ['FULL', 'PARTIAL', 'CYCLE', 'ANNUAL', 'AD_HOC', 'INVESTIGATION', 'RECOUNT'];
const FREEZE_POLICIES = ['HARD_FREEZE', 'SOFT_FREEZE', 'NO_FREEZE_WITH_MOVEMENT_TRACKING'];
const CUTOFF_MODES = ['GLOBAL_SNAPSHOT_CUTOFF', 'TASK_COMPLETION_CUTOFF', 'LOCATION_COUNT_TIMESTAMP'];
const RECOUNT_POLICIES = ['RECOUNT_ABOVE_VALUE_THRESHOLD', 'RECOUNT_ABOVE_QUANTITY_THRESHOLD', 'RECOUNT_ABOVE_PERCENTAGE_THRESHOLD', 'ALWAYS_RECOUNT', 'NEVER_RECOUNT'];
const SURPLUS_COST_POLICIES = ['CURRENT_AVERAGE', 'LATEST_PURCHASE', 'MANUAL', 'ZERO_PENDING'];
const INCLUDE_EXCLUDE = ['INCLUDE', 'EXCLUDE'];

export class CreateInventoryCountScopeDto {
  @IsOptional()
  @IsIn(INCLUDE_EXCLUDE)
  includeExclude?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsBoolean()
  locationSubtree?: boolean;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  productGroupId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  serialId?: string;

  @IsOptional()
  @IsString()
  ownershipType?: string;

  @IsOptional()
  @IsString()
  qualityStatus?: string;
}

export class CreateInventoryCountPlanDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  planDate!: string;

  @IsOptional()
  @IsString()
  plannedStartAt?: string;

  @IsOptional()
  @IsString()
  plannedEndAt?: string;

  @IsOptional()
  @IsIn(COUNT_TYPES)
  countType?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  responsibleUserId?: string;

  @IsOptional()
  @IsString()
  countManagerId?: string;

  @IsOptional()
  @IsBoolean()
  blindCountEnabled?: boolean;

  @IsOptional()
  @IsIn(FREEZE_POLICIES)
  freezePolicy?: string;

  @IsOptional()
  @IsIn(CUTOFF_MODES)
  cutoffMode?: string;

  @IsOptional()
  @IsIn(RECOUNT_POLICIES)
  recountPolicy?: string;

  @IsOptional()
  @IsNumber()
  recountQuantityThreshold?: number;

  @IsOptional()
  @IsNumber()
  recountValueThreshold?: number;

  @IsOptional()
  @IsNumber()
  recountPercentageThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxRecountAttempts?: number;

  @IsOptional()
  @IsNumber()
  varianceQuantityTolerance?: number;

  @IsOptional()
  @IsNumber()
  varianceValueTolerance?: number;

  @IsOptional()
  @IsNumber()
  variancePercentageTolerance?: number;

  @IsOptional()
  @IsIn(SURPLUS_COST_POLICIES)
  surplusCostPolicy?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInventoryCountScopeDto)
  scopes?: CreateInventoryCountScopeDto[];
}
