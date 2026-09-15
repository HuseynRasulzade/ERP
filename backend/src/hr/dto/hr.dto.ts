import { IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePhysicalPersonDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() middleName?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsISO8601() birthDate?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() personalId?: string;
  @IsOptional() @IsString() passportNumber?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() emergencyContact?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CheckDuplicatesDto {
  @IsOptional() @IsString() personalId?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsISO8601() birthDate?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}

export class CreateEmployeeDto {
  @IsString() physicalPersonId!: string;
  @IsOptional() @IsString() defaultOrganizationId?: string;
  @IsOptional() @IsString() defaultLanguage?: string;
  @IsOptional() @IsString() corporateEmail?: string;
  @IsOptional() @IsString() corporatePhone?: string;
  @IsOptional() @IsString() bankAccountReference?: string;
}

export class CreatePositionDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() jobFamily?: string;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateStaffingTableDto {
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsString() supersedesTableId?: string;
}

export class AddStaffingPositionDto {
  @IsString() staffingTableId!: string;
  @IsString() departmentId!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsString() positionId!: string;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsInt() headcountLimit?: number;
  @IsOptional() @IsNumber() fteLimit?: number;
  @IsOptional() @IsString() salaryRangeReference?: string;
  @IsOptional() @IsString() workScheduleDefault?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsISO8601() activeFrom!: string;
  @IsOptional() @IsIn(['BLOCK', 'WARNING', 'APPROVAL_REQUIRED', 'ALLOW']) overstaffPolicy?: string;
}

export class CreateHireDto {
  @IsString() employeeId!: string;
  @IsIn(['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'FIXED_TERM', 'CONTRACT', 'INTERNSHIP', 'SECONDARY_EMPLOYMENT', 'SEASONAL']) employmentType!: string;
  @IsISO8601() hireDate!: string;
  @IsISO8601() documentDate!: string;
  @IsString() departmentId!: string;
  @IsString() positionId!: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() staffingPositionId?: string;
  @IsOptional() @IsString() managerEmploymentId?: string;
  @IsOptional() @IsString() workScheduleId?: string;
  @IsOptional() @IsNumber() fte?: number;
  @IsOptional() @IsISO8601() probationEndDate?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() costCenterId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsBoolean() primaryEmployment?: boolean;
  @IsOptional() @IsString() responsibleHrUserId?: string;
  @IsOptional() @IsString() previousEmploymentId?: string;
  @IsOptional() @IsBoolean() isRehire?: boolean;
  @IsOptional() @IsString() contractNumber?: string;
  @IsString() contractType!: string;
  @IsOptional() @IsInt() probationPeriodMonths?: number;
  @IsOptional() @IsString() workLocation?: string;
  @IsOptional() @IsString() workingTimeType?: string;
  @IsOptional() @IsString() baseCompensationReference?: string;
  @IsOptional() @IsString() conditions?: string;
}

export class AmendContractDto {
  @IsISO8601() effectiveFrom!: string;
  @IsString() changeSummary!: string;
  @IsOptional() @IsString() contractType?: string;
  @IsOptional() @IsString() conditions?: string;
  @IsOptional() @IsString() baseCompensationReference?: string;
  @IsOptional() @IsString() approvedBy?: string;
}

export class CreateTransferDto {
  @IsString() employmentId!: string;
  @IsIn(['DEPARTMENT_TRANSFER', 'POSITION_CHANGE', 'PROMOTION', 'DEMOTION', 'BRANCH_TRANSFER', 'LOCATION_TRANSFER', 'MANAGER_CHANGE', 'FTE_CHANGE', 'COMBINED_TRANSFER']) transferType!: string;
  @IsISO8601() effectiveDate!: string;
  @IsOptional() @IsString() newOrganizationId?: string;
  @IsOptional() @IsString() newDepartmentId?: string;
  @IsOptional() @IsString() newPositionId?: string;
  @IsOptional() @IsString() newStaffingPositionId?: string;
  @IsOptional() @IsString() newBranchId?: string;
  @IsOptional() @IsString() newManagerEmploymentId?: string;
  @IsOptional() @IsString() newLocationId?: string;
  @IsOptional() @IsNumber() newFte?: number;
  @IsOptional() @IsString() newWorkScheduleId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() documentDate!: string;
}

export class CreateTerminationDto {
  @IsString() employmentId!: string;
  @IsISO8601() terminationDate!: string;
  @IsOptional() @IsISO8601() lastWorkingDate?: string;
  @IsString() terminationReason!: string;
  @IsOptional() @IsString() legalReference?: string;
  @IsOptional() @IsISO8601() noticeDate?: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() responsibleHrUserId?: string;
  @IsISO8601() documentDate!: string;
}

export class ChangeScheduleDto {
  @IsString() employmentId!: string;
  @IsString() workScheduleId!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsString() reason?: string;
}

export class RequestLeaveDto {
  @IsString() employmentId!: string;
  @IsIn(['ANNUAL', 'UNPAID', 'MATERNITY', 'PATERNITY', 'STUDY', 'MEDICAL', 'OTHER']) leaveType!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
}

export class RecordAbsenceDto {
  @IsString() employmentId!: string;
  @IsString() absenceType!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() supportingDocumentAssetId?: string;
}

export class SetAttributeDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() employmentId?: string;
  @IsString() attributeType!: string;
  @IsString() value!: string;
  @IsISO8601() effectiveFrom!: string;
}
