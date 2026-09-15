import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowConditionService, ConditionNode } from './workflow-condition.service';
import { ApproverResolutionService, ApproverResolutionContext } from './approver-resolution.service';
import { SegregationOfDutiesService } from './segregation-of-duties.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface WorkflowTriggerContext extends ApproverResolutionContext {
  amount?: number;
  currencyId?: string;
  counterpartyId?: string;
  risk?: string;
  [key: string]: unknown;
}

/**
 * WorkflowInstanceService + WorkflowRouteService (docx spec Phase 26,
 * sections 10-20, 93-96, combined — building the route IS instantiating
 * the instance's own step instances, not a separate persisted graph).
 * Stages run sequentially; steps within one stage run according to
 * their own `executionMode` (spec sections 14-20). A step whose
 * condition evaluates false is SKIPPED, never silently omitted from the
 * route history (spec section 96, 131).
 */
@Injectable()
export class WorkflowInstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly definitions: WorkflowDefinitionService,
    private readonly condition: WorkflowConditionService,
    private readonly approverResolution: ApproverResolutionService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async start(
    tenantId: string,
    userId: string,
    dto: { workflowDefinitionCode: string; organizationId: string; businessObjectType: string; businessObjectId: string; requestedAction: string; businessVersion: number; snapshotData: Record<string, unknown>; context: WorkflowTriggerContext; businessDate?: Date },
  ) {
    const definition = await this.prisma.workflowDefinition.findFirst({ where: { tenantId, code: dto.workflowDefinitionCode, active: true } });
    if (!definition) throw new NotFoundAppError('WorkflowDefinition', dto.workflowDefinitionCode);
    const asOfDate = dto.businessDate ?? new Date();
    const version = await this.definitions.resolveActiveVersion(tenantId, definition.id, dto.organizationId, asOfDate);
    const steps = await this.prisma.workflowStepDefinition.findMany({ where: { tenantId, workflowVersionId: version.id }, orderBy: [{ stage: 'asc' }, { sequence: 'asc' }], include: { approverRule: true } });
    if (steps.length === 0) throw new ValidationAppError(`Workflow version ${version.id} has no steps configured`);

    const snapshotHash = createHash('sha256').update(JSON.stringify(dto.snapshotData)).digest('hex');

    return this.prisma.runInTransaction(async (tx) => {
      const instance = await tx.workflowInstance.create({
        data: {
          tenantId,
          organizationId: dto.organizationId,
          workflowDefinitionId: definition.id,
          workflowVersionId: version.id,
          businessObjectType: dto.businessObjectType,
          businessObjectId: dto.businessObjectId,
          requestedAction: dto.requestedAction,
          status: 'IN_PROGRESS',
          initiatedBy: userId,
          snapshotData: { ...dto.snapshotData, __snapshotHash: snapshotHash } as object,
          businessVersion: dto.businessVersion,
        },
      });

      for (const step of steps) {
        const applies = !step.conditionExpression || this.condition.evaluate(step.conditionExpression as unknown as ConditionNode, dto.context);
        await tx.workflowStepInstance.create({ data: { tenantId, workflowInstanceId: instance.id, stepDefinitionId: step.id, status: applies ? 'NOT_ACTIVE' : 'SKIPPED', quorumRequired: step.quorumRequired } });
      }

      await this.audit.record({ tenantId, organizationId: dto.organizationId, eventType: 'WORKFLOW_STARTED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instance.id, documentType: dto.businessObjectType, documentId: dto.businessObjectId, operation: 'CREATE', action: 'CREATE', userId, newValues: { workflowVersionId: version.id } }, tx);

      await this.activateStage(tenantId, userId, instance.id, 0, dto.context, tx);
      return tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id }, include: { stepInstances: { include: { assignments: true } } } });
    });
  }

  /** Activates every non-SKIPPED, NOT_ACTIVE step in `stage`, resolving
   * approvers and creating `ApproverAssignment` rows. If a stage has no
   * remaining (non-skipped) steps, immediately recurses to the next
   * stage — or completes the whole instance as APPROVED if there are no
   * more stages (spec section 24's own "Final Approval"). */
  async activateStage(tenantId: string, userId: string, instanceId: string, stage: number, context: WorkflowTriggerContext, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const instance = await client.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });
    const allSteps = await client.workflowStepDefinition.findMany({ where: { tenantId, workflowVersionId: instance.workflowVersionId }, orderBy: [{ stage: 'asc' }, { sequence: 'asc' }] });
    const maxStage = allSteps.length > 0 ? Math.max(...allSteps.map((s) => s.stage)) : 0;

    const stepInstancesInStage = await client.workflowStepInstance.findMany({ where: { tenantId, workflowInstanceId: instanceId, definition: { stage } }, include: { definition: { include: { approverRule: true } } } });
    const activatable = stepInstancesInStage.filter((s) => s.status === 'NOT_ACTIVE');

    if (activatable.length === 0) {
      // Every step in this stage was SKIPPED (or the stage is empty) —
      // move straight to the next stage, or finish if this was the last.
      if (stage >= maxStage) return this.finalizeApproved(tenantId, userId, instanceId, client);
      await client.workflowInstance.update({ where: { id: instanceId }, data: { currentStage: stage + 1 } });
      return this.activateStage(tenantId, userId, instanceId, stage + 1, context, tx);
    }

    // organizationId/businessDate are always injected from the
    // instance's own trusted state, never taken from the caller-
    // supplied context bag (spec section 9's own "Do not pass arbitrary
    // ungoverned frontend JSON as approval truth").
    const trustedContext = { ...context, organizationId: instance.organizationId, businessDate: instance.startedAt };

    for (const stepInstance of activatable) {
      const resolved = await this.approverResolution.resolve(tenantId, stepInstance.definition.approverRule, trustedContext);
      const eligible = resolved.filter((r) => this.sod.checkFourEyes(instance.initiatedBy, r.userId).allowed);

      if (eligible.length === 0) {
        await client.workflowStepInstance.update({ where: { id: stepInstance.id }, data: { status: 'ACTIVE', activatedAt: new Date() } });
        await client.workflowException.create({ data: { tenantId, workflowInstanceId: instanceId, exceptionType: resolved.length > eligible.length ? 'SOD_CONFLICT' : 'APPROVER_NOT_RESOLVED', severity: 'BLOCKING', message: `No eligible approver could be resolved for step ${stepInstance.definition.stepCode}.` } });
        await client.workflowInstance.update({ where: { id: instanceId }, data: { status: 'WAITING' } });
        continue;
      }

      const deadline = stepInstance.definition.slaDurationHours ? new Date(Date.now() + stepInstance.definition.slaDurationHours * 3600000) : null;
      await client.workflowStepInstance.update({ where: { id: stepInstance.id }, data: { status: 'ACTIVE', activatedAt: new Date(), deadline } });
      for (const approver of eligible) {
        await client.approverAssignment.create({ data: { tenantId, stepInstanceId: stepInstance.id, userId: approver.userId, employmentId: approver.employmentId, resolvedFromRule: approver.resolvedFromRule, responseDeadline: deadline, status: 'PENDING' } });
      }
      await this.audit.record({ tenantId, organizationId: instance.organizationId, eventType: 'WORKFLOW_STEP_ACTIVATED', eventCategory: 'WORKFLOW', entityType: 'WorkflowStepInstance', entityId: stepInstance.id, operation: 'UPDATE', action: 'UPDATE', userId, newValues: { approvers: eligible.map((e) => e.userId) } }, tx);
    }

    const anyBlocking = await client.workflowException.count({ where: { tenantId, workflowInstanceId: instanceId, resolved: false, severity: 'BLOCKING' } });
    if (anyBlocking === 0) await client.workflowInstance.update({ where: { id: instanceId }, data: { status: 'PENDING', currentStage: stage } });
    return client.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });
  }

  private async finalizeApproved(tenantId: string, userId: string, instanceId: string, client: PrismaTransactionClient | PrismaService) {
    const updated = await client.workflowInstance.update({ where: { id: instanceId }, data: { status: 'APPROVED', completedAt: new Date() } });
    await this.audit.record({ tenantId, organizationId: updated.organizationId, eventType: 'WORKFLOW_APPROVED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instanceId, operation: 'APPROVE', action: 'APPROVE', userId, documentType: updated.businessObjectType, documentId: updated.businessObjectId });
    return updated;
  }

  async reject(tenantId: string, userId: string, instanceId: string, reason?: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const updated = await client.workflowInstance.update({ where: { id: instanceId }, data: { status: 'REJECTED', completedAt: new Date() } });
    await this.audit.record({ tenantId, organizationId: updated.organizationId, eventType: 'WORKFLOW_REJECTED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instanceId, operation: 'REJECT', action: 'REJECT', userId, reason }, tx);
    return updated;
  }

  async requestChange(tenantId: string, userId: string, instanceId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const updated = await client.workflowInstance.update({ where: { id: instanceId }, data: { status: 'CHANGE_REQUESTED' } });
    await this.audit.record({ tenantId, organizationId: updated.organizationId, eventType: 'WORKFLOW_CHANGE_REQUESTED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instanceId, operation: 'REQUEST_CHANGE', action: 'REQUEST_CHANGE', userId }, tx);
    return updated;
  }

  async get(tenantId: string, id: string) {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id, tenantId }, include: { stepInstances: { include: { assignments: true, decisions: true } }, exceptions: true } });
    if (!instance) throw new NotFoundAppError('WorkflowInstance', id);
    return instance;
  }

  async forBusinessObject(tenantId: string, businessObjectType: string, businessObjectId: string) {
    return this.prisma.workflowInstance.findMany({ where: { tenantId, businessObjectType, businessObjectId }, orderBy: { startedAt: 'desc' } });
  }
}
