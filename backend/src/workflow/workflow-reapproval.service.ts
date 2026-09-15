import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditDiffService } from '../audit-trail/audit-diff.service';
import { WorkflowInstanceService, WorkflowTriggerContext } from './workflow-instance.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface ReapprovalPolicyRule {
  fieldPath: string;
  changeType?: 'INCREASE' | 'DECREASE' | 'ANY';
  threshold?: number;
  action: 'NO_REAPPROVAL' | 'CURRENT_STEP_ONLY' | 'FROM_SPECIFIC_STEP' | 'FULL_RESTART' | 'RECALCULATE_ROUTE' | 'REQUIRE_EXTRA_APPROVAL';
  restartFromStep?: string;
}

/**
 * WorkflowReapprovalService (docx spec Phase 26, sections 50-58,
 * 119). `notifyBusinessObjectChanged` is the stable API business
 * modules call after editing a document with a pending/approved
 * workflow instance (spec section 119) — it diffs the new state against
 * the instance's own frozen `snapshotData` (reusing Phase 25's
 * `AuditDiffService`, never a second diff engine) and applies the
 * FIRST matching rule in the version's own `reapprovalPolicy` array
 * (an unmatched field defaults to `NO_REAPPROVAL`, per spec section 51
 * — "not every edit should reset approvals").
 */
