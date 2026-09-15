import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';

import { PhysicalPersonService } from './physical-person.service';
import { EmployeeService } from './employee.service';
import { PositionService } from './position.service';
import { StaffingService } from './staffing.service';
import { EmployeeAssignmentService } from './employee-assignment.service';
import { EmploymentContractService } from './employment-contract.service';

import { HireRepository } from './hire.repository';
import { HirePostingHandler } from './hire.posting-handler';
import { HireService } from './hire.service';

import { EmployeeTransferRepository } from './employee-transfer.repository';
import { EmployeeTransferPostingHandler } from './employee-transfer.posting-handler';
import { EmployeeTransferService } from './employee-transfer.service';

import { TerminationRepository } from './termination.repository';
import { TerminationPostingHandler } from './termination.posting-handler';
import { TerminationService } from './termination.service';

import { WorkScheduleAssignmentService } from './work-schedule-assignment.service';
import { LeaveService } from './leave.service';
import { EmployeeAttributeHistoryService } from './employee-attribute-history.service';
import { HRReportingService } from './hr-reporting.service';
import { HRHealthService } from './hr-health.service';

import { HRController } from './hr.controller';

/**
 * HR Core Engine (docx spec Phase 17). See docs/HR_CORE.md. No dependency
 * on AccountingCoreModule — HR "posting" never produces a GL consequence
 * in this build (spec section 65).
 */
@Module({
  imports: [DocumentFrameworkModule, NumberingModule, AuditModule, OrgStructureModule],
  controllers: [HRController],
  providers: [
    PhysicalPersonService,
    EmployeeService,
    PositionService,
    StaffingService,
    EmployeeAssignmentService,
    EmploymentContractService,

    HireRepository,
    HirePostingHandler,
    HireService,

    EmployeeTransferRepository,
    EmployeeTransferPostingHandler,
    EmployeeTransferService,

    TerminationRepository,
    TerminationPostingHandler,
    TerminationService,

    WorkScheduleAssignmentService,
    LeaveService,
    EmployeeAttributeHistoryService,
    HRReportingService,
    HRHealthService,
  ],
  exports: [EmployeeAssignmentService, EmployeeService, PhysicalPersonService],
})
export class HRModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly hireRepository: HireRepository,
    private readonly hireHandler: HirePostingHandler,
    private readonly transferRepository: EmployeeTransferRepository,
    private readonly transferHandler: EmployeeTransferPostingHandler,
    private readonly terminationRepository: TerminationRepository,
    private readonly terminationHandler: TerminationPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.hireRepository);
    this.registry.registerHandler(this.hireHandler);
    this.registry.registerRepository(this.transferRepository);
    this.registry.registerHandler(this.transferHandler);
    this.registry.registerRepository(this.terminationRepository);
    this.registry.registerHandler(this.terminationHandler);
  }
}
