import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { WorkTimeModule } from '../work-time/work-time.module';

import { PayrollRateBracketService } from './payroll-rate-bracket.service';
import { PayrollDefinitionsService } from './payroll-definitions.service';
import { EmployeeCompensationService } from './employee-compensation.service';
import { EmployeeTaxProfileService } from './employee-tax-profile.service';
import { PayrollVariableInputService } from './payroll-variable-input.service';
import { PayrollExecutionOrderService } from './payroll-execution-order.service';
import { AverageEarningsService } from './average-earnings.service';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollPostingService } from './payroll-posting.service';
import { PayrollLiabilityService } from './payroll-liability.service';
import { PayrollRecalculationService } from './payroll-recalculation.service';
import { PayrollCloseService } from './payroll-close.service';
import { PayrollReportingService } from './payroll-reporting.service';

import { PayrollController } from './payroll.controller';

/**
 * Payroll / Gross-to-Net Engine (docx spec Phase 19). See
 * docs/PAYROLL.md. Imports `WorkTimeModule` for
 * `PayrollTimeInputService`/`DailyWorkPlanService` (the ONLY Phase 18
 * inputs this engine reads, spec section 20) and `AccountingCoreModule`
 * for GL posting — no dependency on Settlement/Treasury/Cash (spec
 * sections 105-107's own "don't duplicate the bank/cash engine";
 * `PayrollLiabilityService.allocate` only RECORDS a reference to a
 * payment document created elsewhere).
 */
@Module({
  imports: [AuditModule, OrgStructureModule, AccountingCoreModule, WorkTimeModule],
  controllers: [PayrollController],
  providers: [
    PayrollRateBracketService,
    PayrollDefinitionsService,
    EmployeeCompensationService,
    EmployeeTaxProfileService,
    PayrollVariableInputService,
    PayrollExecutionOrderService,
    AverageEarningsService,
    PayrollPeriodService,
    PayrollCalculationService,
    PayrollPostingService,
    PayrollLiabilityService,
    PayrollRecalculationService,
    PayrollCloseService,
    PayrollReportingService,
  ],
  exports: [PayrollLiabilityService, PayrollRecalculationService, PayrollCloseService],
})
export class PayrollModule {}
