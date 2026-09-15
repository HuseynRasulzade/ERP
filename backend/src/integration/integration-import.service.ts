import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { IntegrationMessageService } from './integration-message.service';
import { IntegrationStagingService } from './integration-staging.service';
import { IntegrationDeadLetterService } from './integration-dead-letter.service';
import { IntegrationRetryService } from './integration-retry.service';
import { IntegrationCommandRegistry, ImportMode, IntegrationActorContext } from './integration-command-registry.service';

export interface ImportRecordInput {
  sequence: number;
  canonicalData: Record<string, unknown>;
  mappingVersionId?: string;
}

export interface ImportBatchInput {
  endpointId: string;
  contractCode: string;
  mode: ImportMode;
  strictAllOrNothing?: boolean;
  dryRun?: boolean;
  serviceAccountUserId: string;
  records: ImportRecordInput[];
}

/**
 * IntegrationImportService (docx spec Phase 28, sections 54-65, 148-
 * 150). The ONLY path from a staged canonical record to an actual
 * business effect — always through `IntegrationCommandRegistry`'s
 * domain command handlers, never a raw insert (spec's own repeated
 * "Integration layer business tables-ə birbaşa yazmır"). Whether a
 * posted document can be blind-overwritten (spec section 57) is the
 * REGISTERED HANDLER's own decision — it owns the target table and its
 * posting rules; this service only passes `mode` through and reports
 * whatever `DomainCommandResult.status` the handler returns.
 *
 * `dryRun` (spec section 148) short-circuits before the domain command
 * is ever invoked — a preview only ever produces staging records, never
 * a `IntegrationImportJob` counted as CREATED/UPDATED.
 */
