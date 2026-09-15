/**
 * Document Close Relevance config (docx spec Phase 22, sections 21-22).
 * Maps a document type to how an unposted document of that type should
 * affect close readiness. Only a representative subset of document types
 * (the highest-value GL-impacting ones) is wired up in this build — the
 * full document catalog (~30+ types across every phase) is not
 * exhaustively covered; see docs/MONTH_CLOSE.md section E. Extending this
 * map to another document type requires no readiness-engine code change.
 */
export type DocumentCloseRelevance = 'IGNORE' | 'WARNING' | 'BLOCK_IF_APPROVED' | 'ALWAYS_BLOCK';

export const DOCUMENT_CLOSE_RELEVANCE: Record<string, DocumentCloseRelevance> = {
  PURCHASE_INVOICE: 'BLOCK_IF_APPROVED',
  SALES_INVOICE: 'BLOCK_IF_APPROVED',
  SALES_QUOTE: 'IGNORE',
  PURCHASE_REQUIREMENT: 'IGNORE',
  GOODS_RECEIPT: 'WARNING',
  SHIPMENT: 'WARNING',
};
