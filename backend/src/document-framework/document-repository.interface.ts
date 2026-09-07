import { PrismaTransactionClient } from '../prisma/prisma.service';
import { BaseDocumentFields, DocumentStatus, PostingStatus } from './base-document';

export interface DocumentStatusPatch {
  status?: DocumentStatus;
  postingStatus?: PostingStatus;
  postedAt?: Date | null;
  postedBy?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
}

/**
 * Every concrete document type registers one of these adapters so the
 * generic DocumentPostingService can load/lock/update it without knowing
 * its concrete Prisma model — this is the seam that lets later phases plug
 * a brand new document table into the shared posting engine (section 8/70)
 * without that engine ever depending on business modules.
 */
export interface DocumentRepositoryAdapter {
  readonly documentType: string;

  findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null>;

  /**
   * Applies a status transition guarded by optimistic concurrency
   * (section 14): must update 0 rows — and the caller must treat that as
   * ConcurrencyConflictError — when `expectedVersion` no longer matches.
   * Returns the new version on success.
   */
  applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ): Promise<{ updatedCount: number; newVersion: number }>;

  /** Used by CreateBasedOnService (section 27) to materialize the target
   * document a mapper produced, inside the same transaction as the link. */
  create(
    tenantId: string,
    input: Record<string, unknown>,
    createdBy: string,
    tx: PrismaTransactionClient,
  ): Promise<BaseDocumentFields>;
}
