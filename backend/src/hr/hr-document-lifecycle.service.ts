import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, ErrorCode, HrRuleError, NotFoundAppError } from '../common/errors/app-error';
import { HrPolicy } from './hr.constants';
import { HrPolicyService } from './hr-policy.service';

export type HrDocModel = 'hireDocument' | 'employeeTransfer' | 'terminationDocument';

const TABLE: Record<HrDocModel, string> = {
  hireDocument: 'hire_documents',
  employeeTransfer: 'employee_transfers',
  terminationDocument: 'termination_documents',
};

/**
 * HR document status machine (spec 64/65/81), shared by Hire/Rehire,
 * Transfer and Termination:
 *
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> POSTED -> REVERSED
 *     \________________\___________\-> CANCELLED
 *
 * APPROVED != POSTED: approval never writes HR history; only POST does. HR
 * "posting" is an effective-dated history write, never a GL movement
 * (spec 65), so these documents deliberately do not go through the
 * accounting DocumentPostingService (which is bound to accounting periods
 * and delete-and-regenerate register semantics that would break immutable
 * HR history) — they reuse numbering, audit, DocumentLink, idempotency and
 * organization access instead. Full multi-step approval routing is Phase 26;
 * this is the single-step foundation with segregation of duties.
 */
@Injectable()
export class HrDocumentLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: HrPolicyService,
  ) {}

  private delegate(db: PrismaTransactionClient, model: HrDocModel): any {
    return (db as any)[model];
  }

  async lock(tx: PrismaTransactionClient, model: HrDocModel, tenantId: string, id: string) {
    await tx.$queryRawUnsafe(`SELECT id FROM ${TABLE[model]} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, id, tenantId);
    const doc = await this.delegate(tx, model).findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundAppError(model, id);
    return doc;
  }

  /** Returns 'ALREADY_POSTED' for an idempotent re-post, throws otherwise. */
  assertPostable(doc: { status: string; version: number; number: string }, policy: HrPolicy, expectedVersion?: number): 'OK' | 'ALREADY_POSTED' {
    if (doc.status === 'POSTED') return 'ALREADY_POSTED';
    if (expectedVersion !== undefined && expectedVersion !== doc.version) throw new ConcurrencyConflictError();
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(doc.status)) {
      throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Document ${doc.number} is ${doc.status} and cannot be posted`, 409);
    }
    if (doc.status === 'PENDING_APPROVAL') throw new HrRuleError(ErrorCode.HR_APPROVAL_REQUIRED, `Document ${doc.number} is pending approval and cannot be posted yet`, 409);
    if (policy.requireApproval && doc.status !== 'APPROVED') {
      throw new HrRuleError(ErrorCode.HR_APPROVAL_REQUIRED, `Document ${doc.number} must be approved before posting (HR policy requireApproval)`, 409);
    }
    return 'OK';
  }

  private async transition(
    model: HrDocModel,
    entityType: string,
    tenantId: string,
    id: string,
    userId: string,
    from: string[],
    to: string,
    data: Record<string, unknown>,
    expectedVersion?: number,
    reason?: string,
    guard?: (doc: any, policy: HrPolicy) => void,
  ) {
    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lock(tx, model, tenantId, id);
      if (expectedVersion !== undefined && doc.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (!from.includes(doc.status)) throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Document ${doc.number} is ${doc.status}; cannot move it to ${to}`, 409);
      if (guard) guard(doc, await this.policy.getPolicy(tenantId));
      const updated = await this.delegate(tx, model).update({ where: { id }, data: { ...data, status: to, updatedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: `${entityType}_${to}`, entityType, entityId: id, action: to, userId, oldValues: { status: doc.status }, newValues: { status: to }, reason }, tx);
      return updated;
    });
  }

  submit(model: HrDocModel, entityType: string, tenantId: string, id: string, userId: string, expectedVersion?: number) {
    return this.transition(model, entityType, tenantId, id, userId, ['DRAFT'], 'PENDING_APPROVAL', { submittedAt: new Date(), submittedBy: userId }, expectedVersion);
  }

  /** Segregation of duties (spec 81): the creator cannot approve their own
   * hire/transfer/termination when the policy is on (default). */
  approve(model: HrDocModel, entityType: string, tenantId: string, id: string, userId: string, expectedVersion?: number) {
    return this.transition(model, entityType, tenantId, id, userId, ['DRAFT', 'PENDING_APPROVAL'], 'APPROVED', { approvedAt: new Date(), approvedBy: userId }, expectedVersion, undefined, (doc, policy) => {
      if (policy.segregationOfDuties && doc.createdBy === userId) {
        throw new HrRuleError(ErrorCode.HR_SEGREGATION_OF_DUTIES, `Document ${doc.number} was created by you; another user must approve it (segregation of duties)`, 403);
      }
    });
  }

  reject(model: HrDocModel, entityType: string, tenantId: string, id: string, userId: string, reason?: string) {
    return this.transition(model, entityType, tenantId, id, userId, ['PENDING_APPROVAL', 'APPROVED'], 'DRAFT', { approvedAt: null, approvedBy: null }, undefined, reason);
  }

  cancel(model: HrDocModel, entityType: string, tenantId: string, id: string, userId: string, expectedVersion?: number, reason?: string) {
    return this.transition(model, entityType, tenantId, id, userId, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], 'CANCELLED', { cancelledAt: new Date(), cancelledBy: userId }, expectedVersion, reason);
  }
}
