import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { RetrievedEvidenceItem } from './ai-retrieval.service';

export interface CreateRecommendationInput {
  organizationId?: string;
  interactionId?: string;
  category: string;
  targetEntityType?: string;
  targetEntityId?: string;
  recommendation: string;
  confidenceLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  estimatedImpact?: Record<string, unknown>;
  evidence: RetrievedEvidenceItem[];
  modelVersionId?: string;
  promptVersionId?: string;
  expiresAt?: Date;
}

/**
 * AIRecommendationService (docx spec Phase 29, "Recommend" role,
 * sections 56-64). A recommendation is NEVER a business mutation (spec
 * section 49's role definitions) — `accept`/`reject` only flip status
 * for tracking; if accepting a recommendation should actually DO
 * something, that is a separate `AIActionProposalService` call the
 * caller makes on its own, never implicit here.
 */
@Injectable()
export class AIRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string | null, input: CreateRecommendationInput) {
    if (input.evidence.length === 0) {
      // spec section 64 — material evidence missing means AI should not
      // recommend strong action; we still record it but force LOW.
      input.confidenceLevel = 'LOW';
    }
    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.aIRecommendation.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          interactionId: input.interactionId,
          category: input.category,
          targetEntityType: input.targetEntityType,
          targetEntityId: input.targetEntityId,
          recommendation: input.recommendation,
          confidenceLevel: input.confidenceLevel ?? 'MEDIUM',
          estimatedImpact: (input.estimatedImpact ?? null) as object | undefined,
          modelVersionId: input.modelVersionId,
          promptVersionId: input.promptVersionId,
          expiresAt: input.expiresAt,
        },
      });
      if (input.evidence.length > 0) {
        await tx.aIEvidenceReference.createMany({
          data: input.evidence.map((e) => ({ tenantId, recommendationId: row.id, evidenceType: e.evidenceType, entityType: e.entityType, entityId: e.entityId, asOf: e.asOf, versionTag: e.versionTag, summary: e.summary })),
        });
      }
      await this.audit.record({ tenantId, organizationId: input.organizationId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: 'AIRecommendation', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { category: input.category, confidenceLevel: row.confidenceLevel } }, tx);
      return row;
    });
  }

  list(tenantId: string, filters: { status?: string; category?: string } = {}) {
    return this.prisma.aIRecommendation.findMany({ where: { tenantId, ...filters }, orderBy: { createdAt: 'desc' } });
  }

  async setStatus(tenantId: string, userId: string, id: string, status: 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'DISMISSED') {
    const row = await this.prisma.aIRecommendation.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('AIRecommendation', id);
    if (row.status === 'EXPIRED') throw new ConflictAppError(`Recommendation ${id} has expired`);
    const updated = await this.prisma.aIRecommendation.update({ where: { id }, data: { status } });
    await this.audit.record({ tenantId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: 'AIRecommendation', entityId: id, operation: 'UPDATE', action: status, userId, metadata: {} });
    return updated;
  }
}
