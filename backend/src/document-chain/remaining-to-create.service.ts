import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface RemainingBreakdown {
  eligibleCapacity: Decimal;
  committedConsumption: Decimal;
  activeClaims: Decimal;
  remaining: Decimal;
  blockers: string[];
}

/**
 * RemainingToCreateService (docx spec Phase 27, sections 41-49). The
 * single formula the whole engine relies on:
 *
 *   remaining = eligibleCapacity(source line, metric)
 *             − committedConsumption(DocumentLineLink, net CONSUME-RELEASE)
 *             − activeClaims(SourceCreationClaim, ACTIVE, not expired)
 *
 * `eligibleCapacity` is always asked of the source module's OWN
 * registered `SourceEligibilityAdapter` (docs/DOCUMENT_CHAIN.md section
 * C) — this service never reads a source document's mutable "current
 * quantity" field itself and never guesses. `committedConsumption` reads
 * the SAME `DocumentLineLink` table every prior phase's own bespoke
 * `remainingXxx()` helper already writes to (extended additively in this
 * phase, never duplicated — see docs/DOCUMENT_CHAIN.md section B), keyed
 * by the transformation's own code as the `relationType` so it can never
 * collide with a pre-existing relationType string like
 * 'ORDER_TO_INVOICE'.
 */
@Injectable()
export class RemainingToCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: DocumentFrameworkRegistry,
  ) {}

  async computeRemaining(
    tenantId: string,
    sourceDocumentType: string,
    sourceDocumentId: string,
    sourceLineId: string,
    transformationCode: string,
    metric: string,
    tx?: PrismaTransactionClient,
  ): Promise<RemainingBreakdown> {
    const client = tx ?? this.prisma;
    const adapter = this.registry.getEligibilityAdapter(sourceDocumentType);
    if (!adapter) {
      throw new ValidationAppError(`No SourceEligibilityAdapter registered for source document type '${sourceDocumentType}' — this source cannot participate in the governed Create Based On engine yet`);
    }

    const eligibleCapacity = await adapter.getEligibleCapacity(tenantId, sourceLineId, metric, tx);
    const blockers = adapter.getEligibilityBlockers ? await adapter.getEligibilityBlockers(tenantId, sourceDocumentId, tx) : [];

    const consumed = await client.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType, sourceLineId, relationType: transformationCode, metric, movementType: 'CONSUME' },
      _sum: { quantity: true },
    });
    const released = await client.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType, sourceLineId, relationType: transformationCode, metric, movementType: { in: ['RELEASE', 'REVERSE'] } },
      _sum: { quantity: true },
    });
    const committedConsumption = new Decimal((consumed._sum.quantity ?? 0).toString()).minus((released._sum.quantity ?? 0).toString());

    const claims = await client.sourceCreationClaim.aggregate({
      where: {
        tenantId,
        sourceDocumentType,
        sourceLineId,
        metric,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _sum: { claimedQuantity: true },
    });
    const activeClaims = new Decimal((claims._sum.claimedQuantity ?? 0).toString());

    const remaining = eligibleCapacity.minus(committedConsumption).minus(activeClaims);
    return { eligibleCapacity, committedConsumption, activeClaims, remaining: remaining.lt(0) ? new Decimal(0) : remaining, blockers };
  }
}
