import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---------------------------------------------------------------------------
// Position (generic job title master data)
// ---------------------------------------------------------------------------

export class CreatePositionDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  jobFamily?: string;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

// ---------------------------------------------------------------------------
// Staffing Table / Staffing Position
// ---------------------------------------------------------------------------

export class CreateStaffingTableDto {
  @IsDateString()
  effectiveFrom!: string;
}

export class AddStaffingPositionDto {
  @IsString()
  departmentId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  positionId!: string;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  headcountLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  fteLimit?: number;

  @IsOptional()
  @IsString()
  salaryRangeReference?: string;

  @IsOptional()
  @IsString()
  workScheduleDefault?: string;

  @IsOptional()
  @IsString()
  locationWarehouseId?: string;

  @IsOptional()
  @IsString()
  costCenterId?: string;

  @IsDateString()
  activeFrom!: string;
}

export class ActivateStaffingTableDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

// ---------------------------------------------------------------------------
// Physical Person
// ---------------------------------------------------------------------------

export class CreatePhysicalPersonDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  personalId?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Required to proceed when a matching personalId already exists on
   * another active PhysicalPerson in this tenant (spec section 3's
   * "duplicate person" check). */
  @IsOptional()
  confirmDuplicate?: boolean;
}

export class UpdatePhysicalPersonDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export class CreateEmployeeDto {
  @IsString()
  physicalPersonId!: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsString()
  defaultOrganizationId?: string;

  @IsOptional()
  @IsString()
  corporateEmail?: string;
}

// ---------------------------------------------------------------------------
// Employment Contract
// ---------------------------------------------------------------------------

const CONTRACT_TYPES = [
  'PERMANENT',
  'FIXED_TERM',
  'PART_TIME',
  'CIVIL',
  'INTERNSHIP',
] as const;

export class CreateEmploymentContractDto {
  /** Set by the controller from the `:employmentId` route param — never
   * required in the request body. */
  @IsOptional()
  @IsString()
  employmentId?: string;

  @IsString()
  contractNumber!: string;

  @IsDateString()
  contractDate!: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsIn(CONTRACT_TYPES)
  contractType!: (typeof CONTRACT_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  probationPeriodMonths?: number;

  @IsOptional()
  @IsString()
  workLocation?: string;

  @IsOptional()
  @IsString()
  workingTimeType?: string;

  @IsOptional()
  @IsString()
  baseCompensationReference?: string;

  @IsOptional()
  @IsString()
  conditions?: string;
}

export class AmendEmploymentContractDto {
  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  changes?: string;

  @IsOptional()
  @IsString()
  sourceDocument?: string;

  @IsOptional()
  @IsDateString()
  newEffectiveTo?: string;

  @IsOptional()
  @IsString()
  newWorkLocation?: string;

  @IsOptional()
  @IsString()
  newBaseCompensationReference?: string;

  @IsOptional()
  @IsString()
  newConditions?: string;
}

// ---------------------------------------------------------------------------
// Hire Document
// ---------------------------------------------------------------------------

const EMPLOYMENT_TYPES = [
  'PRIMARY',
  'SECONDARY',
  'INTERNAL_COMBINATION',
  'CONTRACTOR',
] as const;

export class CreateHireDocumentDto {
  /** Either an existing employeeId, or a new PhysicalPerson to create. */
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePhysicalPersonDto)
  newPerson?: CreatePhysicalPersonDto;

  /** Rehire path (spec section 48) — reuses an existing, previously
   * terminated Employee instead of creating a new one. */
  @IsOptional()
  @IsString()
  rehireOfEmployeeId?: string;

  @IsIn(EMPLOYMENT_TYPES)
  employmentType!: (typeof EMPLOYMENT_TYPES)[number];

  @IsDateString()
  hireDate!: string;

  @IsString()
  departmentId!: string;

  @IsString()
  positionId!: string;

  @IsOptional()
  @IsString()
  staffingPositionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  managerEmploymentId?: string;

  @IsOptional()
  @IsString()
  workScheduleCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  fte?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  probationMonths?: number;

  @IsOptional()
  @IsString()
  locationWarehouseId?: string;

  @IsOptional()
  @IsString()
  responsibleHrUserId?: string;

  /** Bypass the staffing-position headcount/FTE capacity check — requires
   * HR_OVERRIDE_STAFFING_LIMIT (spec section 17's own capacity guard). */
  @IsOptional()
  overrideStaffingLimit?: boolean;
}

export class PostHireDocumentDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

// ---------------------------------------------------------------------------
// Employee Transfer
// ---------------------------------------------------------------------------

const TRANSFER_TYPES = [
  'DEPARTMENT_TRANSFER',
  'POSITION_CHANGE',
  'PROMOTION',
  'DEMOTION',
  'BRANCH_TRANSFER',
  'LOCATION_TRANSFER',
  'MANAGER_CHANGE',
  'FTE_CHANGE',
  'COMBINED_TRANSFER',
] as const;

export class CreateEmployeeTransferDto {
  @IsString()
  employmentId!: string;

  @IsIn(TRANSFER_TYPES)
  transferType!: (typeof TRANSFER_TYPES)[number];

  @IsDateString()
  effectiveDate!: string;

  @IsOptional()
  @IsString()
  newDepartmentId?: string;

  @IsOptional()
  @IsString()
  newPositionId?: string;

  @IsOptional()
  @IsString()
  newStaffingPositionId?: string;

  @IsOptional()
  @IsString()
  newBranchId?: string;

  @IsOptional()
  @IsString()
  newManagerEmploymentId?: string;

  @IsOptional()
  @IsString()
  newLocationWarehouseId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  newFte?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  overrideStaffingLimit?: boolean;
}

export class PostEmployeeTransferDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

// ---------------------------------------------------------------------------
// Work Schedule Assignment
// ---------------------------------------------------------------------------

export class AssignWorkScheduleDto {
  @IsString()
  employmentId!: string;

  @IsString()
  workScheduleCode!: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ---------------------------------------------------------------------------
// Leave / Absence
// ---------------------------------------------------------------------------

const LEAVE_TYPES = [
  'ANNUAL',
  'UNPAID',
  'SICK',
  'MATERNITY',
  'PATERNITY',
  'STUDY',
  'OTHER',
] as const;

export class CreateLeaveRecordDto {
  @IsString()
  employmentId!: string;

  @IsIn(LEAVE_TYPES)
  leaveType!: (typeof LEAVE_TYPES)[number];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

export class ApproveLeaveRecordDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

const ABSENCE_TYPES = [
  'UNEXCUSED',
  'BUSINESS_TRIP',
  'TRAINING',
  'IDLE_TIME',
  'OTHER',
] as const;

export class CreateAbsenceRecordDto {
  @IsString()
  employmentId!: string;

  @IsIn(ABSENCE_TYPES)
  absenceType!: (typeof ABSENCE_TYPES)[number];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  supportingDocument?: string;
}

// ---------------------------------------------------------------------------
// Termination
// ---------------------------------------------------------------------------

export class CreateTerminationDocumentDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  terminationDate!: string;

  @IsDateString()
  lastWorkingDate!: string;

  @IsString()
  terminationReason!: string;

  @IsOptional()
  @IsString()
  legalBasis?: string;

  @IsOptional()
  @IsDateString()
  noticeDate?: string;

  @IsOptional()
  @IsString()
  responsibleHrUserId?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class PostTerminationDocumentDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ReverseTerminationDocumentDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
