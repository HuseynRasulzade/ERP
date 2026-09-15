import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowInstanceService } from './workflow-instance.service';
import { SegregationOfDutiesService } from './segregation-of-duties.service';
import { DelegationService } from './delegation.service';
import { NotFoundAppError, ValidationAppError, ConcurrencyConflictError } from '../common/errors/app-error';

/**
 * ApprovalDecisionService (docx spec Phase 26, sections 45-50, 122-126).
 * Concurrency-safe quorum completion (spec section 122): each decision
 * is written inside a transaction that atomically increments the step
 * instance's own counters via an optimistic `version` check (a classic
 * compare-and-swap on the row) — two approvers responding in the same
 * instant each get their own transaction; whichever commits first wins
 * the version bump, the second retries against the freshly-read counts,
 * so the step completes exactly once no matter how many decisions race.
 * Idempotency (spec sections 125-126): a repeated decision request with
 * the same `idempotencyKey` returns the ALREADY-recorded decision
 * rather than creating a second one (unique constraint on
 * `(tenantId, idempotencyKey)`).
 */
@Injectable()
export class ApprovalDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly instances: WorkflowInstanceService,
    private readonly sod: SegregationOfDutiesService,
    private readonly delegation: DelegationService,
  ) {}

  async decide(
    tenantId: string,
    actorUserId: string,
    dto: { workflowInstanceId: string; stepInstanceId: string; decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGE' | 'ABSTAIN'; comment?: string; reasonCode?: string; evidenceId?: string; idempotencyKey?: string; context: Record<string, unknown> },
  ) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.approvalDecision.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } } });
      if (existing) return existing; // spec section 202 — same request retried, one decision
    }
    if ((dto.decision === 'REJECT' || dto.decision === 'REQUEST_CHANGE') && !dto.comment) {
      throw new ValidationAppError('A rejection or change request requires a mandatory comment (spec section 47).');
    }

    const stepInstance = await this.prisma.workflowStepInstance.findFirst({ where: { id: dto.stepInstanceId, tenantId }, include: { definition: true, instance: true } });
    if (!stepInstance) throw new NotFoundAppError('WorkflowStepInstance', dto.stepInstanceId);
    if (stepInstance.status !== 'ACTIVE') throw new ValidationAppError(`Step is ${stepInstance.status}, not ACTIVE — decision rejected.`);

    let assignment = await this.prisma.approverAssignment.findFirst({ where: { tenantId, stepInstanceId: stepInstance.id, userId: actorUserId, status: 'PENDING' } });
    let delegated = false;
    if (!assignment) {
      // Check whether `actorUserId` is an active delegate for one of the
      // pending assignments (spec sections 35-38).
      const pending = await this.prisma.approverAssignment.findMany({ where: { tenantId, stepInstanceId: stepInstance.id, status: 'PENDING' } });
      for (const candidate of pending) {
        const delegate = await this.delegation.resolveDelegate(tenantId, candidate.userId, { asOfDate: new Date(), organizationId: stepInstance.instance.organizationId, amount: (dto.context.amount as number) ?? 0, currencyId: (dto.context.currencyId as string) ?? '' });
        if (delegate === actorUserId) {
          assignment = candidate;
          delegated = true;
          break;
        }
      }
    }
    if (!assignment) throw new ValidationAppError(`User ${actorUserId} is not a pending approver (or valid delegate) for this step.`);

    const fourEyes = this.sod.checkFourEyes(stepInstance.instance.initiatedBy, actorUserId);
    if (!fourEyes.allowed) throw new ValidationAppError('Segregation-of-duties: the workflow initiator cannot decide on their own request.');

    const snapshotHash = createHash('sha256').update(JSON.stringify(stepInstance.instance)).digest('hex');

    return this.prisma.runInTransaction(async (tx) => {
      // Optimistic compare-and-swap: only proceed if the step instance's
      // version is unchanged since we read it above (spec section 124) —
      // a concurrent decision that already advanced it causes THIS
      // decision to retry against a freshly-read state rather than
      // silently double-count.
      const cas = await tx.workflowStepInstance.updateMany({ where: { id: stepInstance.id, version: stepInstance.version, status: 'ACTIVE' }, data: { version: { increment: 1 } } });
      if (cas.count === 0) throw new ConcurrencyConflictError();

      await tx.approverAssignment.update({ where: { id: assignment!.id }, data: { status: dto.decision === 'APPROVE' ? 'APPROVED' : dto.decision === 'REJECT' ? 'REJECTED' : dto.decision === 'REQUEST_CHANGE' ? 'CHANGE_REQUESTED' : 'PENDING' } });

      const decisionRow = await tx.approvalDecision.create({
        data: {
          tenantId,
          workflowInstanceId: stepInstance.workflowInstanceId,
          stepInstanceId: stepInstance.id,
          approverAssignmentId: assignment!.id,
          decision: dto.decision,
          comment: dto.comment,
          reasonCode: dto.reasonCode,
          evidenceId: dto.evidenceId,
          actorUserId,
          delegated,
          snapshotHash,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      const counterField = dto.decision === 'APPROVE' ? 'approvalsCount' : dto.decision === 'REJECT' ? 'rejectionsCount' : dto.decision === 'REQUEST_CHANGE' ? 'changeRequestsCount' : null;
      const updatedStep = counterField
        ? await tx.workflowStepInstance.update({ where: { id: stepInstance.id }, data: { [counterField]: { increment: 1 } } })
        : await tx.workflowStepInstance.findUniqueOrThrow({ where: { id: stepInstance.id } });

      await this.audit.record({ tenantId, organizationId: stepInstance.instance.organizationId, eventType: `WORKFLOW_DECISION_${dto.decision}`, eventCategory: 'WORKFLOW', entityType: 'ApprovalDecision', entityId: decisionRow.id, operation: dto.decision, action: dto.decision, userId: actorUserId, reason: dto.comment }, tx);

      await this.evaluateStepCompletion(tenantId, actorUserId, updatedStep, tx);
      return decisionRow;
    });
  }

  /** Applies the step's own `executionMode` to decide whether the step
   * is now complete, and if so, whether it's APPROVED/REJECTED/
   * CHANGE_REQUESTED, then advances the workflow accordingly (spec
   * sections 14-20). */
  private async evaluateStepCompletion(tenantId: string, userId: string, step: { id: string; workflowInstanceId: string; approvalsCount: number; rejectionsCount: number; changeRequestsCount: number; quorumRequired: number | null; status: string }, tx: PrismaTransactionClient) {
    const definition = await tx.workflowStepDefinition.findUniqueOrThrow({ where: { id: (await tx.workflowStepInstance.findUniqueOrThrow({ where: { id: step.id } })).stepDefinitionId } });
    const assignments = await tx.approverAssignment.findMany({ where: { tenantId, stepInstanceId: step.id } });
    const totalAssignments = assignments.length;

    if (step.rejectionsCount > 0 && definition.rejectionPolicy === 'ANY_REJECTION_REJECTS') {
      return this.completeStep(tenantId, userId, step.id, 'REJECTED', tx);
    }
    if (step.changeRequestsCount > 0 && (definition.executionMode !== 'PARALLEL' || definition.rejectionPolicy === 'REJECTION_REQUESTS_CHANGE')) {
      return this.completeStep(tenantId, userId, step.id, 'CHANGE_REQUESTED', tx);
    }

    let complete = false;
    switch (definition.executionMode) {
      case 'ANY_ONE':
      case 'FIRST_RESPONSE':
        complete = step.approvalsCount >= 1;
        break;
      case 'QUORUM':
        complete = step.approvalsCount >= (definition.quorumRequired ?? totalAssignments);
        break;
      case 'ALL_REQUIRED':
      case 'PARALLEL':
      case 'SEQUENTIAL':
      default:
        complete = step.approvalsCount >= totalAssignments && totalAssignments > 0;
        break;
    }
    if (!complete) return;

    // Any still-PENDING assignments on a now-complete ANY_ONE/QUORUM step
    // are administratively skipped, not left dangling (spec section 33).
    await tx.approverAssignment.updateMany({ where: { tenantId, stepInstanceId: step.id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
    await this.completeStep(tenantId, userId, step.id, 'APPROVED', tx);
  }

  private async completeStep(tenantId: string, userId: string, stepInstanceId: string, outcome: 'APPROVED' | 'REJECTED' | 'CHANGE_REQUESTED', tx: PrismaTransactionClient) {
    const step = await tx.workflowStepInstance.update({ where: { id: stepInstanceId }, data: { status: outcome, completedAt: new Date() } });
    const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: step.workflowInstanceId } });

    if (outcome === 'REJECTED') {
      await this.instances.reject(tenantId, userId, instance.id, 'Rejected at step ' + stepInstanceId, tx);
      return;
    }
    if (outcome === 'CHANGE_REQUESTED') {
      await this.instances.requestChange(tenantId, userId, instance.id, tx);
      return;
    }

    const definition = await tx.workflowStepDefinition.findUniqueOrThrow({ where: { id: step.stepDefinitionId } });

    // A stage may hold several PARALLEL steps — only advance once EVERY
    // step instance in this stage has reached a terminal state, never
    // the moment just ONE of them completes.
    const siblingSteps = await tx.workflowStepInstance.findMany({ where: { tenantId, workflowInstanceId: instance.id, definition: { stage: definition.stage } } });
    const stageStillOpen = siblingSteps.some((s) => s.status === 'NOT_ACTIVE' || s.status === 'ACTIVE' || s.status === 'WAITING');
    if (stageStillOpen) return;

    const context = instance.snapshotData as Record<string, unknown>;
    await this.instances.activateStage(tenantId, userId, instance.id, definition.stage + 1, context, tx);
  }
}
