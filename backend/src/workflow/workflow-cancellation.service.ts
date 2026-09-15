import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowInstanceService, WorkflowTriggerContext } from './workflow-instance.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * WorkflowCancellationService (docx spec Phase 26, sections 82-85).
 * Cancellation/restart/supersede never delete prior decisions or the
 * original instance (spec sections 82-85, 200-201) — `restart` always
 * creates a brand-new `WorkflowInstance` linked via
 * `supersedesInstanceId`, exactly like `WorkflowReapprovalService`'s own
 * FULL_RESTART path (intentionally reused rather than duplicated).
 */
@Injectable()
export class WorkflowCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly instances: WorkflowInstanceService,
  ) {}

  async cancel(tenantId: string, userId: string, instanceId: string, reason: string) {
    const instance = await this.get(tenantId, instanceId);
    if (['APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'].includes(instance.status)) throw new ValidationAppError(`Cannot cancel a workflow that is already ${instance.status}`);
    const updated = await this.prisma.workflowInstance.update({ where: { id: instance.id }, data: { status: 'CANCELLED', completedAt: new Date(), cancellationReason: reason } });
    await this.prisma.workflowStepInstance.updateMany({ where: { tenantId, workflowInstanceId: instance.id, status: { in: ['NOT_ACTIVE', 'ACTIVE', 'WAITING'] } }, data: { status: 'CANCELLED' } });
    await this.audit.record({ tenantId, organizationId: instance.organizationId, eventType: 'WORKFLOW_CANCELLED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instance.id, operation: 'CANCEL', action: 'CANCEL', userId, reason });
    return updated;
  }

  /** Restarts a cancelled or change-requested instance as a brand-new
   * one, preserving the original (spec sections 84, 201). */
  async restart(tenantId: string, userId: string, instanceId: string, newSnapshot: Record<string, unknown>, newBusinessVersion: number, context: WorkflowTriggerContext) {
    const instance = await this.get(tenantId, instanceId);
    if (!['CANCELLED', 'CHANGE_REQUESTED', 'REJECTED', 'EXPIRED'].includes(instance.status)) throw new ValidationAppError(`Cannot restart a workflow that is ${instance.status}`);

    const definition = await this.prisma.workflowDefinition.findUniqueOrThrow({ where: { id: instance.workflowDefinitionId } });
    const newInstance = await this.instances.start(tenantId, userId, {
      workflowDefinitionCode: definition.code,
      organizationId: instance.organizationId,
      businessObjectType: instance.businessObjectType,
      businessObjectId: instance.businessObjectId,
      requestedAction: instance.requestedAction,
      businessVersion: newBusinessVersion,
      snapshotData: newSnapshot,
      context,
    });
    await this.prisma.workflowInstance.update({ where: { id: newInstance.id }, data: { supersedesInstanceId: instance.id } });
    await this.audit.record({ tenantId, organizationId: instance.organizationId, eventType: 'WORKFLOW_RESTARTED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: newInstance.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { supersedesInstanceId: instance.id } });
    return newInstance;
  }

  private async get(tenantId: string, id: string) {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id, tenantId } });
    if (!instance) throw new NotFoundAppError('WorkflowInstance', id);
    return instance;
  }
}
