import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BOOK_CODES, COST_COMPONENTS, DepreciationMethod, DepreciationStartRule, DisposalType, ExpenseType, PartialDisposalMethod, PartialPeriodRule } from '../fixed-assets.constants';

const METHODS = Object.values(DepreciationMethod);
const START_RULES = Object.values(DepreciationStartRule);
const PARTIAL_RULES = Object.values(PartialPeriodRule);
const EXPENSE_TYPES = Object.values(ExpenseType);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// -- Settings -----------------------------------------------------------------

export class CreateFixedAssetCategoryDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsInt() @Min(1) defaultUsefulLifeMonths?: number;
  @IsOptional() @IsIn(METHODS) defaultDepreciationMethod?: string;
  @IsOptional() @IsNumber() @Min(0) defaultResidualValue?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) defaultResidualPercent?: number;
  @IsOptional() @IsNumber() @Min(0) capitalizationThreshold?: number;
  @IsOptional() @IsString() accountingMappingProfile?: string;
  @IsOptional() @IsString() taxCategory?: string;
  @IsOptional() @IsBoolean() componentizationAllowed?: boolean;
  @IsOptional() @IsIn(['COST_MODEL', 'REVALUATION_MODEL']) revaluationModel?: string;
  @IsOptional() @IsIn(['INDIVIDUAL_ASSET', 'GROUP_ASSET', 'COMPONENT_ASSET']) groupingPolicy?: string;
  @IsOptional() @IsIn(EXPENSE_TYPES) defaultExpenseType?: string;
  @IsOptional() @IsIn(START_RULES) defaultDepreciationStartRule?: string;
  @IsOptional() @IsIn(PARTIAL_RULES) defaultPartialPeriodRule?: string;
}

export class UpdateFixedAssetCategoryDto {
  @IsInt() expectedVersion!: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(1) defaultUsefulLifeMonths?: number;
  @IsOptional() @IsIn(METHODS) defaultDepreciationMethod?: string;
  @IsOptional() @IsNumber() @Min(0) defaultResidualValue?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) defaultResidualPercent?: number;
  @IsOptional() @IsNumber() @Min(0) capitalizationThreshold?: number;
  @IsOptional() @IsString() accountingMappingProfile?: string;
  @IsOptional() @IsString() taxCategory?: string;
  @IsOptional() @IsBoolean() componentizationAllowed?: boolean;
  @IsOptional() @IsIn(['COST_MODEL', 'REVALUATION_MODEL']) revaluationModel?: string;
  @IsOptional() @IsIn(['INDIVIDUAL_ASSET', 'GROUP_ASSET', 'COMPONENT_ASSET']) groupingPolicy?: string;
  @IsOptional() @IsIn(EXPENSE_TYPES) defaultExpenseType?: string;
  @IsOptional() @IsIn(START_RULES) defaultDepreciationStartRule?: string;
  @IsOptional() @IsIn(PARTIAL_RULES) defaultPartialPeriodRule?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateFixedAssetPolicyDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(BOOK_CODES) bookCode?: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsNumber() @Min(0) minCapitalizationThreshold?: number;
  @IsOptional() @IsInt() @Min(0) minUsefulLifeMonths?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) nonCapitalizableCostComponents?: string[];
  @IsOptional() @IsIn(START_RULES) depreciationStartRule?: string;
  @IsOptional() @IsIn(PARTIAL_RULES) partialPeriodRule?: string;
  @IsOptional() @IsInt() @Min(0) @Max(6) roundingPrecision?: number;
  @IsOptional() @IsIn(['CONTINUE_DEPRECIATION', 'PAUSE_DEPRECIATION', 'LOCALIZATION_RULE']) suspensionDepreciationPolicy?: string;
  @IsOptional() @IsBoolean() heldForSaleDepreciates?: boolean;
  @IsOptional() @IsBoolean() modernizationDepreciates?: boolean;
  @IsOptional() @IsIn(['PERIOD_END_ASSIGNMENT', 'PERIOD_START_ASSIGNMENT']) transferExpenseRule?: string;
  @IsOptional() @IsBoolean() impairmentReversalAllowed?: boolean;
  @IsOptional() @IsBoolean() requirePriorPeriodDepreciationForDisposal?: boolean;
}

export class CreateFixedAssetLocationDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() branchId?: string;
}

