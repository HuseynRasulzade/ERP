/**
 * BaseDocument contract (section 8). Every operational document introduced
 * in a later phase implements this same field shape in its OWN concrete
 * table (section 71/72 explicitly rules out one giant generic `documents`
 * table) — this interface is the reusable contract, not a Prisma model.
 *
 * `documentDate` (business date) vs `createdAt` (technical timestamp) are
 * always distinct: an invoice entered on March 10 may be legally dated
 * March 5. Never overwrite the former with "now".
 */
export interface BaseDocumentFields {
  id: string;
  tenantId: string;
  organizationId?: string | null;
  documentType: string;
  number: string | null;
  documentDate: Date;
  postingDate: Date | null;
  status: DocumentStatus;
  postingStatus: PostingStatus;
  currencyId?: string | null;
  exchangeRate?: unknown;
  description?: string | null;

  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  postedAt: Date | null;
  postedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  deletionMark: boolean;
  version: number;
}

export type DocumentStatus = 'DRAFT' | 'ACTIVE' | 'CANCELLED' | 'DELETION_MARKED';
export type PostingStatus = 'NOT_POSTED' | 'POSTED' | 'POSTING_FAILED';

/**
 * Approval status is intentionally NOT part of BaseDocumentFields yet
 * (section 9) — Phase 26 will add it as an independent axis alongside
 * document/posting status without requiring a redesign here. Reserved
 * codes: NOT_REQUIRED | PENDING | APPROVED | REJECTED (seeded in the
 * enumeration foundation already, see prisma/seed.ts APPROVAL_STATUS).
 */
