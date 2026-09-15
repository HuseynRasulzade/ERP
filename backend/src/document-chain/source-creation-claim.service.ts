import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError } from '../common/errors/app-error';
import { RemainingToCreateService } from './remaining-to-create.service';

/**
 * SourceCreationClaimService (docx spec Phase 27, sections 46-49). A
 * claim is a TEMPORARY concurrency-control reservation — "I intend to
 * consume up to X of this source line" — distinct from actual
 * consumption (`DocumentLineLink`, written only once a target document
 * genuinely exists). Two users opening "Create Invoice" on the same
 * shipment line at once each get a claim; the second claim that would
 * push committed+claimed past eligible capacity is rejected outright
 * (spec section 47 — claims never overcommit, unlike a soft UI-only
 * lock). `SOFT_CLAIM` (default) still blocks other claims but is
 * advisory for direct-write paths that bypass this service; `HARD_CLAIM`
 * is reserved as a stronger mode a future DB-level lock could implement
 * — this build gives both policies the same enforcement (disclosed,
 * docs/DOCUMENT_CHAIN.md section D).
 */
@Injectable()
export class SourceCreationClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remaining: RemainingToCreateService,
  ) {}

  async claim(
    tenantId: string,
    userId: string,
    params: {
      transformationVersionId: string;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceLineId: string;
      transformationCode: string;
      metric: string;
      quantity: Decimal;
      ttlMinutes?: number;
    },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const breakdown = await this.remaining.computeRemaining(tenantId, params.sourceDocumentType, params.sourceDocumentId, params.sourceLineId, params.transformationCode, params.metric, tx);
    if (params.quantity.gt(breakdown.remaining)) {
      throw new ConflictAppError(`Claim of ${params.quantity.toFixed(6)} exceeds remaining eligible ${breakdown.remaining.toFixed(6)} for source line ${params.sourceLineId}`);
    }

    return client.sourceCreationClaim.create({
      data: {
        tenantId,
        transformationVersionId: params.transformationVersionId,
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        sourceLineId: params.sourceLineId,
        metric: params.metric,
        claimedQuantity: params.quantity.toString(),
        status: 'ACTIVE',
        createdBy: userId,
        expiresAt: params.ttlMinutes ? new Date(Date.now() + params.ttlMinutes * 60_000) : null,
      },
    });
  }

  async release(tenantId: string, claimId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const claim = await client.sourceCreationClaim.findFirst({ where: { id: claimId, tenantId } });
    if (!claim) throw new NotFoundAppError('SourceCreationClaim', claimId);
    if (claim.status !== 'ACTIVE') return claim;
    return client.sourceCreationClaim.update({ where: { id: claimId }, data: { status: 'RELEASED' } });
  }

  async commit(tenantId: string, claimId: string, targetDocumentType: string, targetDocumentId: string, tx: PrismaTransactionClient) {
    const claim = await tx.sourceCreationClaim.findFirst({ where: { id: claimId, tenantId } });
    if (!claim) throw new NotFoundAppError('SourceCreationClaim', claimId);
    return tx.sourceCreationClaim.update({
      where: { id: claimId },
      data: { status: 'COMMITTED', targetDraftDocumentType: targetDocumentType, targetDraftDocumentId: targetDocumentId },
    });
  }

  /** Sweeps expired ACTIVE claims (spec section 48's own "a claim is not
   * forever" — no scheduler is wired to call this automatically in this
   * build, same disclosed gap pattern as Phase 26's
   * `WorkflowEscalationService.runDueEscalations`; an admin/health
   * endpoint or external cron can call it). */
  async expireDueClaims(tenantId: string) {
    const result = await this.prisma.sourceCreationClaim.updateMany({
      where: { tenantId, status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return { expiredCount: result.count };
  }

  list(tenantId: string, sourceDocumentType: string, sourceDocumentId: string) {
    return this.prisma.sourceCreationClaim.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId }, orderBy: { createdAt: 'desc' } });
  }
}
