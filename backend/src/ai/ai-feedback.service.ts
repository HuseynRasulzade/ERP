import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * AIFeedbackService (docx spec Phase 29, sections 129-131). Feedback
 * ONLY ever lands in this append-only table — there is no code path in
 * this module that feeds a feedback row back into an active model/
 * prompt in real time (spec section 131/section 235's own explicit
 * "never real-time uncontrolled train the model from user feedback").
 * It becomes an `AIEvaluationCase` candidate only through a deliberate,
 * separate human/governance step.
 */
@Injectable()
export class AIFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async record(tenantId: string, userId: string, input: { interactionId?: string; recommendationId?: string; actionProposalId?: string; rating: string; feedbackType: string; reason?: string; correctedResultReference?: string }) {
    const row = await this.prisma.aIFeedback.create({
      data: { tenantId, userId, interactionId: input.interactionId, recommendationId: input.recommendationId, actionProposalId: input.actionProposalId, rating: input.rating, feedbackType: input.feedbackType, reason: input.reason, correctedResultReference: input.correctedResultReference },
    });
    await this.audit.record({ tenantId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: 'AIFeedback', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { rating: input.rating, feedbackType: input.feedbackType } });
    return row;
  }

  list(tenantId: string, filters: { rating?: string } = {}) {
    return this.prisma.aIFeedback.findMany({ where: { tenantId, ...filters }, orderBy: { createdAt: 'desc' } });
  }
}
