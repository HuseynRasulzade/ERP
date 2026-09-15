import { IsArray, IsIn, IsISO8601, IsInt, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSemanticModelDto {
  @IsString() code!: string;
  @IsString() name!: string;
}

export class CreateSemanticModelVersionDto {
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateMeasureDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['SALES', 'PURCHASE', 'INVENTORY', 'SETTLEMENT', 'CASH', 'EXPENSE', 'PAYROLL', 'PRODUCTION', 'BUDGET', 'FORECAST', 'DERIVED']) sourceFact!: string;
  @IsOptional() @IsIn(['SUM', 'AVG', 'COUNT', 'LAST', 'FORMULA']) aggregationType?: string;
  @IsOptional() @IsString() formula?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsIn(['FINANCIAL', 'OPERATIONAL', 'RATIO', 'STATISTICAL', 'FORECAST', 'SCENARIO']) measureType?: string;
  @IsOptional() @IsIn(['AS_IS', 'FLIP']) signPolicy?: string;
}

export class EvaluateMeasureDto {
  @IsString() semanticModelVersionId!: string;
  @IsString() measureCode!: string;
  @IsIn(['PERIOD', 'AS_OF']) modeType!: string;
  @IsOptional() @IsISO8601() periodStart?: string;
  @IsOptional() @IsISO8601() periodEnd?: string;
  @IsOptional() @IsISO8601() asOfDate?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() departmentId?: string;
}

export class CreateKpiDto {
  @IsString() semanticModelVersionId!: string;
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsString() numeratorMeasure!: string;
  @IsOptional() @IsString() denominatorMeasure?: string;
  @IsOptional() @IsIn(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TARGET_RANGE', 'INFORMATIONAL']) directionality?: string;
  @IsOptional() @IsNumber() warningThreshold?: number;
  @IsOptional() @IsNumber() criticalThreshold?: number;
}

export class SetKpiTargetDto {
  @IsString() organizationId!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsString() period!: string;
  @IsOptional() @IsString() scenario?: string;
  @IsNumber() target!: number;
}

export class CreateAllocationRuleDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() sourceMeasure!: string;
  @IsIn(['CUSTOMER', 'PRODUCT', 'CHANNEL', 'PROJECT', 'PROFIT_CENTER']) targetDimension!: string;
  @IsString() driverMeasure!: string;
}

export class RunAllocationDto {
  @IsString() period!: string;
  @IsNumber() poolAmount!: number;
  @IsArray() targetKeys!: { key: string; driverValue: number }[];
}

export class CreateBudgetVersionDto {
  @IsString() organizationId!: string;
  @IsInt() fiscalYear!: number;
  @IsOptional() @IsString() scenario?: string;
  @IsString() baseCurrencyId!: string;
}

export class UpsertBudgetFactDto {
  @IsInt() expectedRecordVersion!: number;
  @IsString() period!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsString() measureCode!: string;
  @IsNumber() amount!: number;
}

export class CreateForecastVersionDto {
  @IsString() organizationId!: string;
  @IsInt() fiscalYear!: number;
  @IsString() code!: string;
}

export class CreateScenarioDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsIn(['ACTUAL', 'BUDGET', 'FORECAST', 'BASE_CASE', 'OPTIMISTIC', 'PESSIMISTIC', 'STRESS', 'CUSTOM']) scenarioType?: string;
}

export class AddScenarioAssumptionDto {
  @IsString() measureCode!: string;
  @IsOptional() @IsIn(['PERCENT', 'ABSOLUTE']) adjustmentType?: string;
  @IsNumber() adjustmentValue!: number;
  @IsOptional() @IsString() description?: string;
}

export class CreateSnapshotDto {
  @IsOptional() @IsIn(['DAILY', 'WEEKLY', 'MONTH_END', 'BOARD_PACK', 'FORECAST', 'SCENARIO']) snapshotType?: string;
  @IsString() period!: string;
  @IsOptional() @IsString() closeRunId?: string;
  @IsOptional() @IsString() semanticModelVersionId?: string;
  @IsOptional() @IsString() budgetVersionId?: string;
  @IsOptional() @IsString() forecastVersionId?: string;
  @IsOptional() @IsString() scenarioId?: string;
  @IsObject() payload!: Record<string, unknown>;
}

export class CreateDashboardDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() audience?: string;
  @IsArray() widgets!: Record<string, unknown>[];
}

export class CreateAlertRuleDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() kpiCode?: string;
  @IsOptional() @IsString() measureCode?: string;
  @IsString() condition!: string;
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) severity?: string;
}
