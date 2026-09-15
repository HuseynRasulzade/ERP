import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowConditionService, ConditionNode } from './workflow-condition.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * WorkflowDefinitionService + WorkflowVersionService (docx spec Phase
 * 26, sections 4-7, 92, 102, combined into one file since a definition
 * cannot exist meaningfully without its version lifecycle). An ACTIVE
 * version is never edited in place (spec section 6) — every change is a
 * new version; `resolveActiveVersion` always picks the most specific
 * (organization-scoped over tenant-wide), highest-priority version
 * effective as of the SUBMISSION date, never "current latest" applied
 * retroactively (spec sections 7, 102, 195).
 */
@Injectable()
export class WorkflowDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly condition: WorkflowConditionService,
  ) {}

  async createDefinition(tenantId: string, userId: string, dto: { code: string; name: string; businessObjectType: string; actionType: string; category?: string; owner?: string }) {
    const definition = await this.prisma.workflowDefinition.create({ data: { tenantId, code: dto.code, name: dto.name, businessObjectType: dto.businessObjectType, actionType: dto.actionType, category: dto.category, owner: dto.owner } });
    await this.audit.record({ tenantId, eventType: 'WORKFLOW_DEFINITION_CREATED', eventCategory: 'WORKFLOW', entityType: 'WorkflowDefinition', entityId: definition.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return definition;
  }

  async createVersion(tenantId: string, userId: string, workflowDefinitionId: string, dto: { organizationId?: string; effectiveFrom: string; effectiveTo?: string; triggerType: string; priority?: number; reapprovalPolicy?: unknown; slaProfile?: unknown }) {
    const latest = await this.prisma.workflowDefinitionVersion.findFirst({ where: { tenantId, workflowDefinitionId }, orderBy: { version: 'desc' } });
    return this.prisma.workflowDefinitionVersion.create({
      data: { tenantId, workflowDefinitionId, organizationId: dto.organizationId, version: (latest?.version ?? 0) + 1, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined, triggerType: dto.triggerType, priority: dto.priority ?? 100, reapprovalPolicy: dto.reapprovalPolicy as object | undefined, slaProfile: dto.slaProfile as object | undefined, status: 'DRAFT', createdBy: userId },
    });
  }

  async addStep(
    tenantId: string,
    workflowVersionId: string,
    dto: { stepCode: string; name: string; stage?: number; sequence?: number; executionMode?: string; quorumRequired?: number; approverRuleId: string; conditionExpression?: ConditionNode; slaDurationHours?: number; escalationRuleId?: string; allowDelegate?: boolean; allowRequestChange?: boolean; optional?: boolean; rejectionPolicy?: string },
  ) {
    if (dto.conditionExpression) this.condition.validate(dto.conditionExpression);
    return this.prisma.workflowStepDefinition.create({
      data: {
        tenantId,
        workflowVersionId,
        stepCode: dto.stepCode,
        name: dto.name,
        stage: dto.stage ?? 0,
        sequence: dto.sequence ?? 0,
        executionMode: dto.executionMode ?? 'ALL_REQUIRED',
        quorumRequired: dto.quorumRequired,
        approverRuleId: dto.approverRuleId,
        conditionExpression: dto.conditionExpression as object | undefined,
        slaDurationHours: dto.slaDurationHours,
        escalationRuleId: dto.escalationRuleId,
        allowDelegate: dto.allowDelegate ?? true,
        allowRequestChange: dto.allowRequestChange ?? true,
        optional: dto.optional ?? false,
        rejectionPolicy: dto.rejectionPolicy ?? 'ANY_REJECTION_REJECTS',
      },
    });
  }

  /** Validation gate before activation (spec section 92) — condition
   * syntax, quorum executionMode requires a quorumRequired count, no
   * duplicate stepCode, and at least one non-optional step exists. Cycle
   * detection is not applicable here since stages are a strict
   * total-ordered sequence, not a general graph in this build (disclosed
   * simplification, docs/WORKFLOW_ENGINE.md section A). */
  async activateVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.getVersion(tenantId, versionId);
    if (version.status !== 'DRAFT' && version.status !== 'REVIEW') throw new ValidationAppError(`Cannot activate from status ${version.status}`);

    const steps = await this.prisma.workflowStepDefinition.findMany({ where: { tenantId, workflowVersionId: version.id } });
    if (steps.length === 0) throw new ValidationAppError('A workflow version needs at least one step to activate');
    if (!steps.some((s) => !s.optional)) throw new ValidationAppError('A workflow version needs at least one non-optional (mandatory) step');
    for (const step of steps) {
      if (step.executionMode === 'QUORUM' && !step.quorumRequired) throw new ValidationAppError(`Step ${step.stepCode} uses QUORUM execution mode but has no quorumRequired count`);
      if (step.conditionExpression) this.condition.validate(step.conditionExpression as ConditionNode);
    }

    // Retire the previously ACTIVE version for the same scope (org or
    // tenant-wide) — existing instances stay linked to the version they
    // were created under (spec section 6), only new submissions move.
    await this.prisma.workflowDefinitionVersion.updateMany({ where: { tenantId, workflowDefinitionId: version.workflowDefinitionId, organizationId: version.organizationId, status: 'ACTIVE' }, data: { status: 'RETIRED' } });

    const updated = await this.prisma.workflowDefinitionVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE', approvedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WORKFLOW_VERSION_ACTIVATED', eventCategory: 'WORKFLOW', entityType: 'WorkflowDefinitionVersion', entityId: version.id, action: 'UPDATE', userId, newValues: { version: version.version } });
    return updated;
  }

  /** Resolution priority (spec sections 111-112): organization-specific
   * ACTIVE version effective as of `asOfDate` wins over the tenant-wide
   * default; among candidates at the same specificity, lowest `priority`
   * number wins; ties broken by highest `version`. */
  async resolveActiveVersion(tenantId: string, workflowDefinitionId: string, organizationId: string, asOfDate: Date) {
    const candidates = await this.prisma.workflowDefinitionVersion.findMany({
      where: {
        tenantId,
        workflowDefinitionId,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
        AND: [{ OR: [{ organizationId }, { organizationId: null }] }],
      },
    });
    if (candidates.length === 0) throw new NotFoundAppError('WorkflowDefinitionVersion', `active for ${workflowDefinitionId} as of ${asOfDate.toISOString().slice(0, 10)}`);
    candidates.sort((a, b) => {
      const specificityA = a.organizationId ? 0 : 1;
      const specificityB = b.organizationId ? 0 : 1;
      if (specificityA !== specificityB) return specificityA - specificityB;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.version - a.version;
    });
    return candidates[0];
  }

  private async getVersion(tenantId: string, id: string) {
    const version = await this.prisma.workflowDefinitionVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundAppError('WorkflowDefinitionVersion', id);
    return version;
  }
}
