import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SegregationOfDutiesService } from './segregation-of-duties.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface ExecutionGateResult {
  allowed: boolean;
  reason?: string;
  workflowInstanceId?: string;
}

/**
 * WorkflowExecutionGateService (docx spec Phase 26, sections 59-64,
 * 113-114, 123). The stable API business modules call before a critical
 * action (`assertActionApproved`) — approval never executes the action
 * automatically by default (spec section 61); this only ANSWERS
 * "is this action currently permitted," and records the answer
 * (`ExecutionGatePassed`/`ExecutionGateDenied`) for Phase 25's own
 * audit trail. Re-validates the business-object version/snapshot hash
 * at the moment of the check (spec sections 58, 123, 198) — an approval
 * whose snapshot no longer matches the CURRENT business object state is
 * denied even if its own `status` still says APPROVED, because a
 * material change should already have invalidated it via
 * `WorkflowReapprovalService` — this is the second, execution-time line
 * of defense (spec section 101's own "Approver conflict after role
 * change ... Execution-time SoD may still revalidate").
 */
@Injectable()
export class WorkflowExecutionGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async assertExecutionAllowed(tenantId: string, dto: { businessObjectType: string; businessObjectId: string; requestedAction: string; currentBusinessVersion: number; executorUserId: string; actionCategory?: string }): Promise<ExecutionGateResult> {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { tenantId, businessObjectType: dto.businessObjectType, businessObjectId: dto.businessObjectId, requestedAction: dto.requestedAction },
      orderBy: { startedAt: 'desc' },
    });

    let result: ExecutionGateResult;
    if (!instance) {
      result = { allowed: false, reason: 'No workflow instance exists for this business object/action.' };
    } else if (instance.status !== 'APPROVED') {
      result = { allowed: false, reason: `Workflow is ${instance.status}, not APPROVED.`, workflowInstanceId: instance.id };
    } else if (instance.businessVersion !== dto.currentBusinessVersion) {
      result = { allowed: false, reason: 'Approval is no longer valid because the business object changed after approval (snapshot/version mismatch).', workflowInstanceId: instance.id };
    } else if (instance.executionStatus === 'EXECUTED') {
      result = { allowed: false, reason: 'This approved action has already been executed once.', workflowInstanceId: instance.id };
    } else {
      const approverNotExecutor = dto.actionCategory ? await this.sod.checkRelation(tenantId, dto.actionCategory, 'APPROVER_NOT_EXECUTOR', instance.initiatedBy, dto.executorUserId) : { allowed: true };
      result = approverNotExecutor.allowed ? { allowed: true, workflowInstanceId: instance.id } : { allowed: false, reason: `Segregation-of-duties: creator/approver cannot also execute (${approverNotExecutor.violatedRule}).`, workflowInstanceId: instance.id };
    }

    await this.audit.record({
      tenantId,
      organizationId: instance?.organizationId,
      eventType: result.allowed ? 'EXECUTION_GATE_PASSED' : 'EXECUTION_GATE_DENIED',
      eventCategory: 'WORKFLOW',
      operation: result.allowed ? 'APPROVE' : 'REJECT',
      entityType: 'WorkflowInstance',
      entityId: instance?.id ?? dto.businessObjectId,
      documentType: dto.businessObjectType,
      documentId: dto.businessObjectId,
      action: 'EXECUTION_GATE',
      userId: dto.executorUserId,
      success: result.allowed,
      failureCode: result.allowed ? undefined : 'EXECUTION_DENIED',
      reason: result.reason,
    });

    return result;
  }

  /** Called by the business service immediately BEFORE performing the
   * action, after `assertExecutionAllowed` returned `allowed: true`
   * (spec section 63's own `EXECUTION_STARTED`). */
  async markExecutionStarted(tenantId: string, workflowInstanceId: string) {
    return this.prisma.workflowInstance.updateMany({ where: { id: workflowInstanceId, tenantId, executionStatus: 'NOT_EXECUTED' }, data: { executionStatus: 'EXECUTION_STARTED' } });
  }

  /** Execution failure never resets the approval itself unless the
   * business object also changed (spec section 64) — the caller may
   * retry `markExecutionStarted` again after this. */
  async markExecutionResult(tenantId: string, workflowInstanceId: string, outcome: 'EXECUTED' | 'EXECUTION_FAILED') {
    return this.prisma.workflowInstance.updateMany({ where: { id: workflowInstanceId, tenantId }, data: { executionStatus: outcome } });
  }

  async assertApprovedOrThrow(tenantId: string, dto: { businessObjectType: string; businessObjectId: string; requestedAction: string; currentBusinessVersion: number; executorUserId: string; actionCategory?: string }): Promise<string> {
    const result = await this.assertExecutionAllowed(tenantId, dto);
    if (!result.allowed) throw new ValidationAppError(result.reason ?? 'Action is not approved for execution.');
    return result.workflowInstanceId!;
  }
}
