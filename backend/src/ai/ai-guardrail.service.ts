import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { WorkflowConditionService, ConditionNode } from '../workflow/workflow-condition.service';

export type GuardrailStage = 'INPUT' | 'TOOL' | 'OUTPUT' | 'ACTION';

/**
 * AIGuardrailService (docx spec Phase 29, sections 108-116). Reuses
 * Phase 26's `WorkflowConditionService` safe boolean DSL to express
 * guardrail rules (`AIGuardrailPolicy.rules` is a `ConditionNode[]`) —
 * a third safe expression evaluator was not built. Every rule failing
 * against the current context BLOCKS (guardrails are deny-list checks:
 * a "forbidden pattern detected" rule that evaluates true is a FAILURE,
 * recorded and enforced by the caller — see
 * `AIInteractionService.runGuardrails`).
 */
@Injectable()
export class AIGuardrailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly condition: WorkflowConditionService,
  ) {}

  createPolicy(tenantId: string, input: { code: string; stage: GuardrailStage; capabilityCode?: string; rules: ConditionNode[] }) {
    input.rules.forEach((r) => this.condition.validate(r));
    return this.prisma.aIGuardrailPolicy.create({ data: { tenantId, code: input.code, stage: input.stage, capabilityCode: input.capabilityCode, rules: input.rules as unknown as object } });
  }

  async evaluate(tenantId: string, interactionId: string, stage: GuardrailStage, capabilityCode: string, context: Record<string, unknown>, tx?: PrismaTransactionClient): Promise<{ passed: boolean; failures: string[] }> {
    const client = tx ?? this.prisma;
    const policies = await client.aIGuardrailPolicy.findMany({ where: { tenantId, stage, active: true, OR: [{ capabilityCode: null }, { capabilityCode }] } });

    const failures: string[] = [];
    for (const policy of policies) {
      const rules = (policy.rules as unknown as ConditionNode[]) ?? [];
      // A rule describes a FORBIDDEN condition (e.g. "field 'text'
      // contains injection pattern") — it evaluating true is a failure.
      const triggered = rules.some((r) => this.condition.evaluate(r, context));
      const passed = !triggered;
      await client.aIGuardrailResult.create({ data: { tenantId, interactionId, policyId: policy.id, stage, passed, reason: passed ? undefined : `Policy '${policy.code}' triggered` } });
      if (!passed) failures.push(policy.code);
    }
    return { passed: failures.length === 0, failures };
  }
}
