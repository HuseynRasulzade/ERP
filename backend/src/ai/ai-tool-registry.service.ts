import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, PermissionDeniedError } from '../common/errors/app-error';
import { IntegrationContractService, ContractSchema } from '../integration/integration-contract.service';

export type ToolType = 'READ' | 'PROPOSAL' | 'DOMAIN_ACTION';

/** A typed ERP function the model may call — never a generic SQL/query
 * tool (spec section 36). `inputSchema`/`outputSchema` reuse the same
 * closed schema shape as Phase 28's `IntegrationContractVersion.schema`
 * (validated by the SAME `IntegrationContractService.validatePayload`,
 * never a second validator). */
export interface AIToolHandler {
  readonly toolCode: string;
  readonly toolType: ToolType;
  execute(tenantId: string, input: Record<string, unknown>, context: { userId: string; organizationId?: string }, tx?: PrismaTransactionClient): Promise<{ data: unknown; sourceReference?: string; asOf?: Date; status?: string; version?: string }>;
}

/**
 * AIToolRegistryService (docx spec Phase 29, sections 35-40). No tool
 * handlers ship pre-registered in this build (same narrow-extension-
 * point discipline as every prior phase's own registry) — a business
 * module wanting to expose e.g. `getOpenAR` registers a
 * `READ`-type `AIToolHandler` here from its own module init.
 * `DOMAIN_ACTION`-type tools are registered but `AIToolInvocationService`
 * refuses to let the MODEL call them directly (spec section 40) — they
 * exist only so `AIActionProposalService.execute` can resolve the exact
 * same typed contract for the final, human/workflow-approved execution
 * step.
 */
@Injectable()
export class AIToolRegistryService {
  private readonly handlers = new Map<string, AIToolHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: IntegrationContractService,
  ) {}

  register(handler: AIToolHandler) {
    if (this.handlers.has(handler.toolCode)) throw new Error(`AI tool handler already registered for '${handler.toolCode}'`);
    this.handlers.set(handler.toolCode, handler);
  }

  getHandler(toolCode: string): AIToolHandler | undefined {
    return this.handlers.get(toolCode);
  }

  list(tenantId: string) {
    return this.prisma.aIToolDefinition.findMany({ where: { tenantId }, include: { policies: true } });
  }

  create(tenantId: string, input: { code: string; name: string; toolType: ToolType; inputSchema: ContractSchema; maxResultSize?: number; requiredCapabilityCode: string }) {
    return this.prisma.aIToolDefinition.create({
      data: { tenantId, code: input.code, name: input.name, toolType: input.toolType, inputSchema: input.inputSchema as unknown as object, maxResultSize: input.maxResultSize, requiredCapabilityCode: input.requiredCapabilityCode },
    });
  }

  createPolicy(tenantId: string, toolId: string, input: { capabilityCode: string; requiredPermission: string; allowedMode?: string; scopeConstraint?: Record<string, unknown> }) {
    return this.prisma.aIToolPermissionPolicy.create({
      data: { tenantId, toolId, capabilityCode: input.capabilityCode, requiredPermission: input.requiredPermission, allowedMode: input.allowedMode ?? 'READ', scopeConstraint: (input.scopeConstraint ?? null) as object | undefined },
    });
  }

  async getDefinition(tenantId: string, code: string) {
    const row = await this.prisma.aIToolDefinition.findFirst({ where: { tenantId, code }, include: { policies: true } });
    if (!row) throw new NotFoundAppError('AIToolDefinition', code);
    return row;
  }

  /** Validates a candidate input against the tool's own closed schema
   * (spec section 37 — types/ranges/tenant scope/dates/entity IDs
   * validated before execution) and checks the caller's permission
   * against the capability-scoped policy row (spec section 39). Never
   * bypasses a business permission the tool's underlying domain
   * requires (spec section 166 — "AI admin is not business admin"). */
  validateAndAuthorize(tool: { inputSchema: unknown; policies: { capabilityCode: string; requiredPermission: string; allowedMode: string }[] }, capabilityCode: string, input: Record<string, unknown>, hasPermission: (code: string) => boolean, requestedMode: 'READ' | 'PROPOSE' | 'EXECUTE' = 'READ') {
    const errors = this.contracts.validatePayload(tool.inputSchema as ContractSchema, input);
    if (errors.length > 0) throw new ValidationAppError(`Tool input invalid: ${errors.join('; ')}`);

    const policy = tool.policies.find((p) => p.capabilityCode === capabilityCode);
    if (!policy) throw new ValidationAppError(`No permission policy configured for this tool under capability '${capabilityCode}'`);
    if (!hasPermission(policy.requiredPermission)) throw new PermissionDeniedError(policy.requiredPermission);

    const modeRank = { READ: 0, PROPOSE: 1, EXECUTE: 2 };
    if (modeRank[requestedMode as keyof typeof modeRank] > modeRank[policy.allowedMode as keyof typeof modeRank]) {
      throw new PermissionDeniedError(`Tool policy only allows mode '${policy.allowedMode}', requested '${requestedMode}'`);
    }
  }
}
