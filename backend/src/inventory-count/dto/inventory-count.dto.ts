import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ADJUSTMENT_DATE_POLICIES,
  ATTACHMENT_KINDS,
  COSTING_STRICTNESS,
  COUNT_TYPES,
  CUTOFF_MODES,
  DUPLICATE_ENTRY_POLICIES,
  ENTRY_METHODS,
  FINAL_QUANTITY_RULES,
  FREEZE_POLICIES,
  INVESTIGATION_STATUSES,
  LOCATION_MISMATCH_POLICIES,
  RECOUNT_POLICIES,
  REPEATED_SCAN_MODES,
  RESOLUTION_TYPES,
  SCOPE_DIMENSIONS,
  SHORTAGE_COST_POLICIES,
  STALE_POLICIES,
  SURPLUS_COST_POLICIES,
  TEAM_ROLES,
  UNCOUNTED_POLICIES,
} from '../inventory-count.constants';

export class ScopeRuleDto {
  @IsOptional()
  @IsIn(['INCLUDE', 'EXCLUDE'])
  ruleType?: string;

  @IsIn(SCOPE_DIMENSIONS as unknown as string[])
  dimension!: string;

  @IsString()
  valueId!: string;
}

export class TeamMemberDto {
  @IsString()
  userId!: string;

  @IsIn(TEAM_ROLES as unknown as string[])
  role!: string;
}

export class ApprovalThresholdDto {
  @IsOptional()
  @IsNumber()
  upTo?: number | null;

  @IsArray()
  @IsIn(['WAREHOUSE_SUPERVISOR', 'FINANCE', 'DIRECTOR', 'ACCOUNTING'], { each: true })
  stepTypes!: string[];
}

/** Everything configurable on a plan (spec sections 4, 11, 37-43, 61-62). */
export class InventoryCountPlanFieldsDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsDateString() plannedStartAt?: string;
  @IsOptional() @IsDateString() plannedEndAt?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsString() countManagerId?: string;
  @IsOptional() @IsString() comment?: string;

  @IsOptional() @IsBoolean() blindCountEnabled?: boolean;
  @IsOptional() @IsBoolean() fullBlindCount?: boolean;
  @IsOptional() @IsBoolean() blindRecount?: boolean;
  @IsOptional() @IsIn(FREEZE_POLICIES as unknown as string[]) freezePolicy?: string;
  @IsOptional() @IsIn(CUTOFF_MODES as unknown as string[]) cutoffMode?: string;
  @IsOptional() @IsIn(DUPLICATE_ENTRY_POLICIES as unknown as string[]) duplicateEntryPolicy?: string;
  @IsOptional() @IsIn(REPEATED_SCAN_MODES as unknown as string[]) repeatedScanMode?: string;
  @IsOptional() @IsIn(UNCOUNTED_POLICIES as unknown as string[]) uncountedPolicy?: string;
  @IsOptional() @IsBoolean() requireFullCoverage?: boolean;

  @IsOptional() @IsIn(RECOUNT_POLICIES as unknown as string[]) recountPolicy?: string;
  @IsOptional() @IsNumber() @Min(0) recountQuantityThreshold?: number;
  @IsOptional() @IsNumber() @Min(0) recountValueThreshold?: number;
  @IsOptional() @IsNumber() @Min(0) recountPercentThreshold?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) maxRecountAttempts?: number;
  @IsOptional() @IsIn(FINAL_QUANTITY_RULES as unknown as string[]) finalQuantityRule?: string;
  @IsOptional() @IsBoolean() requireIndependentRecount?: boolean;

  @IsOptional() @IsNumber() @Min(0) toleranceQuantity?: number;
  @IsOptional() @IsNumber() @Min(0) tolerancePercent?: number;
  @IsOptional() @IsNumber() @Min(0) toleranceValue?: number;
  @IsOptional() @IsBoolean() autoAcceptWithinTolerance?: boolean;

  @IsOptional() @IsIn(SURPLUS_COST_POLICIES as unknown as string[]) surplusCostPolicy?: string;
  @IsOptional() @IsIn(SHORTAGE_COST_POLICIES as unknown as string[]) shortageCostPolicy?: string;
  @IsOptional() @IsIn(COSTING_STRICTNESS as unknown as string[]) costingStrictness?: string;

  @IsOptional() @IsIn(LOCATION_MISMATCH_POLICIES as unknown as string[]) locationMismatchPolicy?: string;
  @IsOptional() @IsIn(ADJUSTMENT_DATE_POLICIES as unknown as string[]) adjustmentDatePolicy?: string;
  @IsOptional() @IsIn(STALE_POLICIES as unknown as string[]) stalePolicy?: string;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ApprovalThresholdDto) approvalThresholds?: ApprovalThresholdDto[];
  @IsOptional() @IsNumber() @Min(0) criticalShortageValue?: number;
  @IsOptional() @IsBoolean() forbidCounterApproval?: boolean;
  @IsOptional() @IsBoolean() forbidWarehouseKeeperSelfApproval?: boolean;
  @IsOptional() @IsString() varianceApprovalPolicyId?: string;

  @IsOptional() @IsInt() financialYear?: number;
  @IsOptional() @IsBoolean() yearEndCount?: boolean;
  @IsOptional() @IsBoolean() mandatoryCloseDependency?: boolean;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ScopeRuleDto) scope?: ScopeRuleDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TeamMemberDto) team?: TeamMemberDto[];
}

