import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// ---------------------------------------------------------------------------
// Production Calendar
// ---------------------------------------------------------------------------

const DAY_TYPES = [
  'WORKDAY',
  'WEEKEND',
  'HOLIDAY',
  'SHORTENED_WORKDAY',
  'TRANSFERRED_WORKDAY',
  'NON_WORKING_DAY',
] as const;

export class CreateProductionCalendarDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsInt()
  year!: number;

  @IsString()
  name!: string;

  @IsDateString()
  effectiveFrom!: string;
}

export class CalendarDayDto {
  @IsDateString()
  date!: string;

  @IsIn(DAY_TYPES)
  dayType!: (typeof DAY_TYPES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultWorkingHours?: number;

  @IsOptional()
  @IsString()
  holidayCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shortenedByHours?: number;

  @IsOptional()
  @IsDateString()
  transferredFromDate?: string;

  @IsOptional()
  @IsDateString()
  transferredToDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkAddCalendarDaysDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CalendarDayDto)
  days!: CalendarDayDto[];
}

export class CreateCalendarVersionDto {
  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  name?: string;

  /** Copy the previous version's days as a starting point (spec section 6:
   * a new version, not an overwrite of historical data). Defaults true. */
  @IsOptional()
  @IsBoolean()
  copyDays?: boolean;
}

// ---------------------------------------------------------------------------
// Work Schedule Template / Pattern / Shift Template
// ---------------------------------------------------------------------------

const SCHEDULE_TYPES = [
  'STANDARD_WEEK',
  'SHIFT',
  'ROTATING',
  'FLEXIBLE',
  'PART_TIME',
  'CUSTOM',
] as const;

export class CreateWorkScheduleTemplateDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsIn(SCHEDULE_TYPES)
  scheduleType?: (typeof SCHEDULE_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  cycleLengthDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultWeeklyHours?: number;

  @IsOptional()
  @IsBoolean()
  usesProductionCalendar?: boolean;
}

export class CreateShiftTemplateDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  breakDurationMinutes?: number;

  @IsNumber()
  @Min(0)
  plannedHours!: number;

  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;
}

const PATTERN_DAY_TYPES = ['WORK', 'OFF'] as const;

export class SetSchedulePatternDto {
  @IsInt()
  @Min(1)
  cycleDay!: number;

  @IsOptional()
  @IsIn(PATTERN_DAY_TYPES)
  dayType?: (typeof PATTERN_DAY_TYPES)[number];

  @IsOptional()
  @IsString()
  workStartTime?: string;

  @IsOptional()
  @IsString()
  workEndTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  breakDurationMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedHours?: number;

  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  @IsOptional()
  @IsString()
  shiftTemplateId?: string;
}

export class BulkSetSchedulePatternDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetSchedulePatternDto)
  patterns!: SetSchedulePatternDto[];
}

// ---------------------------------------------------------------------------
// Daily Work Plan
// ---------------------------------------------------------------------------

export class GenerateDailyPlanDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  'CLOCK_IN',
  'CLOCK_OUT',
  'BREAK_START',
  'BREAK_END',
  'OTHER',
] as const;

export class CreateAttendanceEventDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  eventTimestamp!: string;

  @IsIn(EVENT_TYPES)
  eventType!: (typeof EVENT_TYPES)[number];

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  externalEventId?: string;

  @IsOptional()
  @IsString()
  sourceSystem?: string;
}

export class InterpretAttendanceDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;
}

// ---------------------------------------------------------------------------
// Time Entry (manual)
// ---------------------------------------------------------------------------

export class CreateManualTimeEntryDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  workDate!: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsNumber()
  @Min(0)
  hours!: number;

  @IsString()
  timeCode!: string;
}

// ---------------------------------------------------------------------------
// Timesheet
// ---------------------------------------------------------------------------

export class GenerateTimesheetDto {
  /** Set by the controller from the `:organizationId` route param — never
   * required in the request body. */
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsArray()
  @IsString({ each: true })
  employmentIds!: string[];
}

export class SubmitTimesheetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ApproveTimesheetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class LockTimesheetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ReopenTimesheetDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  reason!: string;
}

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------

export class CreateOvertimeRequestDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  date!: string;

  @IsNumber()
  @Min(0)
  requestedHours!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveOvertimeDto {
  @IsNumber()
  @Min(0)
  approvedHours!: number;
}

// ---------------------------------------------------------------------------
// Time Correction
// ---------------------------------------------------------------------------

export class CreateTimeCorrectionDto {
  @IsString()
  employmentId!: string;

  @IsDateString()
  workDate!: string;

  @IsOptional()
  @IsString()
  originalTimeEntryId?: string;

  @IsOptional()
  @IsString()
  correctedTimeCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  correctedHours?: number;

  @IsString()
  reason!: string;
}

// ---------------------------------------------------------------------------
// Work Time Period
// ---------------------------------------------------------------------------

export class OpenWorkTimePeriodDto {
  /** Set by the controller from the `:organizationId` route param — never
   * required in the request body. */
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

export class ReopenWorkTimePeriodDto {
  @IsString()
  reason!: string;
}

// ---------------------------------------------------------------------------
// Payroll Time Input
// ---------------------------------------------------------------------------

export class GeneratePayrollTimeInputDto {
  /** Set by the controller from the `:organizationId` route param — never
   * required in the request body. */
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsDateString()
  payrollPeriodStart!: string;

  @IsDateString()
  payrollPeriodEnd!: string;
}
