import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumberString, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AverageMethods, CostingMethods, NegativeStockCostPolicies, SalesReturnWithoutSourcePolicies, UnpostDependencyPolicies } from '../costing.types';
import { MANUAL_ADJUSTMENT_REASONS } from '../manual-cost-adjustment.service';

export class CreateCostingPolicyDto {
  @IsDateString() effectiveFrom!: string;
  @IsIn(CostingMethods as unknown as string[]) costingMethod!: string;
  @IsOptional() @IsIn(AverageMethods as unknown as string[]) averageMethod?: string;
  @IsOptional() @IsString() valuationCurrencyId?: string;
  @IsOptional() @IsBoolean() costByWarehouse?: boolean;
  @IsOptional() @IsBoolean() costByBatch?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) financialOwnershipTypes?: string[];
  @IsOptional() @IsIn(NegativeStockCostPolicies as unknown as string[]) negativeStockCostPolicy?: string;
  @IsOptional() @IsIn(SalesReturnWithoutSourcePolicies as unknown as string[]) salesReturnWithoutSourceCost?: string;
  @IsOptional() @IsIn(UnpostDependencyPolicies as unknown as string[]) unpostDependencyPolicy?: string;
  @IsOptional() @IsBoolean() recalculateBackdatedDocuments?: boolean;
  @IsOptional() @IsBoolean() allowNegativeQuantityCosting?: boolean;
  @IsOptional() @IsNumberString() reconciliationTolerance?: string;
}

export class RecalculateDto {
  @IsOptional() @IsBoolean() fullRebuild?: boolean;
  @IsOptional() @IsDateString() fromDate?: string;
}

export class FinalizeDto {
  @Matches(/^\d{4}-\d{2}$/) period!: string;
}

export class ReopenPeriodDto {
  @IsString() reason!: string;
}

export class ManualAdjustmentLineDto {
  @IsString() costMovementId!: string;
  @IsNumberString() amount!: string;
  @IsOptional() @IsString() comment?: string;
}

export class CreateManualAdjustmentDto {
  @IsDateString() documentDate!: string;
  @IsIn(MANUAL_ADJUSTMENT_REASONS as unknown as string[]) reason!: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() counterAccountId?: string;
  @IsOptional() @IsString() sourceDocumentType?: string;
  @IsOptional() @IsString() sourceDocumentId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ManualAdjustmentLineDto) lines!: ManualAdjustmentLineDto[];
}

export class ResolveErrorDto {
  @IsOptional() @IsString() comment?: string;
}
