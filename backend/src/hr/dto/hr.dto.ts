import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CONTRACT_TYPES, EMPLOYMENT_TYPES, TRANSFER_TYPES } from '../hr.constants';

// ------------------------------------------------------------ persons

export class CreatePhysicalPersonDto {
  @IsString() @MaxLength(100) firstName!: string;
  @IsString() @MaxLength(100) lastName!: string;
  @IsOptional() @IsString() @MaxLength(100) middleName?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() @MaxLength(50) personalId?: string;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @IsOptional() @IsString() @MaxLength(50) passportNumber?: string;
  @IsOptional() @IsArray() identityDocuments?: Record<string, unknown>[];
  @IsOptional() @IsString() personalEmail?: string;
  @IsOptional() @IsString() personalPhone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsObject() emergencyContact?: Record<string, unknown>;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdatePhysicalPersonDto {
  @IsInt() expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(100) middleName?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() personalId?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() passportNumber?: string;
  @IsOptional() @IsArray() identityDocuments?: Record<string, unknown>[];
  @IsOptional() @IsString() personalEmail?: string;
  @IsOptional() @IsString() personalPhone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsObject() emergencyContact?: Record<string, unknown>;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class DuplicateCheckDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() personalId?: string;
  @IsOptional() @IsString() passportNumber?: string;
  @IsOptional() @IsString() personalEmail?: string;
  @IsOptional() @IsString() personalPhone?: string;
}

// ------------------------------------------------------------ employees

export class CreateEmployeeDto {
  @IsOptional() @IsUUID() physicalPersonId?: string;
  @IsOptional() @ValidateNested() @Type(() => CreatePhysicalPersonDto) person?: CreatePhysicalPersonDto;
  @IsOptional() @IsString() @MaxLength(50) employeeCode?: string;
  @IsOptional() @IsUUID() defaultOrganizationId?: string;
  @IsOptional() @IsString() defaultLanguage?: string;
  @IsOptional() @IsString() corporateEmail?: string;
  @IsOptional() @IsString() corporatePhone?: string;
}

export class UpdateEmployeeDto {
  @IsInt() expectedVersion!: number;
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsUUID() defaultOrganizationId?: string;
  @IsOptional() @IsString() defaultLanguage?: string;
  @IsOptional() @IsString() corporateEmail?: string;
  @IsOptional() @IsString() corporatePhone?: string;
}

export class CreateAttributeDto {
  @IsString() attributeType!: string;
  @IsString() value!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsUUID() employmentId?: string;
}

export class CreateBankAccountDto {
  @IsString() bankName!: string;
  @IsString() @MaxLength(34) iban!: string;
  @IsOptional() @IsString() currencyCode?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsDateString() effectiveFrom?: string;
}

// ------------------------------------------------------------ master data

export class CreatePositionDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() jobFamily?: string;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdatePositionDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() jobFamily?: string;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateWorkScheduleDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() name!: string;
  @IsOptional() @IsIn(['STANDARD_WEEK', 'SHIFT', 'ROTATING', 'FLEXIBLE', 'PART_TIME', 'CUSTOM']) scheduleType?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(168) weeklyHours?: number;
  @IsOptional() @IsString() templateRef?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateWorkScheduleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(168) weeklyHours?: number;
  @IsOptional() @IsString() templateRef?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateStaffingTableDto {
  @IsUUID() organizationId!: string;
  @IsString() name!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsUUID() copyFromTableId?: string;
}

export class CreateStaffingPositionDto {
  @IsUUID() staffingTableId!: string;
  @IsString() @MaxLength(50) code!: string;
  @IsUUID() departmentId!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() positionId!: string;
  @IsOptional() @IsString() grade?: string;
  @IsInt() @Min(0) headcountLimit!: number;
  @IsNumber() @Min(0) fteLimit!: number;
  @IsOptional() @IsString() salaryRangeReference?: string;
  @IsOptional() @IsUUID() defaultWorkScheduleId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() costCenter?: string;
  @IsOptional() @IsDateString() activeFrom?: string;
  @IsOptional() @IsDateString() activeTo?: string;
}

export class UpdateStaffingPositionDto {
  @IsOptional() @IsInt() @Min(0) headcountLimit?: number;
  @IsOptional() @IsNumber() @Min(0) fteLimit?: number;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() salaryRangeReference?: string;
  @IsOptional() @IsUUID() defaultWorkScheduleId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() costCenter?: string;
  @IsOptional() @IsDateString() activeTo?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

export class CatalogItemDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() nameAz?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class HrPeriodDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
}

export class UpdateHrPolicyDto {
  @IsOptional() @IsIn(['BLOCK', 'WARNING', 'APPROVAL_REQUIRED', 'ALLOW']) overstaffPolicy?: 'BLOCK' | 'WARNING' | 'APPROVAL_REQUIRED' | 'ALLOW';
  @IsOptional() @IsIn(['BLOCK', 'WARNING', 'ALLOW']) duplicateEmploymentPolicy?: 'BLOCK' | 'WARNING' | 'ALLOW';
  @IsOptional() @IsIn(['TENANT', 'ORGANIZATION']) primaryEmploymentScope?: 'TENANT' | 'ORGANIZATION';
  @IsOptional() @IsNumber() maxEmploymentFte?: number;
  @IsOptional() @IsNumber() maxAggregateFte?: number;
  @IsOptional() @IsBoolean() requireContract?: boolean;
  @IsOptional() @IsBoolean() requireSignedContract?: boolean;
  @IsOptional() @IsBoolean() requireApproval?: boolean;
  @IsOptional() @IsBoolean() segregationOfDuties?: boolean;
  @IsOptional() @IsBoolean() requireManager?: boolean;
  @IsOptional() @IsBoolean() auditSensitiveViews?: boolean;
}

// ------------------------------------------------------------ contracts

export class ContractTermsDto {
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsIn(CONTRACT_TYPES as unknown as string[]) contractType?: string;
  @IsOptional() @IsInt() @Min(0) probationPeriodDays?: number;
  @IsOptional() @IsString() workLocation?: string;
  @IsOptional() @IsString() workingTimeType?: string;
  @IsOptional() @IsString() baseCompensationReference?: string;
  @IsOptional() @IsString() conditions?: string;
}

export class InlineContractDto {
  @IsOptional() @IsString() @MaxLength(50) contractNumber?: string;
  @IsOptional() @IsDateString() contractDate?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsIn(CONTRACT_TYPES as unknown as string[]) contractType!: string;
  @IsOptional() @IsInt() @Min(0) probationPeriodDays?: number;
  @IsOptional() @IsString() workLocation?: string;
  @IsOptional() @IsString() workingTimeType?: string;
  @IsOptional() @IsString() baseCompensationReference?: string;
  @IsOptional() @IsString() conditions?: string;
  @IsOptional() @IsIn(['UNSIGNED', 'SIGNED']) signedStatus?: string;
  @IsOptional() @IsString() attachmentId?: string;
}

export class CreateContractDto extends InlineContractDto {
  @IsUUID() organizationId!: string;
  @IsUUID() employeeId!: string;
  @IsDateString() effectiveFrom!: string;
}

export class AmendContractDto {
  @IsDateString() effectiveFrom!: string;
  @ValidateNested() @Type(() => ContractTermsDto) changes!: ContractTermsDto;
  @IsOptional() @IsString() reason?: string;
}

// ------------------------------------------------------------ HR documents

export class HireTermsDto {
  @IsDateString() hireDate!: string;
  @IsOptional() @IsDateString() documentDate?: string;
  @IsIn(EMPLOYMENT_TYPES as unknown as string[]) employmentType!: string;
  @IsOptional() @IsBoolean() primaryEmployment?: boolean;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @ValidateNested() @Type(() => InlineContractDto) contract?: InlineContractDto;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() positionId?: string;
  @IsOptional() @IsUUID() staffingPositionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() managerEmploymentId?: string;
  @IsOptional() @IsUUID() workScheduleId?: string;
  @IsOptional() @IsNumber() fte?: number;
  @IsOptional() @IsDateString() probationEndDate?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() costCenter?: string;
  @IsOptional() @IsString() project?: string;
  @IsOptional() @IsUUID() responsibleHrUserId?: string;
  @IsOptional() @IsBoolean() overrideStaffingLimit?: boolean;
  @IsOptional() @IsString() comment?: string;
}

export class CreateHireDto extends HireTermsDto {
  @IsUUID() organizationId!: string;
  @IsUUID() employeeId!: string;
}

export class CreateRehireDto extends HireTermsDto {
  @IsUUID() previousEmploymentId!: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class BulkHireDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CreateHireDto) lines!: CreateHireDto[];
  @IsOptional() @IsBoolean() post?: boolean;
}