// -- Acquisition candidates ---------------------------------------------------

export class CreateManualCandidateDto {
  @IsString() description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() sourceDate!: string;
  @IsString() offsetAccountId!: string;
  @IsOptional() @IsIn(COST_COMPONENTS as unknown as string[]) costComponent?: string;
  @IsOptional() @IsIn(['MANUAL', 'CONSTRUCTION_EXPENSE', 'INTERNAL_CREATION', 'INVENTORY_TRANSFER', 'OPENING_MIGRATION', 'ADDITIONAL_PURCHASE_COST', 'GOODS_RECEIPT']) candidateType?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsNumber() @Min(0.000001) quantity?: number;
  @IsOptional() @IsString() reference?: string;
}

export class SplitPartDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(COST_COMPONENTS as unknown as string[]) costComponent?: string;
}

export class ClassifyCandidateDto {
  @IsIn(['CAPITALIZE', 'EXPENSE', 'SPLIT', 'ASSIGN_TO_CIP', 'ASSIGN_TO_ASSET', 'UNDER_REVIEW']) decision!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsIn(COST_COMPONENTS as unknown as string[]) costComponent?: string;
  @IsOptional() @IsString() cipProjectId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() expenseAccountId?: string;
  @IsOptional() @IsBoolean() overridePolicy?: boolean;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SplitPartDto) parts?: SplitPartDto[];
}

export class AssetSpecDto {
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsNumber() @Min(0.000001) quantity?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() inventoryNumber?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() parentAssetId?: string;
  @IsOptional() @IsString() componentType?: string;
  @IsOptional() @IsInt() componentSequence?: number;
}

export class CreateAssetsFromCandidatesDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) candidateIds!: string[];
  @IsOptional() @IsIn(['INDIVIDUAL_ASSET', 'GROUP_ASSET']) mode?: 'INDIVIDUAL_ASSET' | 'GROUP_ASSET';
  @IsOptional() @IsInt() @Min(1) @Max(10000) count?: number;
  @ValidateNested() @Type(() => AssetSpecDto) asset!: AssetSpecDto;
  @IsOptional() @IsDateString() acquisitionDate?: string;
}

// -- CIP ----------------------------------------------------------------------

export class CreateCipProjectDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsIn(['NEW_ASSET', 'CONSTRUCTION', 'MODERNIZATION', 'INTERNAL_CREATION']) projectType?: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() plannedCompletionDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsInt() @Min(1) targetAssetCount?: number;
  @IsOptional() @IsString() targetAssetId?: string;
  @IsOptional() @IsNumber() @Min(0) budgetAmount?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsIn(['PLANNED', 'ACTIVE']) status?: string;
}

export class CipStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'READY_FOR_CAPITALIZATION', 'CANCELLED']) status!: string;
  @IsOptional() @IsString() reason?: string;
}

export class CapitalizeCipDto {
  @IsDateString() date!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AssetSpecDto) assets!: AssetSpecDto[];
  @IsOptional() @IsBoolean() closeProject?: boolean;
}

export class ExpenseCipDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() date!: string;
  @IsString() reason!: string;
  @IsOptional() @IsString() expenseAccountId?: string;
  @IsOptional() @IsIn(['EXPENSE', 'RECLASSIFICATION']) kind?: 'EXPENSE' | 'RECLASSIFICATION';
}

// -- Asset card / lifecycle ----------------------------------------------------

export class CreateFixedAssetDto {
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentAssetId?: string;
  @IsOptional() @IsString() componentType?: string;
  @IsOptional() @IsInt() componentSequence?: number;
  @IsOptional() @IsNumber() @Min(0.000001) quantity?: number;
  @IsOptional() @IsDateString() acquisitionDate?: string;
  @IsOptional() @IsString() inventoryNumber?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsIn(['OWNED', 'LEASED', 'RECEIVED_FOR_USE']) ownershipType?: string;
}

export class UpdateFixedAssetDto {
  @IsInt() expectedVersion!: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsIn(['OWNED', 'LEASED', 'RECEIVED_FOR_USE']) ownershipType?: string;
  @IsOptional() @IsString() inventoryNumber?: string;
}

export class AcceptAssetDto {
  @IsDateString() date!: string;
  @IsOptional() @IsString() inventoryNumber?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() description?: string;
}

