import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { TaxRuleResolverService } from './tax-rule-resolver.service';
import { TaxRoundingService } from './tax-rounding.service';
import { TaxContext } from './tax-context';
import { TaxLineResult, DocumentTaxSummaryRow } from './tax-calculation-result';

export interface CalculateLineParams {
  sourceLineId?: string;
  amount: Decimal.Value;
  priceIncludesTax: boolean;
  currency?: string;
  taxTypeCode?: string;
  /** Recoverability for INPUT (purchase) tax — defaults to fully
   * recoverable. A configured percentage lets a caller model partial
   * recoverability (spec section 56) without the resolver needing a
   * dedicated TaxRecoverabilityRule table in this build — see
   * docs/TAX_ENGINE.md Technical Debt for why that's deferred. */
  recoverablePercent?: Decimal.Value;
}

/**
 * TaxCalculationService (spec sections 24-29, 34-35). Separated from
 * posting (spec section 5) — this never writes anything; it only computes.
 * The SAME method backs both a `/tax/calculate` preview and whatever a
 * real posting flow calls before registering the result.
 */
@Injectable()
export class TaxCalculationService {
  constructor(
    private readonly resolver: TaxRuleResolverService,
    private readonly rounding: TaxRoundingService,
  ) {}

  async calculateLine(context: TaxContext, params: CalculateLineParams, tx?: PrismaTransactionClient): Promise<TaxLineResult> {
    const taxTypeCode = params.taxTypeCode ?? 'VAT';
    const rule = await this.resolver.resolve(context, taxTypeCode, tx);
    const rate = rule.rate ? new Decimal(rule.rate.rate) : new Decimal(0);

    let net: Decimal;
    let tax: Decimal;
    let gross: Decimal;
    if (params.priceIncludesTax) {
      gross = this.rounding.round(params.amount);
      const divisor = new Decimal(1).add(rate.div(100));
      net = this.rounding.round(gross.div(divisor));
      tax = this.rounding.round(gross.minus(net));
    } else {
      net = this.rounding.round(params.amount);
      tax = this.rounding.round(net.mul(rate).div(100));
      gross = this.rounding.round(net.plus(tax));
    }

    const recoverablePercent =
      params.recoverablePercent !== undefined ? new Decimal(params.recoverablePercent) : new Decimal(100);
    const recoverableAmount = this.rounding.round(tax.mul(recoverablePercent).div(100));
    const nonrecoverableAmount = this.rounding.round(tax.minus(recoverableAmount));

    const explanation =
      `Treatment: ${rule.treatment}. Rate: ${rate.toFixed(2)}%. ` +
      `Taxable base: ${net.toFixed(2)}${params.currency ? ' ' + params.currency : ''}. ` +
      `${taxTypeCode}: ${tax.toFixed(2)}. Legal rule: ${rule.code}` +
      (rule.legalArticleReference ? ` (${rule.legalArticleReference})` : '') +
      `. Effective version resolved for tax point date ${context.taxPointDate.toISOString().slice(0, 10)}.`;

    return {
      sourceLineId: params.sourceLineId,
      taxType: taxTypeCode,
      taxCode: rule.exemptionCode ?? undefined,
      treatment: rule.treatment,
      rate,
      taxableBase: net,
      taxAmount: tax,
      recoverableAmount,
      nonrecoverableAmount,
      grossAmount: gross,
      currency: params.currency,
      ruleId: rule.id,
      rateId: rule.rateId ?? undefined,
      legalArticleReference: rule.legalArticleReference,
      taxPointDate: context.taxPointDate,
      roundingAdjustment: new Decimal(0),
      explanation,
    };
  }

  summarizeDocument(lines: TaxLineResult[]): DocumentTaxSummaryRow[] {
    const groups = new Map<string, DocumentTaxSummaryRow>();
    for (const line of lines) {
      const key = `${line.taxType}|${line.treatment}|${line.rate.toFixed(4)}`;
      const existing = groups.get(key);
      if (existing) {
        existing.taxableBase = existing.taxableBase.plus(line.taxableBase);
        existing.taxAmount = existing.taxAmount.plus(line.taxAmount);
      } else {
        groups.set(key, {
          taxType: line.taxType,
          treatment: line.treatment,
          rate: line.rate,
          taxableBase: line.taxableBase,
          taxAmount: line.taxAmount,
        });
      }
    }
    return [...groups.values()];
  }
}