@Injectable()
export class IntegrationImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly messages: IntegrationMessageService,
    private readonly staging: IntegrationStagingService,
    private readonly deadLetters: IntegrationDeadLetterService,
    private readonly retry: IntegrationRetryService,
    private readonly registry: IntegrationCommandRegistry,
  ) {}

  async runBatch(tenantId: string, input: ImportBatchInput) {
    const job = await this.prisma.integrationImportJob.create({
      data: { tenantId, endpointId: input.endpointId, mode: input.mode, strictAllOrNothing: input.strictAllOrNothing ?? false, dryRun: input.dryRun ?? false, requestedBy: input.serviceAccountUserId, status: 'RUNNING' },
    });
    const batch = await this.staging.createBatch(tenantId, { endpointId: input.endpointId, contractCode: input.contractCode, strictAllOrNothing: input.strictAllOrNothing, createdBy: input.serviceAccountUserId });

    const stagedRecords = await Promise.all(
      input.records.map((r) => this.staging.addRecord(tenantId, batch.id, { sequence: r.sequence, canonicalData: r.canonicalData, mappingVersionId: r.mappingVersionId })),
    );

    if (input.strictAllOrNothing) {
      // Pre-flight: every record's handler must be resolvable at all,
      // otherwise reject the WHOLE batch before touching business data
      // (spec section 64 — configurable all-or-nothing).
      if (!this.registry.has(input.contractCode)) {
        throw new ValidationAppError(`No domain command handler registered for contract '${input.contractCode}' — strict batch rejected before any record was processed`);
      }
    }

    const counts = { created: 0, updated: 0, skipped: 0, duplicate: 0, rejected: 0, failed: 0, waitingManual: 0 };
    const perRecordResults: { sequence: number; status: string; targetEntityId?: string }[] = [];

    const process = async () => {
      for (const record of stagedRecords) {
        try {
          const result = await this.importOne(tenantId, input, record.id, record.canonicalData as Record<string, unknown>);
          perRecordResults.push({ sequence: record.sequence, status: result.status, targetEntityId: result.targetEntityId });
          switch (result.status) {
            case 'CREATED':
              counts.created++;
              break;
            case 'UPDATED':
              counts.updated++;
              break;
            case 'SKIPPED':
              counts.skipped++;
              break;
            case 'DUPLICATE':
              counts.duplicate++;
              break;
            case 'REJECTED':
              counts.rejected++;
              if (input.strictAllOrNothing) throw new ConflictAppError(`Record ${record.sequence} rejected: ${result.rejectionReason} — strict batch rolled back`);
              break;
            case 'FAILED':
              counts.failed++;
              if (input.strictAllOrNothing) throw new ConflictAppError(`Record ${record.sequence} failed: ${result.rejectionReason} — strict batch rolled back`);
              break;
            case 'WAITING_MANUAL':
              counts.waitingManual++;
              break;
          }
        } catch (err) {
          if (input.strictAllOrNothing) throw err;
          counts.failed++;
          perRecordResults.push({ sequence: record.sequence, status: 'FAILED' });
        }
      }
    };

    let jobStatus: string;
    try {
      if (input.strictAllOrNothing && !input.dryRun) {
        await this.prisma.runInTransaction(async () => process());
      } else {
        await process();
      }
      jobStatus = counts.rejected + counts.failed === 0 ? 'COMPLETED' : counts.created + counts.updated + counts.skipped + counts.duplicate + counts.waitingManual > 0 ? 'PARTIALLY_COMPLETED' : 'FAILED';
    } catch (err) {
      jobStatus = 'FAILED';
      await this.prisma.integrationImportJob.update({ where: { id: job.id }, data: { status: jobStatus, completedAt: new Date() } });
      throw err;
    }

    await this.staging.finalizeBatchCounts(tenantId, batch.id);
    const updatedJob = await this.prisma.integrationImportJob.update({
      where: { id: job.id },
      data: { status: jobStatus, completedAt: new Date(), createdCount: counts.created, updatedCount: counts.updated, skippedCount: counts.skipped, duplicateCount: counts.duplicate, rejectedCount: counts.rejected, failedCount: counts.failed, waitingManualCount: counts.waitingManual },
    });

    return { job: updatedJob, batch, results: perRecordResults };
  }

  /** Replay (spec sections 72-73, 208): creates a NEW message attempt
   * and staging record referencing the ORIGINAL message — it never
   * deletes or mutates the prior failed attempt/dead-letter row (spec
   * rule 238). Callers pass the (possibly newly mapped) canonical data
   * and which mapping version produced it, so the mapping-version-used
   * lineage differs visibly from the original failed attempt. */
  async replayMessage(tenantId: string, serviceAccountUserId: string, messageId: string, contractCode: string, mode: ImportMode, canonicalData: Record<string, unknown>, mappingVersionId?: string) {
    const message = await this.messages.get(tenantId, messageId);
    if (!message) throw new ValidationAppError(`Message ${messageId} not found`);

    const batch = await this.staging.createBatch(tenantId, { endpointId: message.endpointId, contractCode, sourceReference: `replay:${messageId}`, createdBy: serviceAccountUserId });
    const record = await this.staging.addRecord(tenantId, batch.id, { messageId, sequence: 1, canonicalData, mappingVersionId });

    try {
      const result = await this.importOne(tenantId, { endpointId: message.endpointId, contractCode, mode, serviceAccountUserId, records: [] }, record.id, canonicalData);
      await this.messages.recordAttempt(tenantId, messageId, { result: result.status === 'FAILED' || result.status === 'REJECTED' ? 'FAILED' : 'SUCCESS', errorMessage: result.rejectionReason });
      await this.messages.transition(tenantId, messageId, result.status === 'FAILED' || result.status === 'REJECTED' ? 'REJECTED' : 'PROCESSED');
      await this.audit.record({ tenantId, eventType: 'MessageReplayed', eventCategory: 'INTEGRATION', entityType: 'IntegrationMessage', entityId: messageId, operation: 'UPDATE', action: 'REPLAY', userId: serviceAccountUserId, metadata: { contractCode, mode, mappingVersionId, resultStatus: result.status } });
      return result;
    } catch (err) {
      await this.messages.recordAttempt(tenantId, messageId, { result: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async importOne(tenantId: string, input: ImportBatchInput, stagingRecordId: string, canonicalData: Record<string, unknown>) {
    await this.staging.updateRecordStatus(tenantId, stagingRecordId, { validationStatus: 'SCHEMA_VALID', mappingStatus: 'MAPPED' });

    if (input.dryRun) {
      const wouldRun = this.registry.has(input.contractCode);
      await this.staging.updateRecordStatus(tenantId, stagingRecordId, { importStatus: 'SKIPPED', errorList: wouldRun ? undefined : ['No domain command handler registered — dry run cannot preview a business effect'] });
      return { status: 'SKIPPED' as const };
    }

    const handler = this.registry.get(input.contractCode);
    const actor: IntegrationActorContext = { actorType: 'INTEGRATION', endpointId: input.endpointId, serviceAccountUserId: input.serviceAccountUserId };

    const result = await this.prisma.runInTransaction((tx) => handler.execute(tenantId, actor, canonicalData, input.mode, tx));

    await this.staging.updateRecordStatus(tenantId, stagingRecordId, {
      importStatus: result.status,
      targetEntityType: result.targetEntityType,
      targetEntityId: result.targetEntityId,
      errorList: result.rejectionReason ? [result.rejectionReason] : undefined,
    });

    await this.audit.record({ tenantId, eventType: result.status === 'REJECTED' || result.status === 'FAILED' ? 'ImportRejected' : 'ImportProcessed', eventCategory: 'INTEGRATION', entityType: result.targetEntityType ?? 'IntegrationStagingRecord', entityId: result.targetEntityId ?? stagingRecordId, operation: 'CREATE', action: result.status, userId: input.serviceAccountUserId, metadata: { contractCode: input.contractCode, mode: input.mode, endpointId: input.endpointId } });

    return result;
  }
}
