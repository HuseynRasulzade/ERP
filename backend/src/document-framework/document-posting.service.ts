import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentFrameworkRegistry } from './document-framework-registry.service';
import { PeriodService } from '../period/period.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import {
  ConcurrencyConflictError,
  DocumentAlreadyPostedError,
  DocumentNotPostedError,
  NotFoundAppError,
  PostingError,
  ValidationAppError,
} from '../common/errors/app-error';

/**
 * Posting infrastructure (section 10/11/13/63/64).
 *
 * Every step below runs inside ONE database transaction:
 *   lock+load document -> validate tenant/period/state -> run posting
 *   validation -> (repost: remove previous movements) -> build movements ->
 *   save movements -> (if the handler provides one) post the Accounting
 *   Core consequence -> mark posted -> write audit event -> COMMIT.
 * Any failure at any step rolls back everything — a document is never left
 * `posted = true` with partially written movements (section 11, scenario B),
 * and never posted with GL/Tax Register left half-written either (Accounting
 * Core spec section 44, Tax Engine spec section 67) — it's the same
 * transaction.
 *
 * This service never branches on document type: it only ever calls through
 * DocumentFrameworkRegistry, so a new document type never means editing
 * this file (section 12). The one exception is the generic Accounting
 * Core/Tax Register hookup below, which is itself type-agnostic — it only
 * ever looks at `handler.buildAccountingBatch` (optional) and at rows
 * keyed by `sourceDocumentType`/`sourceDocumentId`, never at a document
 * type name.
 */
@Injectable()
export class DocumentPostingService {
  private readonly logger = new Logger('DocumentPostingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: DocumentFrameworkRegistry,
    private readonly periods: PeriodService,
    private readonly audit: AuditService,
    private readonly accountingEngine: AccountingPostingEngine,
  ) {}

