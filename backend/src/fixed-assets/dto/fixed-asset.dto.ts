import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateFixedAssetCategoryDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsInt() defaultUsefulLifeMonths?: number;
  @IsOptional() @IsString() defaultDepreciationMethod?: string;
  @IsOptional() @IsNumber() defaultResidualValue?: number;
  @IsOptional() @IsNumber() capitalizationThreshold?: number;
  @IsOptional() @IsString() accountingMappingProfile?: string;
  @IsOptional() @IsString() taxCategory?: string;
  @IsOptional() @IsBoolean() componentizationAllowed?: boolean;
  @IsOptional() @IsIn(['COST_MODEL', 'REVALUATION_MODEL']) revaluationModel?: string;
}

export class ClassifyCandidateDto {
  @IsIn(['CAPITALIZABLE', 'EXPENSE', 'ASSIGNED_TO_CIP', 'ASSIGNED_TO_ASSET', 'CANCELLED']) decision!: 'CAPITALIZABLE' | 'EXPENSE' | 'ASSIGNED_TO_CIP' | 'ASSIGNED_TO_ASSET' | 'CANCELLED';
  @IsOptional() @IsNumber() capitalizableAmount?: number;
  @IsOptional() @IsString() assignedCipProjectId?: string;
  @IsOptional() @IsString() assignedAssetId?: string;
}

export class CreateCipProjectDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() projectType?: string;
  @IsISO8601() startDate!: string;
  @IsOptional() @IsISO8601() plannedCompletionDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsString() currencyId!: string;
  @IsOptional() @IsInt() targetAssetCount?: number;
  @IsOptional() @IsString() comment?: string;
}

export class AddCipCostLineDto {
  @IsString() costComponent!: string;
  @IsString() sourceDocumentType!: string;
  @IsString() sourceDocumentId!: string;
  @IsOptional() @IsString() candidateId?: string;
  @IsString() currencyId!: string;
  @IsNumber() amount!: number;
  @IsNumber() baseAmount!: number;
  @IsOptional() @IsBoolean() capitalizable?: boolean;
  @IsISO8601() effectiveDate!: string;
}

export class CapitalizeFixedAssetDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsString() cipProjectId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) costLineIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) candidateIds?: string[];
  @IsOptional() @IsNumber() directAmount?: number;
  @IsString() currencyId!: string;
  @IsISO8601() acquisitionDate!: string;
  @IsISO8601() documentDate!: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsInt() usefulLifeMonths?: number;
  @IsOptional() @IsString() depreciationMethod?: string;
  @IsOptional() @IsNumber() residualValue?: number;
}

export class CommissionFixedAssetDto {
  @IsISO8601() commissioningDate!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsInt() @IsPositive() usefulLifeMonths!: number;
  @IsOptional() @IsString() depreciationMethod?: string;
  @IsOptional() @IsNumber() residualValue?: number;
  @IsOptional() @IsIn(['FROM_COMMISSIONING_DATE', 'NEXT_DAY', 'NEXT_MONTH', 'FIRST_DAY_NEXT_MONTH']) depreciationStartRule?: string;
}

export class CreateFixedAssetTransferDto {
  @IsString() assetId!: string;
  @IsOptional() @IsString() toDepartmentId?: string;
  @IsOptional() @IsString() toLocationId?: string;
  @IsOptional() @IsString() toResponsiblePersonId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateFixedAssetModernizationDto {
  @IsString() assetId!: string;
  @IsOptional() @IsIn(['CAPITAL_IMPROVEMENT', 'RECONSTRUCTION', 'UPGRADE']) modernizationType?: string;
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
  @IsString() currencyId!: string;
  @IsNumber() @IsPositive() amount!: number;
  @IsOptional() @IsInt() newUsefulLifeMonths?: number;
  @IsOptional() @IsNumber() newResidualValue?: number;
  @IsOptional() @IsString() description?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateFixedAssetImpairmentDto {
  @IsString() assetId!: string;
  @IsNumber() recoverableAmount!: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() valuationSource?: string;
  @IsOptional() @IsBoolean() reversal?: boolean;
  @IsISO8601() documentDate!: string;
}

export class CreateFixedAssetRevaluationDto {
  @IsString() assetId!: string;
  @IsNumber() revaluedAmount!: number;
  @IsOptional() @IsString() valuationSource?: string;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() documentDate!: string;
}

export class SuspendFixedAssetDto {
  @IsString() assetId!: string;
  @IsISO8601() startDate!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsIn(['CONTINUE_DEPRECIATION', 'PAUSE_DEPRECIATION']) depreciationPolicy?: string;
}

export class CreateFixedAssetDisposalDto {
  @IsString() assetId!: string;
  @IsIn(['SALE', 'WRITE_OFF', 'SCRAP', 'DONATION', 'LOSS', 'THEFT', 'TRANSFER_OUT', 'PARTIAL_DISPOSAL', 'COMPONENT_REPLACEMENT']) disposalType!: string;
  @IsOptional() @IsNumber() disposalShare?: number;
  @IsOptional() @IsNumber() proceeds?: number;
  @IsOptional() @IsString() buyerCounterpartyId?: string;
  @IsOptional() @IsString() salesInvoiceId?: string;
  @IsOptional() @IsNumber() disposalCosts?: number;
  @IsString() currencyId!: string;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() documentDate!: string;
}

export class StartInventoryCountDto {
  @IsISO8601() countDate!: string;
  @IsOptional() @IsString() scopeDepartmentId?: string;
  @IsOptional() @IsString() scopeCategoryId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class RecordInventoryLineDto {
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() expectedLocationId?: string;
  @IsOptional() @IsString() foundLocationId?: string;
  @IsOptional() @IsString() expectedResponsiblePersonId?: string;
  @IsOptional() @IsString() foundResponsiblePersonId?: string;
  @IsIn(['FOUND', 'MISSING', 'WRONG_LOCATION', 'WRONG_RESPONSIBLE_PERSON', 'DAMAGED', 'UNREGISTERED_ASSET']) result!: string;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() notes?: string;
}

export class MigrateOpeningBalanceDto {
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsString() currencyId!: string;
  @IsISO8601() openingDate!: string;
  @IsNumber() @IsPositive() originalCost!: number;
  @IsOptional() @IsNumber() accumulatedDepreciation?: number;
  @IsOptional() @IsNumber() impairment?: number;
  @IsOptional() @IsNumber() revaluation?: number;
  @IsOptional() @IsInt() remainingUsefulLifeMonths?: number;
  @IsOptional() @IsInt() usefulLifeMonths?: number;
  @IsOptional() @IsString() depreciationMethod?: string;
  @IsOptional() @IsNumber() residualValue?: number;
  @IsOptional() @IsISO8601() commissioningDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() serialNumber?: string;
}
