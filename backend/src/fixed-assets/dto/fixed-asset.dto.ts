import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

const DEPRECIATION_METHODS = ['STRAIGHT_LINE'] as const;

export class CreateFixedAssetCategoryDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultUsefulLifeMonths?: number;

  @IsOptional()
  @IsIn(DEPRECIATION_METHODS)
  defaultDepreciationMethod?: (typeof DEPRECIATION_METHODS)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultResidualValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capitalizationThreshold?: number;
}

const CANDIDATE_TYPES = [
  'PURCHASE',
  'CONSTRUCTION',
  'INTERNAL_CREATION',
  'TRANSFER_FROM_INVENTORY',
  'MIGRATION',
  'MANUAL',
] as const;

export class CreateAcquisitionCandidateDto {
  @IsString()
  sourceDocumentType!: string;

  @IsString()
  sourceDocumentId!: string;

  @IsOptional()
  @IsString()
  sourceDocumentLineId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsNumber()
  transactionAmount!: number;

  @IsOptional()
  @IsNumber()
  baseAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsIn(CANDIDATE_TYPES)
  candidateType?: (typeof CANDIDATE_TYPES)[number];
}

const CLASSIFY_DECISIONS = [
  'CAPITALIZE',
  'EXPENSE',
  'ASSIGN_TO_CIP',
  'ASSIGN_TO_ASSET',
] as const;

export class ClassifyAcquisitionCandidateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(CLASSIFY_DECISIONS)
  decision!: (typeof CLASSIFY_DECISIONS)[number];

  /** Required for CAPITALIZE/ASSIGN_TO_CIP/ASSIGN_TO_ASSET when it differs from transactionAmount (e.g. VAT excluded). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  capitalizableAmount?: number;

  @IsOptional()
  @IsString()
  cipProjectId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  /** ASSIGN_TO_CIP only: the cost-component category this candidate becomes. */
  @IsOptional()
  @IsString()
  costComponent?: string;

  /** The business date this classification's own cost/GL event is
   * recorded under — defaults to today. Set it to the source document's
   * own date when classifying a historical/backdated acquisition. */
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  /** CAPITALIZE only. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateCipProjectDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  projectType?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  plannedCompletionDate?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  responsiblePersonId?: string;

  @IsOptional()
  @IsString()
  locationWarehouseId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsInt()
  targetAssetCount?: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class MarkCipReadyDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CapitalizeCipDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsDateString()
  acceptanceDate!: string;

  @IsString()
  name!: string;

  @IsString()
  categoryId!: string;

  /** Omit to capitalize the CIP's full remaining balance into one asset. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;
}

export class CreateFixedAssetDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  categoryId!: string;

  @IsDateString()
  acquisitionDate!: string;

  @IsNumber()
  @IsPositive()
  initialCost!: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsString()
  model?: string;
}

export class AcceptFixedAssetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsDateString()
  acceptanceDate!: string;
}

const START_RULES = [
  'FROM_COMMISSIONING_DATE',
  'NEXT_DAY',
  'NEXT_MONTH',
  'FIRST_DAY_NEXT_MONTH',
] as const;

export class CommissionFixedAssetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsDateString()
  commissioningDate!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  locationWarehouseId?: string;

  @IsOptional()
  @IsString()
  responsiblePersonId?: string;

  @IsInt()
  @Min(1)
  usefulLifeMonths!: number;

  @IsOptional()
  @IsIn(DEPRECIATION_METHODS)
  depreciationMethod?: (typeof DEPRECIATION_METHODS)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  residualValue?: number;

  @IsOptional()
  @IsIn(START_RULES)
  depreciationStartRule?: (typeof START_RULES)[number];
}

export class TransferFixedAssetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsDateString()
  effectiveDate!: string;

  @IsOptional()
  @IsString()
  toDepartmentId?: string;

  @IsOptional()
  @IsString()
  toLocationWarehouseId?: string;

  @IsOptional()
  @IsString()
  toResponsiblePersonId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ChangeUsefulLifeDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsDateString()
  effectiveDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  newUsefulLifeMonths?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  newResidualValue?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateModernizationDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  assetId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

const IMPAIRMENT_TYPES = ['IMPAIRMENT', 'REVERSAL'] as const;

export class CreateImpairmentDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  assetId!: string;

  @IsOptional()
  @IsIn(IMPAIRMENT_TYPES)
  impairmentType?: (typeof IMPAIRMENT_TYPES)[number];

  @IsNumber()
  @Min(0)
  recoverableAmount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

const DISPOSAL_TYPES = [
  'SALE',
  'WRITE_OFF',
  'SCRAP',
  'DONATION',
  'LOSS',
  'THEFT',
] as const;

export class CreateDisposalDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  assetId!: string;

  @IsIn(DISPOSAL_TYPES)
  disposalType!: (typeof DISPOSAL_TYPES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  proceeds?: number;

  /** Required when `proceeds` is set — the counterparty the sale proceeds
   * receivable is booked against (dimension requirement on account 211). */
  @IsOptional()
  @IsString()
  buyerId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  disposalCosts?: number;

  @IsOptional()
  @IsString()
  sourceSalesInvoiceId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CalculateDepreciationDto {
  @IsDateString()
  period!: string;

  @IsOptional()
  @IsIn(['PREVIEW', 'PERIODIC', 'RECALCULATION'])
  runType?: 'PREVIEW' | 'PERIODIC' | 'RECALCULATION';
}

export class StartInventoryCountDto {
  @IsOptional()
  @IsString()
  scopeDepartmentId?: string;

  @IsOptional()
  @IsString()
  scopeWarehouseId?: string;

  @IsOptional()
  @IsString()
  scopeCategoryId?: string;
}

const RESULT_TYPES = [
  'FOUND',
  'MISSING',
  'WRONG_LOCATION',
  'WRONG_RESPONSIBLE_PERSON',
  'DAMAGED',
  'UNREGISTERED_ASSET',
] as const;

export class InventoryResultLineDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsIn(RESULT_TYPES)
  resultType!: (typeof RESULT_TYPES)[number];

  @IsOptional()
  @IsString()
  foundLocationWarehouseId?: string;

  @IsOptional()
  @IsString()
  foundResponsiblePersonId?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitInventoryCountDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryResultLineDto)
  results!: InventoryResultLineDto[];
}

export class ApproveInventoryCountDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateOpeningBalanceDto {
  @IsString()
  name!: string;

  @IsString()
  categoryId!: string;

  @IsDateString()
  openingDate!: string;

  @IsNumber()
  @IsPositive()
  originalCost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accumulatedDepreciation?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  impairment?: number;

  @IsInt()
  @Min(1)
  remainingUsefulLifeMonths!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  residualValue?: number;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  locationWarehouseId?: string;

  @IsOptional()
  @IsString()
  responsiblePersonId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;
}