export class TaxBookDto {
  @IsInt() @Min(1) usefulLifeMonths!: number;
  @IsOptional() @IsIn(METHODS) depreciationMethod?: string;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @IsOptional() @IsNumber() @Min(0) depreciationRate?: number;
}

export class CommissionAssetDto {
  @IsDateString() date!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsIn(EXPENSE_TYPES) expenseType?: string;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsIn(METHODS) depreciationMethod?: string;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @IsOptional() @IsNumber() @Min(0) depreciationRate?: number;
  @IsOptional() @IsIn(START_RULES) depreciationStartRule?: string;
  @IsOptional() @IsIn(PARTIAL_RULES) partialPeriodRule?: string;
  @IsOptional() @ValidateNested() @Type(() => TaxBookDto) taxBook?: TaxBookDto;
  @IsOptional() @IsString() description?: string;
}

export class ChangeParametersDto {
  @IsDateString() effectiveDate!: string;
  @IsOptional() @IsIn(BOOK_CODES) bookCode?: string;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsInt() @Min(1) remainingUsefulLifeMonths?: number;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @IsOptional() @IsIn(METHODS) depreciationMethod?: string;
  @IsOptional() @IsNumber() @Min(0) depreciationRate?: number;
  @IsString() reason!: string;
}

export class ChangeStatusDto {
  @IsIn(['SUSPENDED', 'CONSERVED', 'HELD_FOR_SALE', 'ACTIVE']) status!: string;
  @IsDateString() date!: string;
  @IsString() reason!: string;
  @IsOptional() @IsIn(['CONTINUE_DEPRECIATION', 'PAUSE_DEPRECIATION', 'LOCALIZATION_RULE']) depreciationPolicy?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class TransferAssetsDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) assetIds!: string[];
  @IsDateString() date!: string;
  @IsOptional() @IsString() toDepartmentId?: string;
  @IsOptional() @IsString() toLocationId?: string;
  @IsOptional() @IsString() toResponsiblePersonId?: string;
  @IsOptional() @IsString() toBranchId?: string;
  @IsOptional() @IsString() toCostCenterId?: string;
  @IsOptional() @IsString() toProjectId?: string;
  @IsOptional() @IsIn(EXPENSE_TYPES) toExpenseType?: string;
  @IsOptional() @IsString() reason?: string;
}

export class TransferOneAssetDto {
  @IsDateString() date!: string;
  @IsOptional() @IsString() toDepartmentId?: string;
  @IsOptional() @IsString() toLocationId?: string;
  @IsOptional() @IsString() toResponsiblePersonId?: string;
  @IsOptional() @IsString() toBranchId?: string;
  @IsOptional() @IsString() toCostCenterId?: string;
  @IsOptional() @IsString() toProjectId?: string;
  @IsOptional() @IsIn(EXPENSE_TYPES) toExpenseType?: string;
  @IsOptional() @IsString() reason?: string;
}

export class StartModernizationDto {
  @IsDateString() date!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() keepActive?: boolean;
}

export class ModernizeAssetDto {
  @IsDateString() date!: string;
  @IsOptional() @IsIn(['MODERNIZATION', 'RECONSTRUCTION', 'CAPITAL_REPAIR', 'UPGRADE', 'USEFUL_LIFE_EXTENSION', 'CAPACITY_INCREASE', 'SIGNIFICANT_REPLACEMENT']) kind?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) candidateIds?: string[];
  @IsOptional() @IsString() cipProjectId?: string;
  @IsOptional() @IsNumber() @Min(0.01) cipAmount?: number;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsInt() @Min(1) remainingUsefulLifeMonths?: number;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @IsOptional() @IsString() description?: string;
}

export class RepairAssetDto {
  @IsDateString() date!: string;
  @IsString() description!: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsIn(['EXPENSE_REPAIR', 'CAPITAL_IMPROVEMENT']) decision!: 'EXPENSE_REPAIR' | 'CAPITAL_IMPROVEMENT';
  @IsOptional() @IsString() candidateId?: string;
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() expenseAccountId?: string;
}

export class ImpairAssetDto {
  @IsDateString() date!: string;
  @IsNumber() @Min(0) recoverableAmount!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() valuationSource?: string;
  @IsOptional() @IsString() approvalReference?: string;
}

