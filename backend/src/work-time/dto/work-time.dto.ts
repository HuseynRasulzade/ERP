import { IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateCalendarDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsString() localizationCode?: string;
  @IsInt() year!: number;
  @IsString() name!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsString() supersedesId?: string;
}

export class SetCalendarDayDto {
  @IsISO8601() date!: string;
  @IsIn(['WORKDAY', 'WEEKEND', 'HOLIDAY', 'SHORTENED_WORKDAY', 'TRANSFERRED_WORKDAY', 'NON_WORKING_DAY']) dayType!: string;
  @IsOptional() @IsNumber() defaultWorkingHours?: number;
  @IsOptional() @IsString() holidayCode?: string;
  @IsOptional() @IsNumber() shortenedByHours?: number;
  @IsOptional() @IsISO8601() transferredFromDate?: string;
  @IsOptional() @IsISO8601() transferredToDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateScheduleTemplateDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsIn(['STANDARD_WEEK', 'SHIFT', 'ROTATING', 'FLEXIBLE', 'PART_TIME', 'CUSTOM']) scheduleType!: string;
  @IsOptional() @IsInt() cycleLengthDays?: number;
  @IsOptional() @IsNumber() defaultWeeklyHours?: number;
  @IsOptional() @IsBoolean() usesProductionCalendar?: boolean;
  @IsOptional() @IsBoolean() fteAppliesToHours?: boolean;
}

export class CreateShiftTemplateDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  @IsOptional() @IsInt() breakMinutes?: number;
  @IsNumber() plannedHours!: number;
  @IsOptional() @IsBoolean() crossesMidnight?: boolean;
}

export class AddSchedulePatternDto {
  @IsInt() cycleDay!: number;
  @IsOptional() @IsString() workStartTime?: string;
  @IsOptional() @IsString() workEndTime?: string;
  @IsOptional() @IsInt() breakMinutes?: number;
  @IsOptional() @IsNumber() plannedHours?: number;
  @IsOptional() @IsBoolean() crossesMidnight?: boolean;
  @IsOptional() @IsString() shiftTemplateId?: string;
  @IsOptional() @IsIn(['WORKDAY', 'OFF']) dayType?: string;
}

export class GeneratePlanDto {
  @IsString() employmentId!: string;
  @IsISO8601() dateFrom!: string;
  @IsISO8601() dateTo!: string;
}

export class RecordAttendanceEventDto {
  @IsString() employmentId!: string;
  @IsISO8601() eventTimestamp!: string;
  @IsIn(['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END', 'OTHER']) eventType!: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() sourceSystem?: string;
  @IsOptional() @IsString() externalEventId?: string;
}

export class InterpretDayDto {
  @IsString() employmentId!: string;
  @IsISO8601() workDate!: string;
}

export class GenerateEntriesFromAttendanceDto {
  @IsString() employmentId!: string;
  @IsISO8601() workDate!: string;
}

export class CreateManualTimeEntryDto {
  @IsString() employmentId!: string;
  @IsISO8601() workDate!: string;
  @IsNumber() hours!: number;
  @IsString() timeCode!: string;
  @IsOptional() @IsNumber() nightHours?: number;
  @IsOptional() @IsNumber() holidayHours?: number;
  @IsOptional() @IsNumber() weekendHours?: number;
}

export class RequestOvertimeDto {
  @IsString() employmentId!: string;
  @IsISO8601() date!: string;
  @IsNumber() @IsPositive() requestedHours!: number;
  @IsOptional() @IsString() reason?: string;
}

export class ApproveOvertimeDto {
  @IsNumber() @IsPositive() approvedHours!: number;
}

export class CreateCorrectionDto {
  @IsString() employmentId!: string;
  @IsISO8601() workDate!: string;
  @IsOptional() @IsString() originalTimeEntryId?: string;
  @IsString() timeCodeCode!: string;
  @IsNumber() hours!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() comment?: string;
}

export class GenerateTimesheetDto {
  @IsOptional() @IsString() departmentId?: string;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}

export class ReopenTimesheetDto {
  @IsString() reason!: string;
}

export class CreateTimeCodeDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsBoolean() countsAsWorkedTime?: boolean;
  @IsOptional() @IsBoolean() countsAsPaidTime?: boolean;
  @IsOptional() @IsString() payrollCode?: string;
  @IsOptional() @IsBoolean() requiresDocument?: boolean;
  @IsOptional() @IsInt() overlapPriority?: number;
  @IsOptional() @IsBoolean() affectsFte?: boolean;
  @IsOptional() @IsString() accountingCategory?: string;
}
