import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateFrameworkDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['INTERNAL_ACCOUNTING', 'IFRS_STYLE', 'LOCAL_STATUTORY', 'MANAGEMENT_FINANCIAL', 'CUSTOM']) frameworkType!: string;
}

export class CreateFrameworkVersionDto {
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateStatementDefinitionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['TRIAL_BALANCE', 'BALANCE_SHEET', 'PROFIT_AND_LOSS', 'CASH_FLOW', 'CHANGES_IN_EQUITY', 'SUPPORTING_SCHEDULE', 'CUSTOM_FINANCIAL_REPORT']) statementType!: string;
}

export class CreateStatementVersionDto {
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() frameworkVersionId?: string;
}

export class AddRowDto {
  @IsString() rowCode!: string;
  @IsOptional() @IsString() parentRowId?: string;
  @IsString() label!: string;
  @IsOptional() @IsIn(['DATA', 'FORMULA', 'SUBTOTAL', 'HEADER', 'TEXT', 'SEPARATOR', 'CALCULATED_RATIO', 'NOTE_REFERENCE']) rowType?: string;
  @IsOptional() @IsInt() sequence?: number;
  @IsOptional() @IsInt() level?: number;
  @IsOptional() @IsIn(['AS_IS', 'FLIP']) signPolicy?: string;
  @IsOptional() @IsString() formula?: string;
  @IsOptional() @IsString() mappingGroup?: string;
  @IsOptional() @IsBoolean() drilldownEnabled?: boolean;
}

export class CreateMappingDto {
  @IsString() frameworkVersionId!: string;
  @IsString() statementVersionId!: string;
  @IsString() reportRowId!: string;
  @IsIn(['EXACT_ACCOUNT', 'ACCOUNT_TREE', 'ACCOUNT_RANGE', 'ACCOUNT_TAG', 'DIMENSION_FILTER', 'FORMULA', 'EXCLUSION']) strategy!: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() accountCodeFrom?: string;
  @IsOptional() @IsString() accountCodeTo?: string;
  @IsOptional() @IsString() accountTag?: string;
  @IsOptional() @IsObject() dimensionFilter?: Record<string, unknown>;
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsIn(['DEBIT', 'CREDIT', 'NET']) balanceSide?: string;
  @IsOptional() @IsIn(['BALANCE', 'PERIOD_MOVEMENT']) movementType?: string;
  @IsOptional() @IsInt() signMultiplier?: number;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsInt() mappingPriority?: number;
}

export class CreateReportRunDto {
  @IsString() statementDefinitionCode!: string;
  @IsString() frameworkCode!: string;
  @IsString() reportingCurrencyId!: string;
  @IsIn(['PREVIEW', 'MANAGEMENT_PREVIEW', 'CLOSED_PERIOD', 'FINAL', 'RESTATED']) runType!: string;
  @IsOptional() @IsISO8601() asOfDate?: string;
  @IsOptional() @IsISO8601() periodStart?: string;
  @IsOptional() @IsISO8601() periodEnd?: string;
  @IsOptional() @IsString() financialPeriodId?: string;
  @IsOptional() @IsString() closeRunId?: string;
}

export class SignReportDto {
  @IsOptional() @IsString() signerRole?: string;
  @IsOptional() @IsString() signatureType?: string;
}

export class RestateReportDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() newCloseRunId?: string;
}

export class TrialBalanceRunDto {
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
  @IsOptional() @IsString() accountId?: string;
}

export class BalanceSheetRunDto {
  @IsString() statementVersionId!: string;
  @IsISO8601() asOfDate!: string;
}

export class ProfitLossRunDto {
  @IsString() statementVersionId!: string;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}

export class CashFlowRunDto {
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
  @IsOptional() @IsIn(['DIRECT', 'INDIRECT']) method?: string;
}

export class CreateEquityComponentDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['SHARE_CAPITAL', 'ADDITIONAL_CAPITAL', 'RETAINED_EARNINGS', 'CURRENT_YEAR_RESULT', 'REVALUATION_RESERVE', 'OTHER_RESERVE']) componentType!: string;
  @IsOptional() @IsString() accountMappingKey?: string;
}

export class CreateCashFlowCategoryDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() parentCategoryId?: string;
  @IsIn(['OPERATING', 'INVESTING', 'FINANCING']) classification!: string;
}

export class CreateCashFlowMappingRuleDto {
  @IsOptional() @IsString() sourceOperationType?: string;
  @IsString() cashFlowCategoryId!: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() isInternalTransfer?: boolean;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

export class CreateTranslationRuleDto {
  @IsOptional() @IsString() frameworkVersionId?: string;
  @IsOptional() @IsString() reportRowCode?: string;
  @IsOptional() @IsString() accountCategory?: string;
  @IsIn(['CLOSING_RATE', 'PERIOD_AVERAGE_RATE', 'HISTORICAL_RATE', 'TRANSACTION_RATE', 'NO_TRANSLATION']) translationMethod!: string;
  @IsOptional() @IsString() rateType?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

export class CreateNoteDto {
  @IsOptional() @IsString() statementVersionId?: string;
  @IsOptional() @IsString() reportRunId?: string;
  @IsOptional() @IsString() rowCode?: string;
  @IsString() noteNumber!: string;
  @IsString() title!: string;
  @IsString() body!: string;
}

export class AffectedModulesDto {
  @IsOptional() @IsArray() affectedModules?: string[];
}
