import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const RISK_ORDER = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

/**
 * AIAssistantDefinitionService (docx spec Phase 29, section 13). An
 * assistant is a governed BUNDLE — which capabilities, tools, retrieval
 * sources, and model profile it may use, and the ceiling on action risk
 * it may ever propose. `assertToolAllowed`/`assertCapabilityAllowed`
 * are checked BEFORE `AICapabilityService`/tool-permission-policy
 * checks — an assistant not configured for a capability/tool can never
 * reach it regardless of the user's own permissions.
 */
@Injectable()
export class AIAssistantDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.aIAssistantDefinition.findMany({ where: { tenantId } });
  }

  create(tenantId: string, input: { code: string; allowedCapabilities: string[]; allowedTools: string[]; retrievalSources: string[]; modelProfileCode: string; systemPolicyVersion: string; maximumActionRisk?: string; owner?: string }) {
    if (input.maximumActionRisk && !RISK_ORDER.includes(input.maximumActionRisk)) throw new ValidationAppError(`Invalid maximumActionRisk: ${input.maximumActionRisk}`);
    return this.prisma.aIAssistantDefinition.create({
      data: { tenantId, code: input.code, allowedCapabilities: input.allowedCapabilities as object, allowedTools: input.allowedTools as object, retrievalSources: input.retrievalSources as object, modelProfileCode: input.modelProfileCode, systemPolicyVersion: input.systemPolicyVersion, maximumActionRisk: input.maximumActionRisk ?? 'LOW', owner: input.owner },
    });
  }

  async get(tenantId: string, code: string) {
    const row = await this.prisma.aIAssistantDefinition.findFirst({ where: { tenantId, code } });
    if (!row) throw new NotFoundAppError('AIAssistantDefinition', code);
    return row;
  }

  async assertCapabilityAllowed(tenantId: string, assistantCode: string, capabilityCode: string) {
    const assistant = await this.get(tenantId, assistantCode);
    if (!(assistant.allowedCapabilities as unknown as string[]).includes(capabilityCode)) {
      throw new ValidationAppError(`Assistant '${assistantCode}' is not configured for capability '${capabilityCode}'`);
    }
    return assistant;
  }

  async assertToolAllowed(tenantId: string, assistantCode: string, toolCode: string) {
    const assistant = await this.get(tenantId, assistantCode);
    if (!(assistant.allowedTools as unknown as string[]).includes(toolCode)) {
      throw new ValidationAppError(`Assistant '${assistantCode}' is not configured to use tool '${toolCode}'`);
    }
  }

  async assertActionRiskAllowed(tenantId: string, assistantCode: string, riskLevel: string) {
    const assistant = await this.get(tenantId, assistantCode);
    if (RISK_ORDER.indexOf(riskLevel) > RISK_ORDER.indexOf(assistant.maximumActionRisk)) {
      throw new ValidationAppError(`Assistant '${assistantCode}' cannot propose ${riskLevel}-risk actions (ceiling: ${assistant.maximumActionRisk})`);
    }
  }
}