export class RevalueAssetDto {
  @IsDateString() date!: string;
  @IsNumber() @Min(0) fairValue!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() valuationSource?: string;
  @IsOptional() @IsString() approvalReference?: string;
}

export class DisposeAssetDto {
  @IsDateString() date!: string;
  @IsIn(Object.values(DisposalType)) disposalType!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) share?: number;
  @IsOptional() @IsNumber() @Min(0.000001) quantity?: number;
  @IsOptional() @IsIn(Object.values(PartialDisposalMethod)) partialMethod?: string;
  @IsOptional() @IsNumber() @Min(0) proceeds?: number;
  @IsOptional() @IsNumber() @Min(0) disposalCosts?: number;
  @IsOptional() @IsString() buyerCounterpartyId?: string;
  @IsOptional() @IsString() salesInvoiceId?: string;
  @IsString() reason!: string;
  @IsOptional() @IsNumber() @Min(0) scrapValue?: number;
  @IsOptional() @IsString() scrapSourceDocumentType?: string;
  @IsOptional() @IsString() scrapSourceDocumentId?: string;
  @IsOptional() @IsString() approvalReference?: string;
}

export class ReplaceComponentDto {
  @IsString() oldComponentId!: string;
  @IsDateString() date!: string;
  @IsString() reason!: string;
  @IsOptional() @IsNumber() @Min(0) proceeds?: number;
  @IsOptional() @IsString() newComponentId?: string;
}

export class WithdrawCapitalizationDto {
  @IsOptional() @IsString() reason?: string;
}

export class ReverseDocumentDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsDateString() reversalDate?: string;
}

export class OpeningAssetDto {
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsString() inventoryNumber?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsNumber() @Min(0.01) originalCost!: number;
  @IsOptional() @IsNumber() @Min(0) accumulatedDepreciation?: number;
  @IsOptional() @IsNumber() @Min(0) impairment?: number;
  @IsOptional() @IsNumber() revaluation?: number;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number;
  @IsOptional() @IsInt() @Min(0) remainingUsefulLifeMonths?: number;
  @IsOptional() @IsNumber() @Min(0) residualValue?: number;
  @IsOptional() @IsIn(METHODS) depreciationMethod?: string;
  @IsOptional() @IsDateString() acquisitionDate?: string;
  @IsOptional() @IsDateString() commissioningDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsIn(EXPENSE_TYPES) expenseType?: string;
  @IsOptional() @IsNumber() @Min(0.000001) quantity?: number;
}

export class OpeningBalancesDto {
  @IsDateString() date!: string;
  @IsOptional() @IsBoolean() postToGl?: boolean;
  @IsOptional() @IsString() description?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OpeningAssetDto) assets!: OpeningAssetDto[];
}

// -- Depreciation ---------------------------------------------------------------

export class DepreciationPeriodDto {
  @Matches(PERIOD, { message: 'period must be YYYY-MM' }) period!: string;
  @IsOptional() @IsIn(BOOK_CODES) bookCode?: string;
}

export class PostDepreciationDto {
  @IsString() runId!: string;
}

export class ReverseDepreciationDto {
  @IsOptional() @IsString() reason?: string;
}

export class ReopenDepreciationPeriodDto {
  @Matches(PERIOD, { message: 'period must be YYYY-MM' }) period!: string;
  @IsOptional() @IsIn(BOOK_CODES) bookCode?: string;
  @IsString() reason!: string;
}

// -- Inventory ------------------------------------------------------------------

export class CreateInventoryCountDto {
  @IsDateString() countDate!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() responsiblePersonId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() comment?: string;
}

export class ScanInventoryDto {
  @IsString() code!: string;
  @IsOptional() @IsString() foundLocationId?: string;
  @IsOptional() @IsString() foundResponsiblePersonId?: string;
  @IsOptional() @IsIn(['GOOD', 'DAMAGED', 'UNUSABLE']) condition?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() description?: string;
}

export class ResolveInventoryResultDto {
  @IsIn(['TRANSFER_CORRECTION', 'FOUND_LATER', 'EMPLOYEE_RECEIVABLE', 'LOSS_EXPENSE', 'LEGAL_INVESTIGATION', 'WRITE_OFF', 'RECOGNITION_REVIEW', 'NO_ACTION']) resolution!: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() disposalDocumentId?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedValue?: number;
}