@Injectable()
export class WorkflowReapprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly diff: AuditDiffService,
    private readonly instances: WorkflowInstanceService,
  ) {}

  async notifyBusinessObjectChanged(tenantId: string, userId: string, workflowInstanceId: string, newSnapshot: Record<string, unknown>, newBusinessVersion: number, context: WorkflowTriggerContext) {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id: workflowInstanceId, tenantId } });
    if (!instance) throw new NotFoundAppError('WorkflowInstance', workflowInstanceId);
    if (instance.status !== 'APPROVED' && instance.status !== 'PENDING' && instance.status !== 'IN_PROGRESS') return { materialChangeDetected: false, action: 'NO_REAPPROVAL' as const };

    // `__snapshotHash` is this module's own bookkeeping field (added by
    // `WorkflowInstanceService.start`), never part of the caller's own
    // business data — excluded so it can never itself look like a
    // material field change.
    const { __snapshotHash: _oldHash, ...oldSnapshot } = instance.snapshotData as Record<string, unknown>;
    void _oldHash;
    const changes = this.diff.diff(oldSnapshot, newSnapshot);
    if (changes.length === 0) return { materialChangeDetected: false, action: 'NO_REAPPROVAL' as const };

    const version = await this.prisma.workflowDefinitionVersion.findUniqueOrThrow({ where: { id: instance.workflowVersionId } });
    const rules = (version.reapprovalPolicy as unknown as ReapprovalPolicyRule[] | null) ?? [];

    let matchedRule: ReapprovalPolicyRule | null = null;
    for (const change of changes) {
      const rule = rules.find((r) => change.fieldPath.startsWith(r.fieldPath));
      if (rule && rule.action !== 'NO_REAPPROVAL') {
        matchedRule = rule;
        break;
      }
    }
    if (!matchedRule) return { materialChangeDetected: false, action: 'NO_REAPPROVAL' as const, changes };

    await this.audit.record({ tenantId, organizationId: instance.organizationId, eventType: 'WORKFLOW_MATERIAL_CHANGE_DETECTED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instance.id, operation: 'UPDATE', action: 'UPDATE', userId, oldValues: instance.snapshotData, newValues: newSnapshot, metadata: { rule: matchedRule, changedFields: changes.map((c) => c.fieldPath) } });

    return this.prisma.runInTransaction(async (tx) => {
      await this.invalidateApprovals(tenantId, userId, instance.id, matchedRule!.action, tx);
      const restarted = await this.restartFromSnapshot(tenantId, userId, instance.id, newSnapshot, newBusinessVersion, context, matchedRule!, tx);
      return { materialChangeDetected: true, action: matchedRule!.action, changes, newInstance: restarted };
    });
  }

  /** Marks every current APPROVED/PENDING decision-bearing step as
   * INVALIDATED_FOR_EXECUTION (spec section 57's own "old approvals
   * become INVALIDATED_FOR_EXECUTION but remain historical") — the
   * decisions themselves are never deleted (spec section 107). */
  private async invalidateApprovals(tenantId: string, userId: string, instanceId: string, action: string, tx: PrismaTransactionClient) {
    await tx.workflowInstance.update({ where: { id: instanceId }, data: { reapprovalCount: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'WORKFLOW_APPROVALS_INVALIDATED', eventCategory: 'WORKFLOW', entityType: 'WorkflowInstance', entityId: instanceId, operation: 'UPDATE', action: 'UPDATE', userId, metadata: { reapprovalAction: action } }, tx);
  }

  /** `FULL_RESTART`/`RECALCULATE_ROUTE` create a brand-new instance
   * (supersedes the old one) since the route itself may change (spec
   * section 57); `CURRENT_STEP_ONLY`/`FROM_SPECIFIC_STEP` reset just the
   * relevant step(s) on the SAME instance. `REQUIRE_EXTRA_APPROVAL`
   * (foundation only, disclosed docs/WORKFLOW_ENGINE.md section D) is
   * treated the same as `CURRENT_STEP_ONLY` in this build — a genuinely
   * separate "extra approver added without resetting existing ones" path
   * is not implemented. */
  private async restartFromSnapshot(tenantId: string, userId: string, instanceId: string, newSnapshot: Record<string, unknown>, newBusinessVersion: number, context: WorkflowTriggerContext, rule: ReapprovalPolicyRule, tx: PrismaTransactionClient) {
    const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instanceId } });

    if (rule.action === 'FULL_RESTART' || rule.action === 'RECALCULATE_ROUTE') {
      await tx.workflowInstance.update({ where: { id: instanceId }, data: { status: 'SUPERSEDED', completedAt: new Date() } });
      const definition = await tx.workflowDefinition.findUniqueOrThrow({ where: { id: instance.workflowDefinitionId } });
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
      await tx.workflowInstance.update({ where: { id: newInstance.id }, data: { supersedesInstanceId: instanceId } });
      return newInstance;
    }

    // CURRENT_STEP_ONLY / FROM_SPECIFIC_STEP / REQUIRE_EXTRA_APPROVAL:
    // reset the relevant step(s) back to NOT_ACTIVE and re-activate.
    const targetStepCode = rule.action === 'FROM_SPECIFIC_STEP' ? rule.restartFromStep : undefined;
    const stepInstances = await tx.workflowStepInstance.findMany({ where: { tenantId, workflowInstanceId: instanceId }, include: { definition: true } });
    const resetFromStage = targetStepCode ? stepInstances.find((s) => s.definition.stepCode === targetStepCode)?.definition.stage ?? 0 : Math.min(...stepInstances.filter((s) => s.status === 'ACTIVE').map((s) => s.definition.stage), instance.currentStage);

    for (const stepInstance of stepInstances) {
      if (stepInstance.definition.stage >= resetFromStage && stepInstance.status !== 'SKIPPED') {
        await tx.approverAssignment.updateMany({ where: { stepInstanceId: stepInstance.id }, data: { status: 'CANCELLED' } });
        await tx.workflowStepInstance.update({ where: { id: stepInstance.id }, data: { status: 'NOT_ACTIVE', approvalsCount: 0, rejectionsCount: 0, changeRequestsCount: 0, activatedAt: null, completedAt: null } });
      }
    }
    await tx.workflowInstance.update({ where: { id: instanceId }, data: { status: 'IN_PROGRESS', snapshotData: newSnapshot as object, businessVersion: newBusinessVersion, currentStage: resetFromStage } });
    return this.instances.activateStage(tenantId, userId, instanceId, resetFromStage, context, tx);
  }
}
