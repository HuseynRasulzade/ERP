import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateInventoryCountScopeDto {
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsBoolean() includeSubtree?: boolean;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() productGroupId?: string;
  @IsOptional() @IsString() productCategoryId?: string;
  @IsOptional() @IsString() characteristicId?: string;
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsString() serialId?: string;
  @IsOptional() @IsString() ownershipType?: string;
  @IsOptional() @IsString() qualityStatus?: string;
  @IsOptional() @IsIn(['INCLUDE', 'EXCLUDE']) rule?: string;
}

export class CreateInventoryCountPlanDto {
  @IsISO8601() planDate!: string;
  @IsOptional() @IsISO8601() plannedStartAt?: string;
  @IsOptional() @IsISO8601() plannedEndAt?: string;
  @IsOptional() @IsIn(['FULL', 'PARTIAL', 'CYCLE', 'ANNUAL', 'AD_HOC', 'INVESTIGATION', 'RECOUNT']) countType?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsString() countManagerId?: string;
  @IsOptional() @IsBoolean() blindCountEnabled?: boolean;
  @IsOptional() @IsIn(['HARD_FREEZE', 'SOFT_FREEZE', 'NO_FREEZE_WITH_MOVEMENT_TRACKING']) freezePolicy?: string;
  @IsOptional() @IsIn(['NO_RECOUNT', 'RECOUNT_ALL_VARIANCES', 'RECOUNT_ABOVE_QUANTITY_THRESHOLD', 'RECOUNT_ABOVE_VALUE_THRESHOLD', 'RECOUNT_PERCENTAGE', 'MANUAL_SELECTION']) recountPolicy?: string;
  @IsOptional() @IsNumber() recountQuantityThreshold?: number;
  @IsOptional() @IsNumber() recountValueThreshold?: number;
  @IsOptional() @IsNumber() recountPercentageThreshold?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateInventoryCountScopeDto) scopes?: CreateInventoryCountScopeDto[];
}

export class StartSessionDto {
  @IsOptional() @IsString() cutoffMode?: string;
  @IsOptional() @IsBoolean() fullBlindCount?: boolean;
  @IsOptional() @IsString() teamMembersJson?: string;
}

export class RecordCountEntryDto {
  @IsString() sheetId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() locationId?: string;
  @IsString() productId!: string;
  @IsOptional() @IsString() characteristicId?: string;
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsString() serialId?: string;
  @IsString() unitId!: string;
  @IsNumber() countedQuantity!: number;
  @IsOptional() @IsNumber() unitConversionFactor?: number; // e.g. 1 box = 12 pieces (spec section 22)
  @IsOptional() @IsIn(['MANUAL', 'BARCODE', 'IMPORT', 'MOBILE', 'API', 'SYSTEM_RECOUNT']) entryMethod?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() evidenceAttachmentId?: string;
  @IsOptional() @IsString() clientEntryId?: string;
  @IsOptional() @IsString() supersedesEntryId?: string;
  @IsOptional() @IsString() supersededReason?: string;
}

export class CreateRecountDto {
  @IsOptional() @IsString() varianceId?: string;
  @IsOptional() @IsString() originalEntryId?: string;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() reason?: string;
}

export class CompleteRecountDto {
  @IsNumber() physicalQuantity!: number;
}

export class VarianceDecisionDto {
  @IsNumber() finalPhysicalQty!: number;
  @IsIn(['ADJUST_STOCK', 'LOCATION_TRANSFER', 'STATUS_TRANSFER', 'BATCH_CORRECTION', 'SERIAL_CORRECTION', 'NO_ADJUSTMENT', 'SOURCE_DOCUMENT_CORRECTION', 'WRITE_OFF', 'SURPLUS_RECOGNITION'])
  resolutionType!: string;
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsNumber() approvedCost?: number;
  @IsOptional() @IsString() responsibleEmployeeId?: string;
  @IsOptional() @IsNumber() recoverableAmount?: number;
  @IsOptional() @IsString() comment?: string;
}