export class HrDocActionDto {
  @IsOptional() @IsInt() expectedVersion?: number;
  @IsOptional() @IsString() reason?: string;
}

export class TransferChangesDto {
  @IsOptional() @IsUUID() newDepartmentId?: string;
  @IsOptional() @IsUUID() newPositionId?: string;
  @IsOptional() @IsUUID() newStaffingPositionId?: string;
  @IsOptional() @IsUUID() newBranchId?: string;
  @IsOptional() @IsUUID() newManagerEmploymentId?: string;
  @IsOptional() @IsBoolean() clearManager?: boolean;
  @IsOptional() @IsString() newLocation?: string;
  @IsOptional() @IsNumber() newFte?: number;
  @IsOptional() @IsString() newCostCenter?: string;
  @IsOptional() @IsString() newProject?: string;
  @IsOptional() @IsUUID() newWorkScheduleId?: string;
}

export class CreateTransferDto extends TransferChangesDto {
  @IsUUID() employmentId!: string;
  @IsDateString() effectiveDate!: string;
  @IsOptional() @IsDateString() documentDate?: string;
  @IsIn(TRANSFER_TYPES as unknown as string[]) transferType!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() overrideStaffingLimit?: boolean;
}

export class BulkTransferLineDto extends TransferChangesDto {
  @IsUUID() employmentId!: string;
}

