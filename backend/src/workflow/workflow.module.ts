import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { CurrencyModule } from '../currency/currency.module';

import { WorkflowConditionService } from './workflow-condition.service';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { ApproverResolutionService } from './approver-resolution.service';
import { ApprovalAuthorityService } from './approval-authority.service';
import { SegregationOfDutiesService } from './segregation-of-duties.service';
import { DelegationService } from './delegation.service';
import { WorkflowInstanceService } from './workflow-instance.service';
import { ApprovalDecisionService } from './approval-decision.service';
import { WorkflowReapprovalService } from './workflow-reapproval.service';
import { WorkflowSLAService } from './workflow-sla.service';
import { WorkflowEscalationService } from './workflow-escalation.service';
import { WorkflowExecutionGateService } from './workflow-execution-gate.service';
import { WorkflowCancellationService } from './workflow-cancellation.service';
import { WorkflowSimulationService } from './workflow-simulation.service';
import { WorkflowReportingService } from './workflow-reporting.service';
import { WorkflowHealthService } from './workflow-health.service';

import { WorkflowController } from './workflow.controller';

/**
 * Workflow / Approval / Execution-Gate Engine (docx spec Phase 26). See
 * docs/WORKFLOW_ENGINE.md. Imports `AuditTrailModule` for
 * `AuditDiffService` (material-change detection reuses Phase 25's own
 * diff engine, never a second one) and `CurrencyModule` for authority
 * currency normalization. Every other business phase (Treasury,
 * Expenses, Fixed Assets, Payroll, Period Close, Financial Reporting,
 * Production, ...) is expected to call `WorkflowInstanceService.start`/
 * `WorkflowExecutionGateService.assertExecutionAllowed` directly rather
 * than import this whole module's internals — deliberately NOT wired
 * into any prior phase's own posting handler in this build (spec
 * section 210's own "stable extension interfaces," not a retrofit of
 * every existing approval field across 25 phases — disclosed,
 * docs/WORKFLOW_ENGINE.md section G).
 */
@Module({
  imports: [AuditModule, AuditTrailModule, CurrencyModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowConditionService,
    WorkflowDefinitionService,
    ApproverResolutionService,
    ApprovalAuthorityService,
    SegregationOfDutiesService,
    DelegationService,
    WorkflowInstanceService,
    ApprovalDecisionService,
    WorkflowReapprovalService,
    WorkflowSLAService,
    WorkflowEscalationService,
    WorkflowExecutionGateService,
    WorkflowCancellationService,
    WorkflowSimulationService,
    WorkflowReportingService,
    WorkflowHealthService,
  ],
  exports: [WorkflowInstanceService, WorkflowExecutionGateService, WorkflowReapprovalService, WorkflowDefinitionService, WorkflowConditionService],
})
export class WorkflowModule {}
