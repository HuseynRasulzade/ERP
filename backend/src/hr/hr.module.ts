import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { DocumentLinkModule } from '../document-link/document-link.module';
import { SettingsModule } from '../settings/settings.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';

import { HrPolicyService } from './hr-policy.service';
import { HrEventService } from './hr-event.service';
import { HrSecurityService } from './hr-security.service';
import { HrNumberingService } from './hr-numbering.service';
import { HrHistoryService } from './hr-history.service';
import { HrValidationService } from './hr-validation.service';
import { HrDocumentLifecycleService } from './hr-document-lifecycle.service';
import { PhysicalPersonService } from './physical-person.service';
import { EmployeeService } from './employee.service';
import { EmploymentService, WorkScheduleAssignmentService } from './employment.service';
import { EmploymentContractService } from './employment-contract.service';
import { HrMasterDataService, StaffingService } from './staffing.service';
import { HireService } from './hire.service';
import { EmployeeTransferService } from './employee-transfer.service';
import { TerminationService } from './termination.service';
import { AbsenceService, LeaveFoundationService } from './leave-foundation.service';
import { HrReportingService } from './hr-reporting.service';
import { HrHealthService } from './hr-health.service';

import { HrPeopleController } from './hr-people.controller';
import { HrEmploymentController } from './hr-employment.controller';
import { HrDocumentsController } from './hr-documents.controller';
import { HrConfigController, HrReportsController } from './hr-config.controller';

/**
 * Phase 17 — HR Core / Kadr uçotu (docs/PHASE17_HR_CORE.md).
 *
 * Exports the downstream contract for Phase 18 (work time), 19 (payroll),
 * 20 (employee expenses) and 22 (month close):
 *  - HrHistoryService: getEmploymentState / getActiveEmployments /
 *    getDepartment / getPosition / getManager / getWorkSchedule / getFTE /
 *    validateEmploymentActive / getEffectiveSegments / getEmploymentsInPeriod
 *  - HrEventService: outbox read/ack + registerDownstreamProvider (backdated
 *    change recalculation & finalized-period blocking).
 */
@Module({
  imports: [AuditModule, NumberingModule, OrgStructureModule, DocumentLinkModule, SettingsModule, IdempotencyModule],
  controllers: [HrPeopleController, HrEmploymentController, HrDocumentsController, HrConfigController, HrReportsController],
  providers: [
    HrPolicyService,
    HrEventService,
    HrSecurityService,
    HrNumberingService,
    HrHistoryService,
    HrValidationService,
    HrDocumentLifecycleService,
    PhysicalPersonService,
    EmployeeService,
    EmploymentService,
    WorkScheduleAssignmentService,
    EmploymentContractService,
    HrMasterDataService,
    StaffingService,
    HireService,
    EmployeeTransferService,
    TerminationService,
    LeaveFoundationService,
    AbsenceService,
    HrReportingService,
    HrHealthService,
  ],
  exports: [HrHistoryService, HrEventService, EmploymentService],
})
export class HrModule {}
