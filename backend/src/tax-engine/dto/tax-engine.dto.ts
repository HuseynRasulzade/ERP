import { IsBoolean, IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString } from 'class-validator';

const TAX_TREATMENTS = ['STANDARD_RATE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'SPECIAL_RATE'];
const RULE_CATEGORIES = ['STANDARD', 'ZERO_RATE', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE'];

export class CalculateTaxDto {
  @IsIn(['SALE', 'PURCHASE']) operationType!: 'SALE' | 'PURCHASE';
  @IsString() taxCategoryCode!: string;
  @IsIn(['SELLER', 'BUYER', 'SELF_ASSESSED']) taxpayerSide!: 'SELLER' | 'BUYER' | 'SELF_ASSESSED';
  @IsNumberString() amount!: string;
  @IsBoolean() priceIncludesTax!: boolean;
  @IsDateString() taxPointDate!: string;
  @IsOptional() @IsString() sourceLineId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumberString() recoverablePercent?: string;
}

export class CreateTaxRegistrationDto {
  @IsString() taxType!: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsIn(['REGISTERED', 'NOT_REGISTERED', 'SUSPENDED']) status?: string;
}

/**
 * Tenant-specific custom TaxRule (spec sections 6-9, 74, 97) — creates a
 * DRAFT row scoped to the caller's own tenant. References an EXISTING
 * TaxType/TaxRate by id rather than defining a new global rate — TaxRate/
 * TaxLegalSource/TaxCategory/TaxExemption have no `tenantId` column in
 * this schema (they are shared, system-wide reference data, seeded by
 * AzTaxLocalizationService), so exposing a tenant-facing "create a new
 * global rate" endpoint would be a real cross-tenant data-isolation risk;
 * see docs/TAX_ENGINE.md's Technical Debt for the disclosed scope of what
 * this admin surface deliberately does NOT cover.
 */
export class CreateTaxRuleDto {
  @IsString() taxTypeCode!: string;
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsIn(RULE_CATEGORIES) ruleCategory!: string;
  @IsIn(TAX_TREATMENTS) treatment!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsString() rateId?: string;
  @IsOptional() @IsString() legalSourceId?: string;
  @IsOptional() @IsString() legalArticleReference?: string;
  @IsOptional() @IsString() legalSubarticleReference?: string;
  @IsOptional() @IsString() exemptionCode?: string;
  @IsOptional() @IsIn(['SALE', 'PURCHASE']) conditionOperationType?: string;
  @IsOptional() @IsString() conditionTaxCategoryCode?: string;
  @IsOptional() @IsIn(['SELLER', 'BUYER', 'SELF_ASSESSED']) conditionTaxpayerSide?: string;
}

export class UpdateTaxRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(TAX_TREATMENTS) treatment?: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsString() rateId?: string;
  @IsOptional() @IsString() legalSourceId?: string;
  @IsOptional() @IsString() legalArticleReference?: string;
  @IsOptional() @IsString() exemptionCode?: string;
  @IsOptional() @IsIn(['SALE', 'PURCHASE']) conditionOperationType?: string;
  @IsOptional() @IsString() conditionTaxCategoryCode?: string;
  @IsOptional() @IsIn(['SELLER', 'BUYER', 'SELF_ASSESSED']) conditionTaxpayerSide?: string;
}

export class RepealTaxRuleDto {
  @IsDateString() effectiveTo!: string;
  @IsString() reason!: string;
}