export class CreateInventoryCountPlanDto extends InventoryCountPlanFieldsDto {
  @IsIn(COUNT_TYPES as unknown as string[])
  countType!: string;

  @IsDateString()
  planDate!: string;
}

export class UpdateInventoryCountPlanDto extends InventoryCountPlanFieldsDto {
  @IsInt()
  expectedVersion!: number;

  @IsOptional() @IsIn(COUNT_TYPES as unknown as string[]) countType?: string;
  @IsOptional() @IsDateString() planDate?: string;
  @IsOptional() @IsString() scopeChangeReason?: string;
}

export class SnapshotDto {
  @IsOptional() @IsBoolean() restart?: boolean;
  @IsOptional() @IsString() reason?: string;
}

export class ReasonDto {
  @IsOptional() @IsString() reason?: string;
}

export class CommentDto {
  @IsOptional() @IsString() comment?: string;
}

export class GenerateSheetsDto {
  @IsOptional() @IsBoolean() splitByLocation?: boolean;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsIn(REPEATED_SCAN_MODES as unknown as string[]) barcodeMode?: string;
}

export class CreateTaskDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() assignedUserId?: string;
}

export class CountEntryItemDto {
  @IsString() sheetId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() productCode?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() characteristicId?: string;
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsString() serialId?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsIn(['OWN', 'SUPPLIER_CONSIGNMENT', 'CUSTOMER_OWNED']) ownershipType?: string;
  @IsOptional() @IsString() ownerCounterpartyId?: string;
  @IsOptional() @IsString() stockStatus?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsOptional() @IsIn(ENTRY_METHODS as unknown as string[]) entryMethod?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() evidenceAttachmentId?: string;
  @IsOptional() @IsString() clientEntryId?: string;
  @IsOptional() @IsDateString() countedAt?: string;
  @IsOptional() @IsString() unknownItemDescription?: string;
}

export class RecordEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CountEntryItemDto)
  entries!: CountEntryItemDto[];
}

export class ScanDto {
  @IsString() sheetId!: string;
  @IsString() barcode!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() stockStatus?: string;
  @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() clientEntryId?: string;
}

export class ImportEntriesDto {
  @IsString() sheetId!: string;
  @IsString() csv!: string;
}

export class UpdateEntryDto {
  @IsNumber() @Min(0) quantity!: number;
  @IsString() reason!: string;
}

export class ReviewUnknownItemDto {
  @IsIn(['ACCEPT', 'REJECT'])
  action!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() comment?: string;
}

export class RequestRecountDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  varianceIds!: string[];
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() assignedUserId?: string;
}

export class CompleteRecountDto {
  @IsNumber() @Min(0) physicalQuantity!: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateVarianceDto {
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsIn(INVESTIGATION_STATUSES as unknown as string[]) investigationStatus?: string;
  @IsOptional() @IsString() investigationNotes?: string;
  @IsOptional() @IsIn(RESOLUTION_TYPES as unknown as string[]) resolutionType?: string;
  @IsOptional() @IsNumber() @Min(0) finalPhysicalQty?: number;
  @IsOptional() @IsNumber() @Min(0) approvedCost?: number;
  @IsOptional() @IsString() responsibleEmployeeId?: string;
  @IsOptional() @IsNumber() @Min(0) recoverableAmount?: number;
  @IsOptional() @IsString() comment?: string;
}

export class CreateAdjustmentsDto {
  @IsOptional() @IsDateString() adjustmentDate?: string;
}

export class AddAttachmentDto {
  @IsIn(ATTACHMENT_KINDS as unknown as string[]) kind!: string;
  @IsString() fileName!: string;
  @IsOptional() @IsString() storageKey?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() varianceId?: string;
}

export class CreateReasonCodeDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
}
