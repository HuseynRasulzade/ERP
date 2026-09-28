import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { HrCoreModule } from '../hr-core/hr-core.module';

import { ProductionCalendarService } from './production-calendar.service';
import { ProductionCalendarController } from './production-calendar.controller';

import { WorkScheduleTemplateService } from './work-schedule-template.service';
import { WorkScheduleTemplateController } from './work-schedule-template.controller';

import { ShiftTemplateService } from './shift-template.service';
import { ShiftTemplateController } from './shift-template.controller';

import { DailyWorkPlanService } from './daily-work-plan.service';
import { DailyWorkPlanController } from './daily-work-plan.controller';

import { AttendanceEventService } from './attendance-event.service';
import { AttendanceInterpretationService } from './attendance-interpretation.service';
import { AttendanceController } from './attendance.controller';

import { TimeEntryService } from './time-entry.service';
import { TimeEntryController } from './time-entry.controller';

import { OvertimeService } from './overtime.service';
import { OvertimeController } from './overtime.controller';

import { WorkTimeRegisterService } from './work-time-register.service';

import { TimesheetService } from './timesheet.service';
import { TimesheetController } from './timesheet.controller';

import { TimeCorrectionService } from './time-correction.service';
import { TimeCorrectionController } from './time-correction.controller';

import { WorkTimePeriodService } from './work-time-period.service';
import { WorkTimePeriodController } from './work-time-period.controller';

import { PayrollTimeInputService } from './payroll-time-input.service';
import { PayrollTimeInputController } from './payroll-time-input.controller';

import { WorkTimeReportingService } from './work-time-reporting.service';
import { WorkTimeHealthService } from './work-time-health.service';
import { WorkTimeReportingController } from './work-time-reporting.controller';

/**
 * Work Time / Timesheet Engine (docx spec Phase 18) — Production Calendar +
 * Work Schedule Template -> Daily Work Plan -> Attendance -> Time Entry ->
 * Timesheet (plan vs actual, overtime/night/holiday/weekend classification)
 * -> WorkTimeRegister -> PayrollTimeInputRegister. See docs/WORK_TIME.md
 * for the full architecture and disclosed simplifications. No GL posting —
 * not a document-framework participant.
 */
@Module({
  imports: [AuditModule, OrgStructureModule, HrCoreModule],
  controllers: [
    ProductionCalendarController,
    WorkScheduleTemplateController,
    ShiftTemplateController,
    DailyWorkPlanController,
    AttendanceController,
    TimeEntryController,
    OvertimeController,
    TimesheetController,
    TimeCorrectionController,
    WorkTimePeriodController,
    PayrollTimeInputController,
    WorkTimeReportingController,
  ],
  providers: [
    ProductionCalendarService,
    WorkScheduleTemplateService,
    ShiftTemplateService,
    DailyWorkPlanService,
    AttendanceEventService,
    AttendanceInterpretationService,
    TimeEntryService,
    OvertimeService,
    WorkTimeRegisterService,
    TimesheetService,
    TimeCorrectionService,
    WorkTimePeriodService,
    PayrollTimeInputService,
    WorkTimeReportingService,
    WorkTimeHealthService,
  ],
  exports: [PayrollTimeInputService, WorkTimeRegisterService],
})
export class WorkTimeModule {}
