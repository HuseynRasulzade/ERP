import { PrismaTransactionClient } from '../prisma/prisma.service';
import { BaseDocumentFields } from './base-document';

export interface RegisterMovementInput {
  registerCode: string;
  recorderLineId?: string;
  businessDate: Date;
  movementType?: string;
  dimensions?: Record<string, unknown>;
  resources?: Record<string, unknown>;
}

/**
 * DocumentPostingHandler (section 10/12).
 *
 * Each document type registers exactly one handler. DocumentPostingService
 * never branches on `document.type === ...` — it looks the handler up from
 * PostingHandlerRegistryService and calls through this interface, so adding
 * a new document type never means editing the posting engine itself.
 */
export interface DocumentPostingHandler<TDocument extends BaseDocumentFields = BaseDocumentFields> {
  readonly documentType: string;

  /** Business + posting validation (section 38) run inside the posting
   * transaction, before any movement is generated. Throw AppError to abort. */
  validateForPosting(tenantId: string, document: TDocument, tx: PrismaTransactionClient): Promise<void>;

  /** Pure computation of the movements this document should generate.
   * Must not perform side effects — DocumentPostingService persists them. */
  buildMovements(
    tenantId: string,
    document: TDocument,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]>;
}
