import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError, ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/**
 * AIPromptService (docx spec Phase 29, sections 30-33, 140). Prompt
 * versions are immutable once ACTIVE (spec section 32) — there is no
 * update method on a version row, only `createVersion` (a new one) and
 * `activate`/`retire` (status transitions). Like `AIModelService`,
 * activation requires a passing evaluation run when the template's
 * capability is above `READ_ONLY_LOW` risk — checked by the caller
 * (`AIEvaluationService`) before calling `activate`, mirroring the
 * model-version gate exactly (spec section 140's "same for prompt
 * version").
 */
@Injectable()
export class AIPromptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listTemplates(tenantId: string) {
    return this.prisma.aIPromptTemplate.findMany({ where: { tenantId }, include: { versions: true } });
  }

  createTemplate(tenantId: string, input: { code: string; name: string; capabilityCode: string }) {
    return this.prisma.aIPromptTemplate.create({ data: { tenantId, ...input } });
  }

  async createVersion(tenantId: string, userId: string, templateId: string, input: { instructions: string; effectiveFrom: Date; effectiveTo?: Date; expectedOutputSchema?: Record<string, unknown>; allowedTools?: string[]; modelProfileCode: string; riskControls?: Record<string, unknown>; evaluationThreshold?: number }) {
    const template = await this.prisma.aIPromptTemplate.findFirst({ where: { id: templateId, tenantId } });
    if (!template) throw new NotFoundAppError('AIPromptTemplate', templateId);
    if (!input.instructions?.trim()) throw new ValidationAppError('Prompt instructions cannot be empty');

    const last = await this.prisma.aIPromptVersion.findFirst({ where: { tenantId, promptTemplateId: templateId }, orderBy: { version: 'desc' } });
    return this.prisma.aIPromptVersion.create({
      data: {
        tenantId,
        promptTemplateId: templateId,
        version: (last?.version ?? 0) + 1,
        instructions: input.instructions,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        expectedOutputSchema: (input.expectedOutputSchema ?? null) as object | undefined,
        allowedTools: (input.allowedTools ?? []) as object,
        modelProfileCode: input.modelProfileCode,
        riskControls: (input.riskControls ?? null) as object | undefined,
        evaluationThreshold: input.evaluationThreshold,
        status: 'DRAFT',
        createdBy: userId,
      },
    });
  }

  async activate(tenantId: string, userId: string, versionId: string) {
    const version = await this.get(tenantId, versionId);
    if (version.status === 'RETIRED' || version.status === 'REJECTED') throw new ConflictAppError(`Prompt version ${versionId} is ${version.status} and cannot be activated`);
    const activated = await this.prisma.runInTransaction(async (tx) => {
      await tx.aIPromptVersion.updateMany({ where: { tenantId, promptTemplateId: version.promptTemplateId, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
      return tx.aIPromptVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', approvedBy: userId } });
    });
    await this.audit.record({ tenantId, eventType: 'ContractVersionChanged', eventCategory: 'AI', entityType: 'AIPromptVersion', entityId: versionId, operation: 'UPDATE', action: 'ACTIVATE', userId, metadata: { promptTemplateId: version.promptTemplateId } });
    return activated;
  }

  async resolveActive(tenantId: string, templateCode: string) {
    const template = await this.prisma.aIPromptTemplate.findFirst({ where: { tenantId, code: templateCode } });
    if (!template) throw new NotFoundAppError('AIPromptTemplate', templateCode);
    const active = await this.prisma.aIPromptVersion.findFirst({ where: { tenantId, promptTemplateId: template.id, status: 'ACTIVE' } });
    if (!active) throw new NotFoundAppError('AIPromptVersion', `active version for template '${templateCode}'`);
    return active;
  }

  private async get(tenantId: string, id: string) {
    const row = await this.prisma.aIPromptVersion.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('AIPromptVersion', id);
    return row;
  }
}
