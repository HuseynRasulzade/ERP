import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// -- Warehouse Transfer -------------------------------------------------------

export class WarehouseTransferLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  sourceLocationId?: string;

  @IsOptional()
  @IsString()
  destinationLocationId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateWarehouseTransferDto {
  @IsString()
  sourceWarehouseId!: string;

  @IsString()
  destinationWarehouseId!: string;

  @IsOptional()
  @IsIn(['INSTANT', 'TWO_STEP', 'INTERNAL_LOCATION_TRANSFER'])
  transferType?: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsDateString()
  expectedArrivalDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WarehouseTransferLineItemDto)
  lines!: WarehouseTransferLineItemDto[];
}

export class ReceiveWarehouseTransferLineDto {
  @IsString()
  lineId!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;
}

export class ReceiveWarehouseTransferDto {
  @IsNumber()
  expectedVersion!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveWarehouseTransferLineDto)
  lines!: ReceiveWarehouseTransferLineDto[];
}

// -- Internal Consumption ------------------------------------------------------

export class InternalConsumptionLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  expenseAccountId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateInternalConsumptionDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsIn(['OFFICE_CONSUMPTION', 'MARKETING', 'MAINTENANCE', 'PROJECT_USE', 'OTHER'])
  operationType?: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalConsumptionLineItemDto)
  lines!: InternalConsumptionLineItemDto[];
}

// -- Inventory Adjustment -------------------------------------------------------

export class InventoryAdjustmentLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'QUARANTINE', 'QUALITY_CONTROL', 'REJECTED', 'DAMAGED', 'BLOCKED', 'EXPIRED'])
  stockStatus?: string;

  @IsOptional()
  @IsNumber()
  costReference?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateInventoryAdjustmentDto {
  @IsString()
  warehouseId!: string;

  @IsIn(['WRITE_OFF', 'SURPLUS', 'OPENING_BALANCE'])
  adjustmentType!: string;

  @IsOptional()
  @IsIn(['DAMAGE', 'EXPIRY', 'LOSS', 'THEFT', 'OBSOLETE', 'QUALITY_FAILURE', 'NATURAL_LOSS', 'MANAGEMENT_DECISION', 'OTHER'])
  reasonCode?: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentLineItemDto)
  lines!: InventoryAdjustmentLineItemDto[];
}

// -- Inventory Status Transfer ---------------------------------------------------

export class InventoryStatusTransferLineItemDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsString()
  fromStockStatus!: string;

  @IsString()
  toStockStatus!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateInventoryStatusTransferDto {
  @IsString()
  warehouseId!: string;

  @IsDateString()
  documentDate!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InventoryStatusTransferLineItemDto)
  lines!: InventoryStatusTransferLineItemDto[];
}
