import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { IntegrationMessageService } from './integration-message.service';

/**
 * IntegrationDeadLetterService (docx spec Phase 28, sections 69-73,
 * 208). `replay` creates a NEW message attempt and, when the caller
 * supplies a fresh mapping version, records that a different mapping
 * was used this time — it NEVER deletes or mutates the original
 * dead-letter/attempt history (spec section 208's own "original failure
 * remains audit-visible" and rule 238's "dead-letter history-ni replay
 * zamanı silmə").
 */
@Injectable()
export class IntegrationDeadLetterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messages: IntegrationMessageService,
  ) {}

  async create(tenantId: string, messageId: string, failureReason: string, attemptCount: number, options: { payloadReference?: string; errorTraceReference?: string } = {}) {
    const row = await this.prisma.integrationDeadLetter.create({
      data: { tenantId, messageId, failureReason, attemptCount, payloadReference: options.payloadReference, errorTraceReference: options.errorTraceReference },
    });
    await this.messages.transition(tenantId, messageId, 'DEAD_LETTER');
    await this.audit.record({ tenantId, eventType: 'DeadLetterCreated', eventCategory: 'INTEGRATION', entityType: 'IntegrationDeadLetter', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId: null, metadata: { messageId, failureReason, attemptCount } });
    return row;
  }

  list(tenantId: string, filters: { status?: string } = {}) {
    return this.prisma.integrationDeadLetter.findMany({ where: { tenantId, ...filters }, orderBy: { createdAt: 'desc' } });
  }

  async assign(tenantId: string, userId: string, id: string, owner: string) {
    await this.get(tenantId, id);
    return this.prisma.integrationDeadLetter.update({ where: { id }, data: { assignedOwner: owner, status: 'IN_REVIEW' } });
  }

  async resolve(tenantId: string, userId: string, id: string, resolution: string, outcome: 'RESOLVED' | 'IGNORED_WITH_REASON') {
    const dl = await this.get(tenantId, id);
    const updated = await this.prisma.integrationDeadLetter.update({ where: { id }, data: { status: outcome, resolution, resolvedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'DeadLetterCreated', eventCategory: 'INTEGRATION', entityType: 'IntegrationDeadLetter', entityId: id, operation: 'UPDATE', action: outcome, userId, metadata: { resolution, messageId: dl.messageId } });
    return updated;
  }

  /** Marks the dead letter RETRY_REQUESTED — the actual re-processing is
   * driven by `IntegrationImportService.replay` (which records the new
   * attempt), this method only flags intent so a worklist can pick it
   * up. */
  async requestRetry(tenantId: string, userId: string, id: string) {
    const dl = await this.get(tenantId, id);
    if (dl.status === 'RESOLVED') throw new ConflictAppError(`Dead letter ${id} is already resolved`);
    return this.prisma.integrationDeadLetter.update({ where: { id }, data: { status: 'RETRY_REQUESTED' } });
  }

  private async get(tenantId: string, id: string) {
    const row = await this.prisma.integrationDeadLetter.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('IntegrationDeadLetter', id);
    return row;
  }
}
