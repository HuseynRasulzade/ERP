import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class OpenInvestigationDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity?: string;
  @IsOptional() @IsString() assignedTo?: string;
}

export class AddInvestigationItemDto {
  @IsString() itemType!: string;
  @IsOptional() @IsString() auditEventId?: string;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() note?: string;
}

export class SetInvestigationStatusDto {
  @IsIn(['OPEN', 'IN_REVIEW', 'EVIDENCE_COLLECTION', 'ESCALATED', 'RESOLVED', 'CLOSED']) status!: string;
  @IsOptional() @IsString() conclusion?: string;
}

export class CreateLegalHoldDto {
  @IsObject() scope!: Record<string, string>;
  @IsString() reason!: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsString() legalReference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ReleaseLegalHoldDto {
  @IsString() reason!: string;
}

export class CreateRetentionPolicyDto {
  @IsOptional() @IsString() eventCategory?: string;
  @IsOptional() @IsString() jurisdiction?: string;
  @IsOptional() @IsString() organizationId?: string;
  @IsInt() retentionPeriodDays!: number;
  @IsOptional() @IsIn(['ARCHIVE', 'ANONYMIZE', 'PURGE']) archivePolicy?: string;
}

export class VerifyIntegrityDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class AuditSearchDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() actorUserId?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() documentType?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() operation?: string;
  @IsOptional() @IsString() eventCategory?: string;
  @IsOptional() @IsString() correlationId?: string;
  @IsOptional() @IsString() fullText?: string;
  @IsOptional() @IsInt() limit?: number;
}

export class BuildExportDto {
  @IsString() title!: string;
  @IsObject() filter!: Record<string, unknown>;
  @IsOptional() @IsBoolean() redact?: boolean;
}

export class RecordConfigChangeDto {
  @IsString() configurationType!: string;
  @IsString() configurationId!: string;
  @IsObject() @IsOptional() versionBefore?: Record<string, unknown>;
  @IsObject() versionAfter!: Record<string, unknown>;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsString() approvedBy?: string;
  @IsString() changeReason!: string;
  @IsOptional() @IsString() impactScope?: string;
}

export class RecordSensitiveAccessDto {
  @IsString() resourceType!: string;
  @IsString() resourceId!: string;
  @IsOptional() @IsString() accessType?: string;
  @IsOptional() @IsArray() fieldsAccessed?: string[];
  @IsOptional() @IsString() purpose?: string;
}
