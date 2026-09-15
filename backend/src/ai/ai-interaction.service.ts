import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { AICapabilityService } from './ai-capability.service';
import { AIAssistantDefinitionService } from './ai-assistant-definition.service';
import { AIModelService } from './ai-model.service';
import { AIPromptService } from './ai-prompt.service';
import { AIGuardrailService } from './ai-guardrail.service';
import { AIContextBuilderService } from './ai-context-builder.service';
import { RetrievedEvidenceItem } from './ai-retrieval.service';

export interface AskInput {
  organizationId?: string;
  userId: string;
  userPermissions: string[];
  hasPermission: (code: string) => boolean;
  assistantCode: string;
  capabilityCode: string;
  promptTemplateCode: string;
  userRequest: string;
  conversationId?: string;
  evidence: RetrievedEvidenceItem[]; // already permission-filtered by the caller via AIRetrievalService — this service governs, it does not itself run a multi-step agent loop (disclosed, docs/AI_LAYER.md section E)
  synthesizeAnswer: (userRequest: string, evidence: RetrievedEvidenceItem[]) => string; // deterministic narrative built ONLY from the evidence array's own values — never invents a number (spec section 65/67)
  semanticModelVersion?: string;
  reportCloseVersion?: string;
  provisional?: boolean; // spec section 27 — caller signals when underlying evidence (e.g. COGS) is not yet final
}

/**
 * AIInteractionService (docx spec Phase 29, sections 93-94, 97-98).
 * The stable orchestration seam for the "Explain"/"Recommend" AI roles
 * (spec section 34) — governance (capability kill switch, assistant
 * scope, guardrails, context/evidence lineage) lives here; a caller
 * (a capability-specific service like a future
 * `AIFinancialAnalysisService`) supplies the actual retrieved evidence
 * and a deterministic answer-synthesis function so this service never
 * itself invents a number.
 */
@Injectable()
export class AIInteractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: AICapabilityService,
    private readonly assistants: AIAssistantDefinitionService,
    private readonly models: AIModelService,
    private readonly prompts: AIPromptService,
    private readonly guardrails: AIGuardrailService,
    private readonly contextBuilder: AIContextBuilderService,
  ) {}

  async ask(tenantId: string, input: AskInput) {
    await this.capabilities.assertUsable(tenantId, input.capabilityCode, input.hasPermission);
    await this.assistants.assertCapabilityAllowed(tenantId, input.assistantCode, input.capabilityCode);

    const assistant = await this.assistants.get(tenantId, input.assistantCode);
    const modelVersion = await this.models.resolveActiveVersion(tenantId, assistant.modelProfileCode);
    const promptVersion = await this.prompts.resolveActive(tenantId, input.promptTemplateCode);

    const interaction = await this.prisma.aIInteraction.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        userId: input.userId,
        capabilityCode: input.capabilityCode,
        userRequest: input.userRequest,
        modelVersionId: modelVersion.id,
        promptVersionId: promptVersion.id,
        status: 'CONTEXT_BUILDING',
      },
    });

    const startedAt = Date.now();

    const inputGuard = await this.guardrails.evaluate(tenantId, interaction.id, 'INPUT', input.capabilityCode, { userRequest: input.userRequest });
    if (!inputGuard.passed) {
      const blocked = await this.prisma.aIInteraction.update({ where: { id: interaction.id }, data: { status: 'BLOCKED', blockedReason: inputGuard.failures.join(', '), completedAt: new Date(), latencyMs: Date.now() - startedAt } });
      await this.audit.record({ tenantId, eventType: 'MessageReceived', eventCategory: 'AI_SECURITY', entityType: 'AIInteraction', entityId: interaction.id, operation: 'VALIDATE', action: 'BLOCK', userId: input.userId, severity: 'WARNING', metadata: { reasons: inputGuard.failures } });
      return blocked;
    }

    const context = await this.contextBuilder.build(tenantId, input.organizationId, input.userPermissions, input.evidence, { semanticModelVersion: input.semanticModelVersion, reportCloseVersion: input.reportCloseVersion });

    let finalAnswer = input.synthesizeAnswer(input.userRequest, input.evidence);
    if (input.provisional) {
      finalAnswer = `[PROVISIONAL — underlying data not yet final] ${finalAnswer}`;
    }

    const outputGuard = await this.guardrails.evaluate(tenantId, interaction.id, 'OUTPUT', input.capabilityCode, { finalAnswer, evidenceCount: input.evidence.length });

    const confidenceLevel = this.assessConfidence(input.evidence, input.provisional ?? false);

    const status = outputGuard.passed ? 'COMPLETED' : 'PARTIAL';
    const updated = await this.prisma.runInTransaction(async (tx) => {
      const done = await tx.aIInteraction.update({
        where: { id: interaction.id },
        data: { status, finalAnswer, contextSnapshotId: context.id, completedAt: new Date(), latencyMs: Date.now() - startedAt },
      });
      if (input.evidence.length > 0) {
        await tx.aIEvidenceReference.createMany({
          data: input.evidence.map((e) => ({ tenantId, interactionId: interaction.id, evidenceType: e.evidenceType, entityType: e.entityType, entityId: e.entityId, asOf: e.asOf, versionTag: e.versionTag, summary: e.summary })),
        });
      }
      return done;
    });

    await this.audit.record({ tenantId, organizationId: input.organizationId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: 'AIInteraction', entityId: interaction.id, operation: 'CREATE', action: status, userId: input.userId, metadata: { capabilityCode: input.capabilityCode, modelVersionId: modelVersion.id, promptVersionId: promptVersion.id, evidenceCount: input.evidence.length, confidenceLevel } });

    return { ...updated, confidenceLevel };
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.aIInteraction.findFirst({ where: { id, tenantId }, include: { evidenceRefs: true, toolInvocations: true, guardrailResults: true, modelVersion: true, promptVersion: true } });
    if (!row) throw new NotFoundAppError('AIInteraction', id);
    return row;
  }

  /** Confidence is a governed category, never fake numeric precision
   * (spec section 58-59): no evidence => LOW; provisional/incomplete
   * evidence => MEDIUM; complete, final evidence => HIGH. */
  private assessConfidence(evidence: RetrievedEvidenceItem[], provisional: boolean): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (evidence.length === 0) return 'LOW';
    if (provisional) return 'MEDIUM';
    return 'HIGH';
  }
}
