import Decimal from 'decimal.js';

/** A draft calculation line — the explainable trace (docx spec Phase 19
 * sections 77-79) — before it is persisted as a PayrollResultLine. */
export interface ResultLineDraft {
  calculationCode: string;
  lineType: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
  quantity?: Decimal;
  rate?: Decimal;
  baseAmount?: Decimal;
  multiplier?: Decimal;
  amount: Decimal;
  taxableFlags?: Record<string, boolean>;
  sourceInput?: string;
  sourceRule?: string;
  explanation?: string;
}