  async post(
    tenantId: string,
    documentType: string,
    documentId: string,
    expectedVersion: number,
    userId: string,
  ) {
    const handler = this.registry.getHandler(documentType);
    const repository = this.registry.getRepository(documentType);

    return this.prisma.runInTransaction(async (tx) => {
      const document = await repository.findById(tenantId, documentId, tx);
      if (!document) throw new NotFoundAppError(documentType, documentId);
      if (document.version !== expectedVersion) throw new ConcurrencyConflictError();

      if (document.status === 'CANCELLED' || document.status === 'DELETION_MARKED') {
        throw new ValidationAppError(`Cannot post a document in status ${document.status}`);
      }
      if (document.postingStatus === 'POSTED') {
        throw new DocumentAlreadyPostedError(documentId);
      }

      const businessDate = document.postingDate ?? document.documentDate;
      await this.periods.assertDateIsOpen(tenantId, businessDate, document.organizationId ?? undefined);

      try {
        await handler.validateForPosting(tenantId, document, tx);

        // Reposting contract (section 13): a document being posted again
        // after being unposted must never leave stale movements behind.
        await tx.registerMovement.deleteMany({
          where: { tenantId, recorderDocumentType: documentType, recorderDocumentId: documentId },
        });

        const movements = await handler.buildMovements(tenantId, document, tx);

        // Deterministic ordering (section 65): sequence is derived from a
        // per-transaction monotonic counter combined with insertion order,
        // scoped to this recorder document.
        let sequence = 0n;
        for (const movement of movements) {
          sequence += 1n;
          await tx.registerMovement.create({
            data: {
              tenantId,
              registerCode: movement.registerCode,
              recorderDocumentType: documentType,
              recorderDocumentId: documentId,
              recorderLineId: movement.recorderLineId,
              businessDate: movement.businessDate,
              movementType: movement.movementType,
              dimensions: movement.dimensions as any,
              resources: movement.resources as any,
              sequence,
            },
          });
        }

        if (handler.buildAccountingBatch) {
          // Repost contract (Accounting Core spec section 46): a stale
          // DRAFT Journal Entry left behind by a prior unpost of this same
          // source must never linger once we're about to create a fresh
          // one — delete it (it has no movements; unpost already removed
          // those) before posting the new batch.
          await tx.journalEntry.deleteMany({
            where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId, status: 'DRAFT' },
          });

          const batch = await handler.buildAccountingBatch(tenantId, document, tx);
          if (batch && batch.lines.length > 0) {
            const postedEntry = await this.accountingEngine.postBatch(
              tenantId,
              userId,
              {
                organizationId: document.organizationId!,
                businessDate,
                postingDate: businessDate,
                description: batch.description,
                operationType: batch.operationType,
                sourceDocumentType: documentType,
                sourceDocumentId: documentId,
                lines: batch.lines,
              },
              tx,
            );
            // Drilldown linkage (Tax Engine spec section 108): a handler
            // that also called TaxRegisterService.registerTaxable left its
            // TaxMovement rows with journalEntryId still null — backfill it
            // generically here rather than every handler repeating this.
            if (postedEntry) {
              await tx.taxMovement.updateMany({
                where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId, journalEntryId: null },
                data: { journalEntryId: postedEntry.id },
              });
            }
          }
        }

        const result = await repository.applyStatusPatch(
          tenantId,
          documentId,
          {
            postingStatus: 'POSTED',
            postedAt: new Date(),
            postedBy: userId,
          },
          expectedVersion,
          tx,
        );

        if (result.updatedCount === 0) {
          // Someone else changed the document between our load and our
          // write inside this same transaction attempt — reject rather
          // than silently overwrite (section 14).
          throw new ConcurrencyConflictError();
        }

        await this.audit.record(
          {
            tenantId,
            eventType: 'DOCUMENT_POSTED',
            entityType: documentType,
            entityId: documentId,
            action: 'POST',
            userId,
            newValues: { movementCount: movements.length, businessDate },
          },
          tx,
        );

        return { documentId, postingStatus: 'POSTED', movementCount: movements.length, version: result.newVersion };
      } catch (error) {
        this.logger.warn(`Posting failed for ${documentType}/${documentId}: ${(error as Error).message}`);
        // Re-throwing inside the transaction callback rolls back every
        // write above — no movement, no status flip, ever survives.
        if (error instanceof Error && !(error as any).code) {
          throw new PostingError(error.message);
        }
        throw error;
      }
    });
  }

  async unpost(tenantId: string, documentType: string, documentId: string, expectedVersion: number, userId: string) {
    const repository = this.registry.getRepository(documentType);
    const handler = this.registry.getHandler(documentType);

    return this.prisma.runInTransaction(async (tx) => {
      const document = await repository.findById(tenantId, documentId, tx);
      if (!document) throw new NotFoundAppError(documentType, documentId);
      if (document.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (document.postingStatus !== 'POSTED') throw new DocumentNotPostedError(documentId);

      const businessDate = document.postingDate ?? document.documentDate;
      await this.periods.assertDateIsOpen(tenantId, businessDate, document.organizationId ?? undefined);

      const deleted = await tx.registerMovement.deleteMany({
        where: { tenantId, recorderDocumentType: documentType, recorderDocumentId: documentId },
      });

      if (handler.undoSideEffects) {
        await handler.undoSideEffects(tenantId, document, tx);
      }

      // Generic Accounting Core / Tax Register cleanup (type-agnostic: it
      // only ever looks at rows keyed by sourceDocumentType/Id, never at
      // handler.buildAccountingBatch — a document type that never posted
      // one simply has nothing to find here). Mirrors unpost's own
      // semantics on the accounting side: transactional removal, not a
      // reversal (spec section 47 vs 48).
      const activeEntry = await tx.journalEntry.findFirst({
        where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId, status: 'POSTED' },
      });
      if (activeEntry) {
        await this.accountingEngine.unpost(tenantId, activeEntry.id, userId, activeEntry.version, tx);
      }
      await tx.taxMovement.deleteMany({
        where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId, reversalOfMovementId: null },
      });

      const result = await repository.applyStatusPatch(
        tenantId,
        documentId,
        { postingStatus: 'NOT_POSTED', postedAt: null, postedBy: null },
        expectedVersion,
        tx,
      );
      if (result.updatedCount === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'DOCUMENT_UNPOSTED',
          entityType: documentType,
          entityId: documentId,
          action: 'UNPOST',
          userId,
          oldValues: { removedMovements: deleted.count },
        },
        tx,
      );

      return { documentId, postingStatus: 'NOT_POSTED', removedMovements: deleted.count, version: result.newVersion };
    });
  }

  async cancel(tenantId: string, documentType: string, documentId: string, expectedVersion: number, userId: string) {
    const repository = this.registry.getRepository(documentType);

    return this.prisma.runInTransaction(async (tx) => {
      const document = await repository.findById(tenantId, documentId, tx);
      if (!document) throw new NotFoundAppError(documentType, documentId);
      if (document.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (document.postingStatus === 'POSTED') {
        throw new ValidationAppError('Unpost the document before cancelling it');
      }

      const result = await repository.applyStatusPatch(
        tenantId,
        documentId,
        { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: userId },
        expectedVersion,
        tx,
      );
      if (result.updatedCount === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'DOCUMENT_CANCELLED',
          entityType: documentType,
          entityId: documentId,
          action: 'CANCEL',
          userId,
        },
        tx,
      );

      return { documentId, status: 'CANCELLED', version: result.newVersion };
    });
  }
}
