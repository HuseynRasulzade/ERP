import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * Currency + exchange rate foundation (section 17/18). Detailed FX
 * accounting is a later phase — this only stores rates and resolves the
 * rate that was/should be in effect for a given business date so historical
 * documents remain reproducible (section 66).
 */
@Injectable()
export class CurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  listCurrencies(activeOnly = true) {
    return this.prisma.currency.findMany({ where: activeOnly ? { active: true } : undefined });
  }

  async getByCode(code: string) {
    const currency = await this.prisma.currency.findUnique({ where: { code } });
    if (!currency) throw new NotFoundAppError('Currency', code);
    return currency;
  }

  async recordExchangeRate(params: {
    tenantId: string | null;
    currencyCode: string;
    baseCurrencyCode: string;
    effectiveDate: Date;
    rate: Decimal.Value;
    rateType?: string;
    source?: string;
  }) {
    if (params.currencyCode === params.baseCurrencyCode) {
      throw new ValidationAppError('Currency and base currency must differ');
    }
    const [currency, baseCurrency] = await Promise.all([
      this.getByCode(params.currencyCode),
      this.getByCode(params.baseCurrencyCode),
    ]);

    const rateType = params.rateType ?? 'OFFICIAL';

    // findFirst + create/update rather than upsert: Prisma's compound-
    // unique `where` input rejects an explicit null for `tenantId`, which
    // a system-wide rate legitimately has.
    const existing = await this.prisma.exchangeRate.findFirst({
      where: {
        tenantId: params.tenantId,
        currencyId: currency.id,
        baseCurrencyId: baseCurrency.id,
        effectiveDate: params.effectiveDate,
        rateType,
      },
    });

    if (existing) {
      return this.prisma.exchangeRate.update({
        where: { id: existing.id },
        data: { rate: new Decimal(params.rate).toString(), source: params.source },
      });
    }

    return this.prisma.exchangeRate.create({
      data: {
        tenantId: params.tenantId,
        currencyId: currency.id,
        baseCurrencyId: baseCurrency.id,
        effectiveDate: params.effectiveDate,
        rate: new Decimal(params.rate).toString(),
        rateType,
        source: params.source,
      },
    });
  }

  /**
   * Resolve the rate effective on (or most recently before) `businessDate`.
   * Never resolves using "today" for a historical document — always pass
   * the document's actual business/posting date.
   */
  async resolveRate(params: {
    tenantId: string | null;
    currencyCode: string;
    baseCurrencyCode: string;
    businessDate: Date;
    rateType?: string;
  }) {
    const [currency, baseCurrency] = await Promise.all([
      this.getByCode(params.currencyCode),
      this.getByCode(params.baseCurrencyCode),
    ]);

    const rate = await this.prisma.exchangeRate.findFirst({
      where: {
        currencyId: currency.id,
        baseCurrencyId: baseCurrency.id,
        rateType: params.rateType ?? 'OFFICIAL',
        effectiveDate: { lte: params.businessDate },
        OR: [{ tenantId: params.tenantId }, { tenantId: null }],
      },
      orderBy: [{ effectiveDate: 'desc' }, { tenantId: 'desc' }], // tenant-specific overrides system-wide on tie
    });

    if (!rate) {
      throw new NotFoundAppError(
        'ExchangeRate',
        `${params.currencyCode}->${params.baseCurrencyCode} as of ${params.businessDate.toISOString().slice(0, 10)}`,
      );
    }

    return rate;
  }
}
