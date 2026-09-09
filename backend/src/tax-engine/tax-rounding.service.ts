import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

/**
 * Centralized tax rounding (spec sections 78-79). ROUND_HALF_UP to the
 * given currency precision (2dp default) — the single place every tax
 * amount gets rounded, so line-level and document-level math never drift
 * apart from using different rounding somewhere else in the codebase.
 */
@Injectable()
export class TaxRoundingService {
  round(value: Decimal.Value, decimalPlaces = 2): Decimal {
    return new Decimal(value).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  }

  /**
   * Reconciles a document-level tax total against the sum of its
   * (independently rounded) line taxes. Returns the sum-of-lines total
   * plus the explicit adjustment needed to match a separately-computed
   * document-level figure, rather than silently discarding the
   * difference (spec section 79).
   */
  reconcile(lineTaxSum: Decimal.Value, documentLevelTax: Decimal.Value, decimalPlaces = 2): { total: Decimal; roundingAdjustment: Decimal } {
    const lines = this.round(lineTaxSum, decimalPlaces);
    const doc = this.round(documentLevelTax, decimalPlaces);
    return { total: doc, roundingAdjustment: doc.minus(lines) };
  }
}