export class BulkTransferDto {
  @IsDateString() effectiveDate!: string;
  @IsIn(TRANSFER_TYPES as unknown as string[]) transferType!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() post?: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BulkTransferLineDto) lines!: BulkTransferLineDto[];
}

export class CreateTerminationDto {
  @IsUUID() employmentId!: string;
  @IsDateString() terminationDate!: string;
  @IsOptional() @IsDateString() lastWorkingDate?: string;
  @IsString() terminationReasonCode!: string;
  @IsOptional() @IsString() legalBasis?: string;
  @IsOptional() @IsDateString() noticeDate?: string;
  @IsOptional() @IsDateString() finalScheduleDate?: string;
  @IsOptional() @IsUUID() responsibleHrUserId?: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsDateString() documentDate?: string;
}

// ------------------------------------------------------------ employment events

export class ScheduleChangeDto {
  @IsUUID() workScheduleId!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsString() reason?: string;
}

export class SuspendDto {
  @IsDateString() effectiveFrom!: string;
  @IsString() reasonCode!: string;
  @IsOptional() @IsString() comment?: string;
}

export class ReturnToWorkDto {
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsString() comment?: string;
}

export class CreateLeaveDto {
  @IsUUID() employmentId!: string;
  @IsString() leaveTypeCode!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsDateString() requestDate?: string;
  @IsOptional() @IsString() comment?: string;
}

export class CreateAbsenceDto {
  @IsUUID() employmentId!: string;
  @IsString() absenceTypeCode!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(24) hours?: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() supportingDocument?: string;
}

export class CreateBusinessTripDto {
  @IsUUID() employmentId!: string;
  @IsString() destination!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() purpose?: string;
}

export class CreatePersonnelDocumentDto {
  @IsIn(['PERSON', 'EMPLOYEE', 'EMPLOYMENT', 'CONTRACT', 'LEAVE', 'TERMINATION']) ownerType!: string;
  @IsUUID() ownerId!: string;
  @IsIn(['IDENTITY', 'CONTRACT', 'AMENDMENT', 'CERTIFICATE', 'DIPLOMA', 'LEAVE', 'TERMINATION', 'MEDICAL', 'OTHER']) documentCategory!: string;
  @IsOptional() @IsIn(['NORMAL', 'PERSONAL', 'MEDICAL']) sensitivity?: string;
  @IsString() fileName!: string;
  @IsOptional() @IsString() fileType?: string;
  @IsOptional() @IsInt() fileSize?: number;
  @IsOptional() @IsString() storageKey?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ImportValidateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) rows!: Record<string, any>[];
}

export class AckEventsDto {
  @IsArray() @IsUUID('all', { each: true }) ids!: string[];
}
