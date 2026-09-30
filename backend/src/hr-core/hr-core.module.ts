import { Module, OnModuleInit } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ApprovalPlanRegistryService } from '../approvals/approval-plan-registry.service';

import { PositionService } from './position.service';
import { PositionController } from './position.controller';

import { PhysicalPersonService } from './physical-person.service';
import { PhysicalPersonController } from './physical-person.controller';

import { EmployeeService } from './employee.service';
import { EmployeeController } from './employee.controller';

import { StaffingTableService } from './staffing-table.service';
import { StaffingTableController } from './staffing-table.controller';

import { HireDocumentService } from './hire-document.service';
import { HireDocumentController } from './hire-document.controller';

import { EmploymentService } from './employment.service';
import { EmploymentController } from './employment.controller';

import { EmploymentContractService } from './employment-contract.service';
import { EmploymentContractController } from './employment-contract.controller';

import { EmployeeTransferService } from './employee-transfer.service';
import { EmployeeTransferController } from './employee-transfer.controller';

import { WorkScheduleAssignmentService } from './work-schedule-assignment.service';
import { LeaveRecordService } from './leave-record.service';
import { AbsenceRecordService } from './absence-record.service';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveBalanceService } from './leave-balance.service';
import { LeaveAccrualRunService } from './leave-accrual-run.service';
import { HrTimeOffController } from './hr-time-off.controller';

import { TerminationDocumentService } from './termination-document.service';
import { TerminationDocumentController } from './termination-document.controller';

import { HrReportingService } from './hr-reporting.service';
import { HrHealthService } from './hr-health.service';
import { HrReportingController } from './hr-reporting.controller';

import { HireDocumentApprovalPlanProvider } from './hire-document-approval-plan.provider';
import { EmployeeTransferApprovalPlanProvider } from './employee-transfer-approval-plan.provider';
import { TerminationDocumentApprovalPlanProvider } from './termination-document-approval-plan.provider';

/**
 * HR Core / Employment Lifecycle Engine (docx spec Phase 17) — Physical
 * Person -> Employee -> Hire Document -> Employment (+ effective-dated
 * Assignment/Status history) -> Transfer/Termination. See
 * docs/HR_CORE.md for the full architecture and disclosed simplifications.
 * No GL posting: HR Core is not a document-framework participant.
 */
@Module({
  imports: [NumberingModule, AuditModule, OrgStructureModule, ApprovalsModule],
  controllers: [
    PositionController,
    PhysicalPersonController,
    EmployeeController,
    StaffingTableController,
    HireDocumentController,
    EmploymentController,
    EmploymentContractController,
    EmployeeTransferController,
    HrTimeOffController,
    TerminationDocumentController,
    HrReportingController,
  ],
  providers: [
    PositionService,
    PhysicalPersonService,
    EmployeeService,
    StaffingTableService,
    HireDocumentService,
    EmploymentService,
    EmploymentContractService,
    EmployeeTransferService,
    WorkScheduleAssignmentService,
    LeaveRecordService,
    AbsenceRecordService,
    LeavePolicyService,
    LeaveBalanceService,
    LeaveAccrualRunService,
    TerminationDocumentService,
    HrReportingService,
    HrHealthService,
    HireDocumentApprovalPlanProvider,
    EmployeeTransferApprovalPlanProvider,
    TerminationDocumentApprovalPlanProvider,
  ],
  exports: [EmploymentService, EmployeeService, PhysicalPersonService],
})
export class HrCoreModule implements OnModuleInit {
  constructor(
    private readonly approvalPlanRegistry: ApprovalPlanRegistryService,
    private readonly hireApprovalPlan: HireDocumentApprovalPlanProvider,
    private readonly transferApprovalPlan: EmployeeTransferApprovalPlanProvider,
    private readonly terminationApprovalPlan: TerminationDocumentApprovalPlanProvider,
  ) {}

  onModuleInit() {
    this.approvalPlanRegistry.register(this.hireApprovalPlan);
    this.approvalPlanRegistry.register(this.transferApprovalPlan);
    this.approvalPlanRegistry.register(this.terminationApprovalPlan);
  }
}
