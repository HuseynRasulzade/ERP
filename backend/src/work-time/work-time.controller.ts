import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ProductionCalendarService } from './production-calendar.service';
import { WorkScheduleService } from './work-schedule.service';
import { TimeCodeService } from './time-code.service';
import { DailyWorkPlanService } from './daily-work-plan.service';
import { AttendanceService } from './attendance.service';
import { TimeEntryService } from './time-entry.service';
import { OvertimeService } from './overtime.service';
import { TimeCorrectionService } from './time-correction.service';
import { TimesheetService } from './timesheet.service';
import { PayrollTimeInputService } from './payroll-time-input.service';
import { WorkTimeReportingService } from './work-time-reporting.service';
import { WorkTimeHealthService } from './work-time-health.service';
import {
  CreateCalendarDto,
  SetCalendarDayDto,
  CreateScheduleTemplateDto,
  CreateShiftTemplateDto,
  AddSchedulePatternDto,
  GeneratePlanDto,
  RecordAttendanceEventDto,
  InterpretDayDto,
  GenerateEntriesFromAttendanceDto,
  CreateManualTimeEntryDto,
  RequestOvertimeDto,
  ApproveOvertimeDto,
  CreateCorrectionDto,
  GenerateTimesheetDto,
  ReopenTimesheetDto,
  CreateTimeCodeDto,
} from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Work Time / Timesheet API (docx spec Phase 18). See docs/WORK_TIME.md. */
@Controller('organizations/:organizationId/work-time')
export class WorkTimeController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly calendars: ProductionCalendarService,
    private readonly schedules: WorkScheduleService,
    private readonly timeCodes: TimeCodeService,
    private readonly dailyPlans: DailyWorkPlanService,
    private readonly attendance: AttendanceService,
    private readonly timeEntries: TimeEntryService,
    private readonly overtime: OvertimeService,
    private readonly corrections: TimeCorrectionService,
    private readonly timesheets: TimesheetService,
    private readonly payrollInputs: PayrollTimeInputService,
    private readonly reporting: WorkTimeReportingService,
    private readonly health: WorkTimeHealthService,
  ) {}

  // --- Time codes ---
  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post('time-codes/seed-defaults')
  async seedTimeCodes(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }) {
    return this.timeCodes.seedDefaults(tenantId, user.userId);
  }

  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post('time-codes')
  createTimeCode(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateTimeCodeDto) {
    return this.timeCodes.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('time-codes')
  listTimeCodes(@CurrentTenantId() tenantId: string) {
    return this.timeCodes.list(tenantId);
  }

  // --- Production calendar ---
  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post('calendars')
  createCalendar(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCalendarDto) {
    return this.calendars.createCalendar(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_CALENDAR_EDIT)
  @Post('calendars/:id/days')
  setCalendarDay(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: SetCalendarDayDto) {
    return this.calendars.setDay(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('calendars')
  listCalendars(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.calendars.list(tenantId, organizationId);
  }

  // --- Schedules ---
  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post('schedule-templates')
  createScheduleTemplate(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateScheduleTemplateDto) {
    return this.schedules.createTemplate(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post('shift-templates')
  createShiftTemplate(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateShiftTemplateDto) {
    return this.schedules.createShiftTemplate(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post('schedule-templates/:id/patterns')
  addPattern(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: AddSchedulePatternDto) {
    return this.schedules.addPattern(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('schedule-templates')
  listScheduleTemplates(@CurrentTenantId() tenantId: string) {
    return this.schedules.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('schedule-templates/:id')
  getScheduleTemplate(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.schedules.getTemplateWithPatterns(tenantId, id);
  }

  // --- Daily work plan ---
  @RequirePermissions(PermissionCodes.TIME_SCHEDULE_EDIT)
  @Post('daily-plans/generate')
  generatePlan(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: GeneratePlanDto) {
    return this.dailyPlans.generate(tenantId, user.userId, dto.employmentId, new Date(dto.dateFrom), new Date(dto.dateTo));
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('employments/:employmentId/daily-plans')
  getPlan(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string, @Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    return this.dailyPlans.getPlan(tenantId, employmentId, new Date(dateFrom), new Date(dateTo));
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('employments/:employmentId/monthly-norm')
  monthlyNorm(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string, @Query('month') month: string) {
    return this.dailyPlans.monthlyNorm(tenantId, employmentId, new Date(`${month}-01T00:00:00.000Z`));
  }

  // --- Attendance ---
  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_IMPORT)
  @Post('attendance-events')
  recordEvent(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordAttendanceEventDto) {
    return this.attendance.recordEvent(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('attendance-intervals/interpret')
  interpretDay(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: InterpretDayDto) {
    return this.attendance.interpretDay(tenantId, user.userId, dto.employmentId, new Date(dto.workDate));
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('attendance-intervals/:id/review')
  reviewInterval(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.attendance.reviewInterval(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('attendance-exceptions')
  listExceptions(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId?: string) {
    return this.attendance.listExceptions(tenantId, employmentId);
  }

  // --- Time entries ---
  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('time-entries/from-attendance')
  generateEntriesFromAttendance(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: GenerateEntriesFromAttendanceDto) {
    return this.timeEntries.generateFromAttendance(tenantId, user.userId, dto.employmentId, new Date(dto.workDate));
  }

  @RequirePermissions(PermissionCodes.TIME_ATTENDANCE_EDIT)
  @Post('time-entries')
  createManualEntry(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateManualTimeEntryDto) {
    return this.timeEntries.createManual(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('employments/:employmentId/time-entries')
  listTimeEntries(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string, @Query('dateFrom') dateFrom: string, @Query('dateTo') dateTo: string) {
    return this.timeEntries.list(tenantId, employmentId, new Date(dateFrom), new Date(dateTo));
  }

  // --- Overtime ---
  @RequirePermissions(PermissionCodes.TIME_OVERTIME_CREATE)
  @Post('overtime')
  requestOvertime(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: RequestOvertimeDto) {
    return this.overtime.request(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_OVERTIME_APPROVE)
  @Post('overtime/:id/approve')
  approveOvertime(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ApproveOvertimeDto) {
    return this.overtime.approve(tenantId, user.userId, id, dto.approvedHours);
  }

  @RequirePermissions(PermissionCodes.TIME_OVERTIME_APPROVE)
  @Post('overtime/:id/reject')
  rejectOvertime(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('reason') reason?: string) {
    return this.overtime.reject(tenantId, user.userId, id, reason);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('overtime')
  listOvertime(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId?: string, @Query('status') status?: string) {
    return this.overtime.list(tenantId, employmentId, status);
  }

  // --- Corrections ---
  @RequirePermissions(PermissionCodes.TIME_CORRECTION_CREATE)
  @Post('corrections')
  createCorrection(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateCorrectionDto) {
    return this.corrections.correct(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('corrections')
  listCorrections(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId?: string) {
    return this.corrections.list(tenantId, employmentId);
  }

  // --- Timesheets ---
  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_CREATE)
  @Post('timesheets/generate')
  generateTimesheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: GenerateTimesheetDto) {
    return this.timesheets.generate(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_EDIT)
  @Post('timesheets/:id/submit')
  submitTimesheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.timesheets.submit(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_APPROVE)
  @Post('timesheets/:id/approve')
  approveTimesheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.timesheets.approve(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_LOCK)
  @Post('timesheets/:id/lock')
  lockTimesheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.timesheets.lock(tenantId, membershipId, organizationId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_REOPEN)
  @Post('timesheets/:id/reopen')
  reopenTimesheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ReopenTimesheetDto) {
    return this.timesheets.reopen(tenantId, membershipId, organizationId, user.userId, id, dto.reason);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('timesheets')
  listTimesheets(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.timesheets.list(tenantId, membershipId, organizationId);
  }

  // --- Payroll time input ---
  @RequirePermissions(PermissionCodes.TIME_VIEW_PAYROLL_INPUT)
  @Post('payroll-inputs/generate/:timesheetId')
  generatePayrollInput(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('timesheetId') timesheetId: string, @CurrentUser() user: { userId: string }) {
    return this.payrollInputs.generate(tenantId, membershipId, organizationId, user.userId, timesheetId);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_PAYROLL_INPUT)
  @Post('payroll-inputs/validate')
  validatePayrollInput(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('payrollPeriod') payrollPeriod: string) {
    return this.payrollInputs.validate(tenantId, membershipId, organizationId, user.userId, payrollPeriod);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_PAYROLL_INPUT)
  @Post('payroll-inputs/approve')
  approvePayrollInput(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('payrollPeriod') payrollPeriod: string) {
    return this.payrollInputs.approve(tenantId, membershipId, organizationId, user.userId, payrollPeriod);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_PAYROLL_INPUT)
  @Post('payroll-inputs/lock')
  lockPayrollInput(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body('payrollPeriod') payrollPeriod: string) {
    return this.payrollInputs.lock(tenantId, membershipId, organizationId, user.userId, payrollPeriod);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_PAYROLL_INPUT)
  @Get('payroll-inputs')
  listPayrollInputs(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('payrollPeriod') payrollPeriod?: string) {
    return this.payrollInputs.list(tenantId, membershipId, organizationId, payrollPeriod);
  }

  // --- Reports / health ---
  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('reports/norm-vs-actual/:timesheetId')
  normVsActual(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('timesheetId') timesheetId: string) {
    return this.reporting.normVsActual(tenantId, membershipId, organizationId, timesheetId);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('reports/timesheet-summary/:timesheetId')
  timesheetSummary(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('timesheetId') timesheetId: string) {
    return this.reporting.timesheetSummary(tenantId, membershipId, organizationId, timesheetId);
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }

  // --- Single-timesheet-by-id lookup stays last to avoid shadowing the
  // literal routes above (same NestJS routing-order caveat noted in
  // FixedAssetController). ---
  @RequirePermissions(PermissionCodes.TIME_VIEW)
  @Get('timesheets/:id')
  getTimesheet(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.timesheets.get(tenantId, membershipId, organizationId, id);
  }
}
