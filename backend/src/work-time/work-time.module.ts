import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { NumberingModule } from '../numbering/numbering.module';

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

import { WorkTimeController } from './work-time.controller';

/**
 * Work Time / Timesheet Engine (docx spec Phase 18). See
 * docs/WORK_TIME.md. No dependency on DocumentFrameworkModule — nothing
 * here is a DocumentFramework document (Timesheet's own DRAFT->LOCKED
 * lifecycle is managed directly by TimesheetService, mirroring
 * `FixedAssetDepreciationRun`'s own custom calculate/post flow rather
 * than the generic document post/unpost contract, since a timesheet
 * covers many employments/dates at once, not a single document).
 */
@Module({
  imports: [AuditModule, OrgStructureModule, NumberingModule],
  controllers: [WorkTimeController],
  providers: [
    ProductionCalendarService,
    WorkScheduleService,
    TimeCodeService,
    DailyWorkPlanService,
    AttendanceService,
    TimeEntryService,
    OvertimeService,
    TimeCorrectionService,
    TimesheetService,
    PayrollTimeInputService,
    WorkTimeReportingService,
    WorkTimeHealthService,
  ],
  exports: [PayrollTimeInputService, ProductionCalendarService, DailyWorkPlanService],
})
export class WorkTimeModule {}
