import { IsArray, IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateDefinitionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() businessObjectType!: string;
  @IsString() actionType!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() owner?: string;
}

export class CreateVersionDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsString() triggerType!: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsArray() reapprovalPolicy?: Record<string, unknown>[];
  @IsOptional() @IsObject() slaProfile?: Record<string, unknown>;
}

export class AddStepDto {
  @IsString() stepCode!: string;
  @IsString() name!: string;
  @IsOptional() @IsInt() stage?: number;
  @IsOptional() @IsInt() sequence?: number;
  @IsOptional() @IsIn(['SEQUENTIAL', 'PARALLEL', 'ANY_ONE', 'ALL_REQUIRED', 'QUORUM', 'FIRST_RESPONSE', 'CONDITIONAL']) executionMode?: string;
  @IsOptional() @IsInt() quorumRequired?: number;
  @IsString() approverRuleId!: string;
  @IsOptional() @IsObject() conditionExpression?: Record<string, unknown>;
  @IsOptional() @IsInt() slaDurationHours?: number;
  @IsOptional() @IsString() escalationRuleId?: string;
  @IsOptional() @IsBoolean() optional?: boolean;
  @IsOptional() @IsIn(['ANY_REJECTION_REJECTS', 'MAJORITY_DECIDES', 'REJECTION_RETURNS_TO_PREVIOUS', 'REJECTION_REQUESTS_CHANGE']) rejectionPolicy?: string;
}

export class CreateApproverRuleDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['SPECIFIC_USER', 'ROLE', 'MANAGER', 'MANAGER_N_LEVELS', 'DEPARTMENT_HEAD', 'COST_CENTER_OWNER', 'PROJECT_MANAGER', 'DOCUMENT_OWNER_MANAGER', 'ORGANIZATION_ROLE', 'DYNAMIC_QUERY_RULE']) ruleType!: string;
  @IsOptional() @IsString() specificUserId?: string;
  @IsOptional() @IsString() roleCode?: string;
  @IsOptional() @IsInt() managerLevels?: number;
  @IsOptional() @IsString() fallbackRuleId?: string;
}

export class StartWorkflowDto {
  @IsString() workflowDefinitionCode!: string;
  @IsString() organizationId!: string;
  @IsString() businessObjectType!: string;
  @IsString() businessObjectId!: string;
  @IsString() requestedAction!: string;
  @IsInt() businessVersion!: number;
  @IsObject() snapshotData!: Record<string, unknown>;
  @IsObject() context!: Record<string, unknown>;
}

export class DecideDto {
  @IsString() stepInstanceId!: string;
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_CHANGE', 'ABSTAIN']) decision!: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGE' | 'ABSTAIN';
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsString() evidenceId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsObject() context!: Record<string, unknown>;
}

export class CancelDto {
  @IsString() reason!: string;
}

export class RestartDto {
  @IsObject() newSnapshot!: Record<string, unknown>;
  @IsInt() newBusinessVersion!: number;
  @IsObject() context!: Record<string, unknown>;
}

export class CreateDelegationDto {
  @IsString() delegateUserId!: string;
  @IsISO8601() validFrom!: string;
  @IsOptional() @IsISO8601() validTo?: string;
  @IsOptional() @IsString() workflowCategory?: string;
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsNumber() maxAmount?: number;
  @IsOptional() @IsArray() allowedActions?: string[];
}

export class SimulateDto {
  @IsString() organizationId!: string;
  @IsObject() context!: Record<string, unknown>;
}

export class ExecutionGateDto {
  @IsString() businessObjectType!: string;
  @IsString() businessObjectId!: string;
  @IsString() requestedAction!: string;
  @IsInt() currentBusinessVersion!: number;
  @IsOptional() @IsString() actionCategory?: string;
}
