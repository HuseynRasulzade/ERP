import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';

export class CreateBOMDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() organizationId?: string;
}

export class BOMLineDto {
  @IsString() componentProductId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsString() unitId!: string;
  @IsOptional() @IsNumber() scrapFactor?: number;
  @IsOptional() @IsBoolean() fixedQuantity?: boolean;
  @IsOptional() @IsString() substitutionGroup?: string;
  @IsOptional() @IsInt() operationSequence?: number;
  @IsOptional() @IsIn(['MATERIAL', 'SEMI_FINISHED', 'PACKAGING', 'CONSUMABLE', 'SERVICE', 'PHANTOM', 'BY_PRODUCT_REFERENCE']) consumptionType?: string;
  @IsOptional() @IsInt() sequence?: number;
}

export class CreateBOMVersionDto {
  @IsString() outputProductId!: string;
  @IsString() versionCode!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsNumber() @IsPositive() baseOutputQuantity?: number;
  @IsString() baseUnitId!: string;
  @IsOptional() @IsString() productionType?: string;
  @IsOptional() @IsNumber() yieldPercentage?: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BOMLineDto) lines!: BOMLineDto[];
}

export class CreateWorkCenterDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() groupCode?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsNumber() capacityHoursPerDay?: number;
  @IsOptional() @IsNumber() hourlyMachineRate?: number;
}

export class CreateRoutingDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() organizationId?: string;
}

export class RoutingOperationDto {
  @IsString() operationCode!: string;
  @IsString() name!: string;
  @IsInt() sequence!: number;
  @IsString() workCenterId!: string;
  @IsOptional() @IsNumber() setupTimeMinutes?: number;
  @IsOptional() @IsNumber() runTimePerUnitMinutes?: number;
  @IsOptional() @IsNumber() laborStandardHours?: number;
  @IsOptional() @IsNumber() machineStandardHours?: number;
  @IsOptional() @IsBoolean() subcontracted?: boolean;
  @IsOptional() @IsBoolean() backflushMaterials?: boolean;
}

export class CreateRoutingVersionDto {
  @IsString() outputProductId!: string;
  @IsString() versionCode!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsNumber() baseQuantity?: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RoutingOperationDto) operations!: RoutingOperationDto[];
}

export class ByProductDto {
  @IsString() productId!: string;
  @IsNumber() @IsPositive() plannedQuantity!: number;
  @IsString() unitId!: string;
  @IsIn(['CO_PRODUCT', 'BY_PRODUCT']) outputType!: string;
  @IsOptional() @IsString() costAllocationMethod?: string;
  @IsOptional() @IsNumber() allocationWeight?: number;
}

export class CreateProductionOrderDto {
  @IsISO8601() documentDate!: string;
  @IsOptional() @IsISO8601() productionStartDate?: string;
  @IsOptional() @IsISO8601() plannedEndDate?: string;
  @IsOptional() @IsString() productionType?: string;
  @IsString() outputWarehouseId!: string;
  @IsOptional() @IsString() bomVersionId?: string;
  @IsString() outputProductId!: string;
  @IsOptional() @IsString() routingVersionId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsNumber() @IsPositive() plannedOutputQuantity!: number;
  @IsString() outputUnitId!: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ByProductDto) byProducts?: ByProductDto[];
}

export class MaterialIssueLineDto {
  @IsOptional() @IsString() requirementId?: string;
  @IsString() productId!: string;
  @IsString() unitId!: string;
  @IsOptional() @IsString() batchId?: string;
  @IsNumber() @IsPositive() quantity!: number;
}

export class CreateMaterialIssueDto {
  @IsString() productionOrderId!: string;
  @IsISO8601() documentDate!: string;
  @IsOptional() @IsIn(['ISSUE', 'RETURN']) issueType?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MaterialIssueLineDto) lines!: MaterialIssueLineDto[];
}

export class RecordExecutionDto {
  @IsString() productionOrderId!: string;
  @IsOptional() @IsString() routingOperationId?: string;
  @IsString() workCenterId!: string;
  @IsISO8601() executionDate!: string;
  @IsOptional() @IsNumber() goodQuantity?: number;
  @IsOptional() @IsNumber() scrapQuantity?: number;
  @IsOptional() @IsNumber() reworkQuantity?: number;
  @IsOptional() @IsNumber() laborHours?: number;
  @IsOptional() @IsNumber() machineHours?: number;
  @IsOptional() @IsIn(['NOT_STARTED', 'STARTED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED']) status?: string;
}

export class RecordLaborDto {
  @IsString() productionOrderId!: string;
  @IsOptional() @IsString() routingOperationId?: string;
  @IsOptional() @IsString() employmentId?: string;
  @IsISO8601() workDate!: string;
  @IsNumber() @IsPositive() hours!: number;
  @IsNumber() @IsPositive() hourlyRate!: number;
  @IsOptional() @IsIn(['STANDARD_PROVISIONAL', 'ACTUAL_PAYROLL_COST', 'HYBRID']) costMethod?: string;
}

export class RecordMachineTimeDto {
  @IsString() productionOrderId!: string;
  @IsOptional() @IsString() routingOperationId?: string;
  @IsString() workCenterId!: string;
  @IsISO8601() workDate!: string;
  @IsNumber() @IsPositive() hours!: number;
  @IsOptional() @IsNumber() rate?: number;
}

export class RecordScrapDto {
  @IsString() productionOrderId!: string;
  @IsOptional() @IsString() operationExecutionId?: string;
  @IsString() productId!: string;
  @IsIn(['NORMAL_PROCESS_SCRAP', 'ABNORMAL_SCRAP', 'REUSABLE_SCRAP', 'DEFECT', 'SPOILAGE', 'REWORK']) scrapType!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsString() unitId!: string;
  @IsOptional() @IsIn(['ZERO', 'REFERENCE_VALUE', 'RECOVERABLE_VALUE', 'REDUCE_WIP_COST']) valuationPolicy?: string;
  @IsOptional() @IsNumber() referenceValue?: number;
  @IsISO8601() recordDate!: string;
}

export class CreateOutputReceiptDto {
  @IsString() productionOrderId!: string;
  @IsString() outputId!: string;
  @IsOptional() @IsIn(['FINISHED', 'SEMI_FINISHED']) outputKind?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() batchId?: string;
  @IsNumber() @IsPositive() goodQuantity!: number;
  @IsOptional() @IsIn(['ACCEPTED', 'QUARANTINE', 'REJECTED', 'REWORK']) qualityStatus?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateOverheadPoolDto {
  @IsISO8601() period!: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() workCenterGroupCode?: string;
  @IsOptional() @IsString() costType?: string;
  @IsNumber() @IsPositive() amount!: number;
  @IsOptional() @IsIn(['DIRECT_LABOR_HOURS', 'MACHINE_HOURS', 'DIRECT_MATERIAL_COST', 'UNITS_PRODUCED']) driverType?: string;
}

export class CloseProductionOrderDto {
  @IsOptional() @IsBoolean() force?: boolean;
}
