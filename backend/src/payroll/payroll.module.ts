import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgStructureModule } from '../org-structure/org-structure.module';
import { WorkTimeModule } from '../work-time/work-time.module';
import { HrCoreModule } from '../hr-core/hr-core.module';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { NumberingModule } from '../numbering/numbering.module';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';

import { PayrollPeriodService } from './payroll-period.service';
import { PayrollPeriodController } from './payroll-period.controller';
import { PayrollCloseService } from './payroll-close.service';

import { PayrollEligibilityService } from './payroll-eligibility.service';

import { CompensationService } from './compensation.service';
import { CompensationController } from './compensation.controller';

import { PayrollCatalogService } from './payroll-catalog.service';
import { PayrollLegalRulesService } from './payroll-legal-rules.service';
import { PayrollTaxProfileService } from './payroll-tax-profile.service';
import { PayrollSetupController } from './payroll-setup.controller';

import { PayrollInputService } from './payroll-input.service';
import { EarningCalculationService } from './earning-calculation.service';

import { AverageEarningsService } from './average-earnings.service';
import { PayrollVariableInputService } from './payroll-variable-input.service';
import { PayrollVariableInputController } from './payroll-variable-input.controller';

import { PayrollExecutionOrderService } from './payroll-execution-order.service';
import { PayrollExecutionOrderController } from './payroll-execution-order.controller';
import { GrossToNetService } from './gross-to-net.service';

import { PayrollCalculationEngine } from './payroll-calculation.engine';
import { PayrollCalculationController } from './payroll-calculation.controller';

import { PayrollRecalculationService } from './payroll-recalculation.service';
import {
  PayrollRecalculationController,
  PayrollRecalculationProcessController,
} from './payroll-recalculation.controller';

import { PayrollLiabilityService } from './payroll-liability.service';
import { PayrollPostingRepository } from './payroll-posting.repository';
import { PayrollPostingHandler } from './payroll-posting.handler';
import { PayrollPostingService } from './payroll-posting.service';
import { PayrollPostingController } from './payroll-posting.controller';

import { PayrollPaymentBatchService } from './payroll-payment-batch.service';
import {
  PayrollPaymentBatchController,
  PayrollPaymentBatchLookupController,
} from './payroll-payment-batch.controller';

import { PayrollReportingService } from './payroll-reporting.service';
import { PayrollHealthService } from './payroll-health.service';
import { PayrollReportingController } from './payroll-reporting.controller';

/**
 * Payroll / Gross-to-Net Engine (docx spec Phase 19) — Payroll Period ->
 * Effective-Dated Compensation -> Phase 18 Payroll Input -> Earning
 * Calculation (base/overtime/night/holiday/leave average/bonus) ->
 * Gross-to-Net (tax/social/unemployment/medical, execution orders) ->
 * Payroll Calculation Result/Lines. See docs/PAYROLL.md for the full
 * architecture and disclosed simplifications.
 */
@Module({
  imports: [
    AuditModule,
    OrgStructureModule,
    WorkTimeModule,
    HrCoreModule,
    DocumentFrameworkModule,
    NumberingModule,
    AccountingCoreModule,
  ],
  controllers: [
    PayrollPeriodController,
    CompensationController,
    PayrollSetupController,
    PayrollVariableInputController,
    PayrollExecutionOrderController,
    PayrollCalculationController,
    PayrollRecalculationController,
    PayrollRecalculationProcessController,
    PayrollPostingController,
    PayrollPaymentBatchController,
    PayrollPaymentBatchLookupController,
    PayrollReportingController,
  ],
  providers: [
    PayrollPeriodService,
    PayrollEligibilityService,
    CompensationService,
    PayrollCatalogService,
    PayrollLegalRulesService,
    PayrollTaxProfileService,
    PayrollInputService,
    EarningCalculationService,
    AverageEarningsService,
    PayrollVariableInputService,
    PayrollExecutionOrderService,
    GrossToNetService,
    PayrollCalculationEngine,
    PayrollRecalculationService,
    PayrollLiabilityService,
    PayrollPostingRepository,
    PayrollPostingHandler,
    PayrollPostingService,
    PayrollPaymentBatchService,
    PayrollCloseService,
    PayrollReportingService,
    PayrollHealthService,
  ],
  exports: [PayrollPeriodService, PayrollCalculationEngine, PayrollLiabilityService],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentFrameworkRegistry,
    private readonly postingRepository: PayrollPostingRepository,
    private readonly postingHandler: PayrollPostingHandler,
  ) {}

  onModuleInit() {
    this.registry.registerRepository(this.postingRepository);
    this.registry.registerHandler(this.postingHandler);
  }
}
