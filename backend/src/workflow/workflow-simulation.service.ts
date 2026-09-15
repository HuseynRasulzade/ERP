import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowConditionService, ConditionNode } from './workflow-condition.service';
import { ApproverResolutionService, ApproverResolutionContext } from './approver-resolution.service';

export interface SimulatedStep {
  stepCode: string;
  name: string;
  stage: number;
  applies: boolean;
  conditionSummary?: string;
  executionMode: string;
  resolvedApprovers: string[];
  sodIssues: string[];
}

/**
 * WorkflowSimulationService (docx spec Phase 26, sections 91, 143-144,
 * 205). `simulate` runs the SAME condition-evaluation and approver-
 * resolution logic `WorkflowInstanceService.start` uses — reused via
 * both injected services — but creates NO `WorkflowInstance` row and no
 * `ApproverAssignment` rows, so a workflow designer can preview a route
 * before ever activating a version (spec section 91's own
 * `simulateWorkflow(context)`).
 */
@Injectable()
export class WorkflowSimulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly definitions: WorkflowDefinitionService,
    private readonly condition: WorkflowConditionService,
    private readonly approverResolution: ApproverResolutionService,
  ) {}

  async simulate(tenantId: string, workflowDefinitionCode: string, organizationId: string, context: ApproverResolutionContext & Record<string, unknown>, asOfDate = new Date()) {
    const definition = await this.prisma.workflowDefinition.findFirstOrThrow({ where: { tenantId, code: workflowDefinitionCode } });
    const version = await this.definitions.resolveActiveVersion(tenantId, definition.id, organizationId, asOfDate);
    const steps = await this.prisma.workflowStepDefinition.findMany({ where: { tenantId, workflowVersionId: version.id }, orderBy: [{ stage: 'asc' }, { sequence: 'asc' }], include: { approverRule: true } });

    const trustedContext = { ...context, organizationId, businessDate: asOfDate };
    const results: SimulatedStep[] = [];
    for (const step of steps) {
      const applies = !step.conditionExpression || this.condition.evaluate(step.conditionExpression as unknown as ConditionNode, context);
      const resolved = applies ? await this.approverResolution.resolve(tenantId, step.approverRule, trustedContext) : [];
      results.push({
        stepCode: step.stepCode,
        name: step.name,
        stage: step.stage,
        applies,
        conditionSummary: step.conditionExpression ? JSON.stringify(step.conditionExpression) : undefined,
        executionMode: step.executionMode,
        resolvedApprovers: resolved.map((r) => r.userId),
        sodIssues: resolved.length === 0 && applies ? [`No approver could be resolved for rule ${step.approverRule.code}`] : [],
      });
    }
    return { workflowVersionId: version.id, version: version.version, steps: results };
  }
}
