import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { canonicalJson } from '../audit/audit-canonical-json.util';
import { AIToolRegistryService } from './ai-tool-registry.service';
import { AIAssistantDefinitionService } from './ai-assistant-definition.service';

/**
 * AIToolInvocationService (docx spec Phase 29, sections 35-40, 95-96).
 * `invokeRead`/`invokePropose` are the ONLY entry points the assistant-
 * facing flow may call — `DOMAIN_ACTION`-type tools are explicitly
 * rejected here (spec section 40: "Domain Action Tool: normally not
 * directly callable by model unless controlled execution flow has
 * already approved it" — that controlled flow is
 * `AIActionProposalService.execute`, a completely separate method that
 * never goes through this invocation path).
 */
@Injectable()
export class AIToolInvocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: AIToolRegistryService,
    private readonly assistants: AIAssistantDefinitionService,
  ) {}

  async invoke(
    tenantId: string,
    interactionId: string,
    assistantCode: string,
    toolCode: string,
    capabilityCode: string,
    input: Record<string, unknown>,
    context: { userId: string; organizationId?: string },
    hasPermission: (code: string) => boolean,
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    await this.assistants.assertToolAllowed(tenantId, assistantCode, toolCode);
    const definition = await this.registry.getDefinition(tenantId, toolCode);

    if (definition.toolType === 'DOMAIN_ACTION') {
      throw new ValidationAppError(`Tool '${toolCode}' is a DOMAIN_ACTION tool and cannot be invoked directly — it is only reachable via an approved AIActionProposal execution`);
    }

    this.registry.validateAndAuthorize(definition, capabilityCode, input, hasPermission, definition.toolType === 'PROPOSAL' ? 'PROPOSE' : 'READ');

    const handler = this.registry.getHandler(toolCode);
    if (!handler) throw new ValidationAppError(`No handler registered for tool '${toolCode}'`);

    const inputHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
    const startedAt = new Date();
    let result: Awaited<ReturnType<typeof handler.execute>> | undefined;
    let error: string | undefined;

    try {
      result = await handler.execute(tenantId, input, context, tx);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const invocation = await client.aIToolInvocation.create({
      data: {
        tenantId,
        interactionId,
        toolId: definition.id,
        inputHash,
        input: input as object,
        startedAt,
        completedAt: new Date(),
        resultReference: result?.sourceReference,
        success: !error,
        error,
        mutationType: definition.toolType === 'PROPOSAL' ? 'PROPOSAL' : 'NONE',
      },
    });

    if (definition.toolType !== 'READ' || error) {
      await this.audit.record({ tenantId, eventType: 'MessageReceived', eventCategory: 'AI', entityType: 'AIToolInvocation', entityId: invocation.id, operation: 'READ', action: error ? 'FAILED' : 'SUCCESS', userId: context.userId, metadata: { toolCode, capabilityCode } }, tx);
    }

    if (error) throw new ValidationAppError(`Tool '${toolCode}' failed: ${error}`);
    return { invocation, result: result! };
  }
}
