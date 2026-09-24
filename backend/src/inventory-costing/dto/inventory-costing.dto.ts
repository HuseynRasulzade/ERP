import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { AVERAGE_METHODS, COSTING_METHODS } from '../inventory-costing-policy.service';

export class CreateInventoryCostingPolicyDto {
  @IsDateString() effectiveFrom!: string;
  @IsIn(COSTING_METHODS) costingMethod!: string;
  @IsOptional() @IsIn(AVERAGE_METHODS) averageMethod?: string;
  @IsString() valuationCurrencyId!: string;
  @IsOptional() @IsBoolean() includePurchaseAdditionalCosts?: boolean;
  @IsOptional() @IsBoolean() includeCustomsCost?: boolean;
  @IsOptional() @IsBoolean() includeFreight?: boolean;
  @IsOptional() @IsBoolean() allowProvisionalCost?: boolean;
  @IsOptional() @IsBoolean() allowNegativeQuantityCosting?: boolean;
  @IsOptional() @IsBoolean() recalculateBackdatedDocuments?: boolean;
  @IsOptional() @IsBoolean() costByWarehouse?: boolean;
  @IsOptional() @IsBoolean() costByCharacteristic?: boolean;
  @IsOptional() @IsBoolean() costByBatch?: boolean;
  @IsOptional() @IsString() roundingPolicy?: string;
}
