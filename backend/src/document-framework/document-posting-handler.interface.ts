import { PrismaTransactionClient } from '../prisma/prisma.service';
import { BaseDocumentFields } from './base-document';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';

export interface RegisterMovementInput {
  registerCode: string;
  recorderLineId?: string;
  businessDate: Date;
  movementType?: string;
  dimensions?: Record<string, unknown>;
  resources?: Record<string, unknown>;
}

/** Optional accounting consequence of posting a document (Accounting Core
 * spec sections 37-38, 44) — `organizationId`/`businessDate`/
 * `sourceDocumentType`/`sourceDocumentId` are filled in generically by
 * DocumentPostingService from the document itself; the handler only
 * supplies the semantic lines (and, via TaxRegisterService, is free to
 * have already written Tax Register rows and folded their resulting VAT
 * lines in here — see sales-documents' handlers for the reference
 * implementation). Returning `null`/omitting the method means "this
 * document type has no accounting consequence yet". */
export interface AccountingBatchResult {
  description?: string;
  operationType?: string;
  lines: AccountingPostingLineInput[];
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

  /** Optional: the Accounting Core (+ Tax Engine, if applicable) posting
   * consequence of this document, computed/registered inside the SAME
   * transaction DocumentPostingService is already running (spec section
   * 44: "Accounting posting must happen inside the parent document
   * transaction"). Unlike `buildMovements`, this method MAY have side
   * effects (writing TaxMovement rows) — it must not, however, write
   * AccountingMovement rows itself; DocumentPostingService does that by
   * handing the returned lines to AccountingPostingEngine.postBatch. */
  buildAccountingBatch?(
    tenantId: string,
    document: TDocument,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null>;

  /** Optional: undoes whatever side effects `buildAccountingBatch` (or any
   * other posting step beyond the generic RegisterMovement rows
   * DocumentPostingService already cleans up itself) performed — called
   * by `unpost`, inside the same transaction, symmetrically to how `post`
   * calls `buildAccountingBatch` (Sales Execution spec section 17: "Never
   * simply set posted=false"). A handler with no such side effects (the
   * common case) simply omits this method. */
  undoSideEffects?(tenantId: string, document: TDocument, tx: PrismaTransactionClient): Promise<void>;
}
