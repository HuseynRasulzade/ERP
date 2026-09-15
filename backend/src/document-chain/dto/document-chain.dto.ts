import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateDocumentTypeDto {
  @IsString() code!: string;
  @IsString() module!: string;
  @IsString() entityType!: string;
  @IsOptional() @IsString() lineEntityType?: string;
  @IsOptional() @IsBoolean() supportsCreateBasedOn?: boolean;
  @IsOptional() @IsBoolean() supportsLineProvenance?: boolean;
}

export class CreateTransformationDto {
  @IsString() code!: string;
  @IsString() sourceDocumentType!: string;
  @IsString() targetDocumentType!: string;
  @IsOptional() @IsIn(['QUANTITY_BASED', 'AMOUNT_BASED', 'MIXED', 'BOOLEAN_ENTITLEMENT', 'SCHEDULE_BASED', 'REFERENCE_ONLY', 'REVERSAL', 'CORRECTION']) transformationCategory?: string;
  @IsOptional() @IsString() ownerModule?: string;
}

export class CreateTransformationVersionDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsArray() headerMapping?: Record<string, unknown>[];
  @IsOptional() @IsArray() lineMapping?: Record<string, unknown>[];
  @IsOptional() @IsArray() eligibilityRules?: Record<string, unknown>[];
  @IsOptional() @IsIn(['QUANTITY', 'BASE_QUANTITY', 'AMOUNT', 'TRANSACTION_AMOUNT', 'BASE_AMOUNT', 'SCHEDULE_QUANTITY', 'INSTALLMENT_AMOUNT', 'ENTITLEMENT_COUNT']) consumptionMetric?: string;
  @IsOptional() @IsIn(['ON_SAVE', 'ON_APPROVAL', 'ON_POST', 'ON_EXECUTION', 'CUSTOM_DOMAIN_STATE']) commitState?: string;
  @IsOptional() @IsIn(['NONE', 'SOFT_CLAIM', 'HARD_CLAIM', 'CLAIM_WITH_TTL']) claimPolicy?: string;
  @IsOptional() @IsInt() claimTtlMinutes?: number;
  @IsOptional() @IsObject() tolerancePolicy?: Record<string, unknown>;
}

export class SourceLineSnapshotDto {
  @IsString() sourceLineId!: string;
  @IsString() sourceLineType!: string;
  @IsObject() snapshot!: Record<string, unknown>;
  @IsOptional() @IsNumber() requestedQuantity?: number;
}

export class GenerateProposalDto {
  @IsString() organizationId!: string;
  @IsString() sourceDocumentType!: string;
  @IsArray() sourceDocumentIds!: string[];
  @IsObject() sourceHeaderSnapshot!: Record<string, unknown>;
  @IsArray() sourceLines!: SourceLineSnapshotDto[];
  @IsOptional() @IsObject() mappingContext?: Record<string, unknown>;
}

export class AcceptProposalDto {
  @IsObject() currentSourceHeaderSnapshot!: Record<string, unknown>;
  @IsArray() currentSourceLines!: { sourceLineId: string; snapshot: Record<string, unknown> }[];
  @IsOptional() @IsObject() lineOverrides?: Record<string, number>;
  @IsOptional() @IsObject() mappingContext?: Record<string, unknown>;
}

export class ClaimDto {
  @IsString() transformationVersionId!: string;
  @IsString() sourceDocumentType!: string;
  @IsString() sourceDocumentId!: string;
  @IsString() sourceLineId!: string;
  @IsString() transformationCode!: string;
  @IsString() metric!: string;
  @IsNumber() quantity!: number;
  @IsOptional() @IsInt() ttlMinutes?: number;
}

export class ResolveExceptionDto {
  @IsOptional() @IsString() note?: string;
}
