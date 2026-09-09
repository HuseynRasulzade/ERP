import Decimal from 'decimal.js';

/** TaxLineResult (spec section 28). */
export interface TaxLineResult {
  sourceLineId?: string;
  taxType: string;
  taxCode?: string;
  treatment: string;
  rate: Decimal;
  taxableBase: Decimal;
  taxAmount: Decimal;
  recoverableAmount: Decimal;
  nonrecoverableAmount: Decimal;
  grossAmount: Decimal;
  currency?: string;
  ruleId: string;
  rateId?: string;
  legalArticleReference?: string | null;
  taxPointDate: Date;
  roundingAdjustment: Decimal;
  explanation: string;
}

/** DocumentTaxSummary (spec section 29) — grouped by tax type/treatment/rate. */
export interface DocumentTaxSummaryRow {
  taxType: string;
  treatment: string;
  rate: Decimal;
  taxableBase: Decimal;
  taxAmount: Decimal;
}
