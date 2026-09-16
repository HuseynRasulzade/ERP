import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { ApprovalPlanRegistryService } from './approval-plan-registry.service';

/**
 * Purpose-built multi-stage approval engine (MVP scope of the eventual
 * Phase 26 workflow engine — see docs/APPROVALS.md). Three-axis principle:
 * approvalStatus is independent of DocumentStatus/PostingStatus — approving
 * a document never posts it; posting/next-document-creation is gated on
 * approvalStatus separately, by each document type's own service code.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: ApprovalPlanRegistryService,
  ) {}

  private getProvider(documentType: string) {
    const provider = this.registry.get(documentType);
    if (!provider) throw new ValidationAppError(`No approval plan provider registered for ${documentType}`);
    return provider;
  }

  /** Creates the ApprovalStep rows for a freshly-created document and sets
   * its approvalStatus. Must run inside the same transaction as document
   * creation, so a document is never briefly visible without its steps. */
  async createStepsForDocument(tenantId: string, organizationId: string, documentType: string, documentId: string, tx: PrismaTransactionClient) {
    const provider = this.getProvider(documentType);
    const document = await provider.loadDocument(tenantId, documentId, tx);
    if (!document) throw new NotFoundAppError(documentType, documentId);

    const plan = await provider.planSteps(tenantId, organizationId, document, tx);
    if (plan.length === 0) {
      await provider.setApprovalStatus(tenantId, documentId, 'NOT_REQUIRED', tx);
      return;
    }

    for (const step of plan) {
      await tx.approvalStep.create({
        data: {
          tenantId,
          documentType,
          documentId,
          sequence: step.sequence,
          stepType: step.stepType,
          status: step.skipped ? 'SKIPPED' : 'PENDING',
        },
      });
    }
    await provider.setApprovalStatus(tenantId, documentId, 'PENDING', tx);
  }

  async getSteps(tenantId: string, documentType: string, documentId: string) {
    return this.prisma.approvalStep.findMany({
      where: { tenantId, documentType, documentId },
      orderBy: { sequence: 'asc' },
    });
  }

  async approve(tenantId: string, organizationId: string, documentType: string, documentId: string, userId: string, comment?: string) {
    return this.decide(tenantId, organizationId, documentType, documentId, userId, 'APPROVE', comment);
  }

  async reject(tenantId: string, organizationId: string, documentType: string, documentId: string, userId: string, comment?: string) {
    return this.decide(tenantId, organizationId, documentType, documentId, userId, 'REJECT', comment);
  }

  private async decide(
    tenantId: string,
    organizationId: string,
    documentType: string,
    documentId: string,
    userId: string,
    decision: 'APPROVE' | 'REJECT',
    comment?: string,
  ) {
    const provider = this.getProvider(documentType);

    return this.prisma.runInTransaction(async (tx) => {
      const document = await provider.loadDocument(tenantId, documentId, tx);
      if (!document) throw new NotFoundAppError(documentType, documentId);

      const createdBy = provider.getCreatedBy(document);
      if (createdBy && createdBy === userId) {
        throw new ValidationAppError('You cannot approve or reject a document you created yourself');
      }

      const steps = await tx.approvalStep.findMany({
        where: { tenantId, documentType, documentId },
        orderBy: { sequence: 'asc' },
      });
      if (steps.length === 0) throw new ValidationAppError('This document has no approval steps');

      const pending = steps.find((s) => s.status === 'PENDING');
      if (!pending) throw new ValidationAppError('This document has no pending approval step');

      const eligible = await provider.resolveApprover(tenantId, organizationId, pending.stepType, document, userId, tx);
      if (!eligible) throw new ValidationAppError(`You are not eligible to act on the ${pending.stepType} approval step`);

      if (decision === 'REJECT') {
        const result = await tx.approvalStep.updateMany({
          where: { id: pending.id, status: 'PENDING' },
          data: { status: 'REJECTED', approvedBy: userId, approvedAt: new Date(), comment },
        });
        if (result.count === 0) throw new ConcurrencyConflictError();
        await tx.approvalStep.updateMany({
          where: { tenantId, documentType, documentId, status: 'PENDING' },
          data: { status: 'SKIPPED' },
        });
        await provider.setApprovalStatus(tenantId, documentId, 'REJECTED', tx);
        await this.audit.record(
          { tenantId, eventType: 'APPROVAL_STEP_REJECTED', entityType: documentType, entityId: documentId, action: 'REJECT', userId, newValues: { stepType: pending.stepType, sequence: pending.sequence, comment } },
          tx,
        );
        return { approvalStatus: 'REJECTED' as const };
      }

      const result = await tx.approvalStep.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), comment },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();
      await this.audit.record(
        { tenantId, eventType: 'APPROVAL_STEP_APPROVED', entityType: documentType, entityId: documentId, action: 'APPROVE', userId, newValues: { stepType: pending.stepType, sequence: pending.sequence, comment } },
        tx,
      );

      const remaining = await tx.approvalStep.count({
        where: { tenantId, documentType, documentId, status: 'PENDING' },
      });
      if (remaining === 0) {
        await provider.setApprovalStatus(tenantId, documentId, 'APPROVED', tx);
        return { approvalStatus: 'APPROVED' as const };
      }
      return { approvalStatus: 'PENDING' as const };
    });
  }
}
