import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';

export interface TranslationResult {
  originalAmount: Decimal;
  translatedAmount: Decimal;
  rate: Decimal;
  method: string;
}

/**
 * FinancialTranslationService (docx spec Phase 23, sections 75-84).
 * Translates an already-computed base-currency row amount into a
 * different reporting/presentation currency — never re-derives the
 * amount itself. `NO_TRANSLATION` (the default when no rule matches) is
 * itself a valid, explicit method — single-currency reporting stays the
 * default (spec section 76). Never applies one blanket closing rate to
 * every row (spec section 80, 193's own critical rule) — resolves a
 * row-specific (or account-category-specific) rule first.
 */
@Injectable()
export class FinancialTranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async resolveRule(tenantId: string, rowCode: string | null, accountCategory: string | null, asOfDate: Date) {
    return this.prisma.financialTranslationRule.findFirst({
      where: {
        tenantId,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
        AND: [{ OR: [{ reportRowCode: rowCode }, { reportRowCode: null }] }, { OR: [{ accountCategory }, { accountCategory: null }] }],
      },
      orderBy: [{ reportRowCode: 'desc' }], // row-specific overrides category-level (nulls sort last)
    });
  }

  async translate(
    tenantId: string,
    amount: Decimal,
    params: { fromCurrencyCode: string; toCurrencyCode: string; rowCode?: string; accountCategory?: string; closingRateDate: Date; periodStart?: Date; periodEnd?: Date; historicalRateDate?: Date },
  ): Promise<TranslationResult> {
    if (params.fromCurrencyCode === params.toCurrencyCode) return { originalAmount: amount, translatedAmount: amount, rate: new Decimal(1), method: 'NO_TRANSLATION' };

    const rule = await this.resolveRule(tenantId, params.rowCode ?? null, params.accountCategory ?? null, params.closingRateDate);
    const method = rule?.translationMethod ?? 'NO_TRANSLATION';
    if (method === 'NO_TRANSLATION') return { originalAmount: amount, translatedAmount: amount, rate: new Decimal(1), method };

    let rateDate = params.closingRateDate;
    if (method === 'HISTORICAL_RATE' && params.historicalRateDate) rateDate = params.historicalRateDate;
    if (method === 'PERIOD_AVERAGE_RATE' && params.periodStart && params.periodEnd) {
      // Average of the closing rate at period start and period end — a
      // documented simplification of a true daily-weighted average
      // (disclosed in docs/FINANCIAL_REPORTING.md section C).
      const startRate = await this.rateAt(tenantId, params.fromCurrencyCode, params.toCurrencyCode, params.periodStart, rule?.rateType);
      const endRate = await this.rateAt(tenantId, params.fromCurrencyCode, params.toCurrencyCode, params.periodEnd, rule?.rateType);
      const avg = startRate.plus(endRate).div(2);
      return { originalAmount: amount, translatedAmount: amount.mul(avg), rate: avg, method };
    }

    const rate = await this.rateAt(tenantId, params.fromCurrencyCode, params.toCurrencyCode, rateDate, rule?.rateType);
    return { originalAmount: amount, translatedAmount: amount.mul(rate), rate, method };
  }

  private async rateAt(tenantId: string, fromCode: string, toCode: string, date: Date, rateType?: string): Promise<Decimal> {
    const rate = await this.currency.resolveRate({ tenantId, currencyCode: fromCode, baseCurrencyCode: toCode, businessDate: date, rateType });
    return new Decimal(rate.rate.toString());
  }
}
