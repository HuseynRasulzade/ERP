import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';

/**
 * Phase 27 (docs/DOCUMENT_CHAIN.md section C) — the stable extension point
 * a source module implements so the governed Create Based On engine
 * (`RemainingToCreateService`) can ask "how much of this source line is
 * still eligible" WITHOUT the engine ever reading a mutable "current
 * field" on the source document as authoritative (spec's own remaining-
 * quantity principle — remaining is always derived, never stored).
 *
 * `getEligibleCapacity` returns the source line's TOTAL capacity for the
 * given metric (e.g. ordered quantity) — `RemainingToCreateService` itself
 * subtracts already-committed consumption (read from `DocumentLineLink`)
 * and any active `SourceCreationClaim`s to arrive at "remaining".
 */
export interface SourceEligibilityAdapter {
  readonly sourceDocumentType: string;

  getEligibleCapacity(
    tenantId: string,
    sourceLineId: string,
    metric: string,
    tx?: PrismaTransactionClient,
  ): Promise<Decimal>;

  /** Optional: business-rule eligibility beyond raw capacity (e.g. the
   * source document must be POSTED, not on credit hold, etc). Returns a
   * list of human-readable blocking reasons; empty = eligible. */
  getEligibilityBlockers?(tenantId: string, sourceDocumentId: string, tx?: PrismaTransactionClient): Promise<string[]>;
}
