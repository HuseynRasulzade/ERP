import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateEndpointDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL']) direction!: 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
  @IsString() connectorId!: string;
  @IsString() protocol!: string;
  @IsOptional() @IsIn(['TEST', 'SANDBOX', 'PRODUCTION']) environment?: 'TEST' | 'SANDBOX' | 'PRODUCTION';
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsString() baseEndpointReference?: string;
  @IsOptional() @IsString() credentialReferenceId?: string;
}

export class CreateContractDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: string;
}

export class CreateContractVersionDto {
  @IsObject() schema!: { fields: Record<string, { type: string; required?: boolean }> };
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() backwardCompatible?: boolean;
}

export class CreateMappingProfileDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() connectorId?: string;
}

export class CreateMappingVersionDto {
  @IsString() sourceContractVersionId!: string;
  @IsString() targetCanonicalContract!: string;
  @IsArray() fieldMappings!: Record<string, unknown>[];
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
}

export class ReplayMessageDto {
  @IsString() contractCode!: string;
  @IsIn(['CREATE_ONLY', 'UPDATE_IF_UNPOSTED', 'UPSERT_MASTER_DATA', 'SYNC_STATE', 'REFERENCE_ONLY', 'COMMAND_EVENT']) mode!: string;
  @IsObject() canonicalData!: Record<string, unknown>;
  @IsOptional() @IsString() mappingVersionId?: string;
}

export class ManualMatchDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsString() externalSystem!: string;
  @IsString() externalEntityType!: string;
  @IsString() externalEntityId!: string;
  @IsString() internalEntityType!: string;
  @IsString() internalEntityId!: string;
}

export class RunReconciliationDto {
  @IsString() periodLabel!: string;
  @IsArray() externalSide!: { key: string; count: number; amount: number }[];
  @IsArray() internalSide!: { key: string; count: number; amount: number }[];
}

export class ResolveDeadLetterDto {
  @IsString() resolution!: string;
  @IsIn(['RESOLVED', 'IGNORED_WITH_REASON']) outcome!: 'RESOLVED' | 'IGNORED_WITH_REASON';
}
