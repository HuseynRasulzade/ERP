import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentFrameworkRegistry } from './document-framework-registry.service';
import { PeriodService } from '../period/period.service';
import { AuditService } from '../audit/audit.service';
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
 *   save movements -> mark posted -> write audit event -> COMMIT.
 * Any failure at any step rolls back everything — a document is never left
 * `posted = true` with partially written movements (section 11, scenario B).
 *
 * This service never branches on document type: it only ever calls through
 * DocumentFrameworkRegistry, so a new document type never means editing
 * this file (section 12).
 */
@Injectable()
export class DocumentPostingService {
  private readonly logger = new Logger('DocumentPostingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: DocumentFrameworkRegistry,
    private readonly periods: PeriodService,
    private readonly audit: AuditService,
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
