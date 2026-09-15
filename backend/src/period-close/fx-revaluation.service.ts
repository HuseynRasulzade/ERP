import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { PostingDuplicateError } from '../common/errors/app-error';

/**
 * FXRevaluationService (docx spec Phase 22, sections 46-54). Open
 * AR/AP items only in this build — foreign-currency bank/cash balance
 * revaluation is not implemented (spec section 47's own "where policy
 * requires"; disclosed in docs/MONTH_CLOSE.md section G). Non-monetary
 * items (inventory, fixed assets) are never touched (spec section 48) —
 * this service never reads those tables at all.
 *
 * The "historical carrying amount" for an open item that has been
 * PARTIALLY settled is approximated as `remainingAmount *
 * (baseCurrencyAmount / amountDue)` — i.e. the original booking rate
 * applied proportionally to what is still open, since the settlement
 * subledger does not keep a separately-tracked running base-currency
 * carrying value (disclosed simplification, docs/MONTH_CLOSE.md section G).
 */
@Injectable()
export class FXRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly currency: CurrencyService,
    private readonly posting: AccountingPostingEngine,
    private readonly mapping: AccountingMappingService,
  ) {}

  async run(tenantId: string, organizationId: string, userId: string, period: string, closeRunId: string | undefined, closingRateDate: Date) {
    const existing = await this.prisma.fXRevaluationRun.findFirst({ where: { tenantId, organizationId, period } });
    if (existing && existing.status === 'POSTED') return existing; // idempotent retry (spec section 28)

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const baseCurrency = await this.prisma.currency.findUniqueOrThrow({ where: { id: tenant.baseCurrencyId! } });

    const receivables = await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, status: 'OPEN', currencyId: { not: baseCurrency.id } } });
    const payables = await this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, status: 'OPEN', currencyId: { not: baseCurrency.id } } });

    if (receivables.length === 0 && payables.length === 0) {
      return this.prisma.fXRevaluationRun.upsert({
        where: { tenantId_organizationId_period: { tenantId, organizationId, period } },
        create: { tenantId, organizationId, period, closingRateDate, status: 'POSTED', createdBy: userId, closeRunId },
        update: { status: 'POSTED', closeRunId },
      });
    }

    const run = existing ?? (await this.prisma.fXRevaluationRun.create({ data: { tenantId, organizationId, period, closingRateDate, status: 'DRAFT', createdBy: userId, closeRunId } }));

    const items: { sourceType: 'AR' | 'AP'; sourceId: string; currencyId: string; foreignAmount: Decimal; historicalCarryingAmount: Decimal; closingRate: Decimal; revaluedBaseAmount: Decimal; unrealizedGainLoss: Decimal }[] = [];

    for (const ar of receivables) {
      if (!ar.currencyId || !ar.remainingAmount || !ar.baseCurrencyAmount) continue; // no FX-relevant data captured — nothing to revalue
      const rate = await this.resolveClosingRate(tenantId, ar.currencyId, baseCurrency.id, closingRateDate);
      const foreignAmount = new Decimal(ar.remainingAmount.toString());
      const historicalCarrying = foreignAmount.mul(new Decimal(ar.baseCurrencyAmount.toString())).div(new Decimal(ar.amountDue.toString()));
      const revalued = foreignAmount.mul(rate);
      // AR: value increasing (rate up) is a GAIN.
      items.push({ sourceType: 'AR', sourceId: ar.id, currencyId: ar.currencyId, foreignAmount, historicalCarryingAmount: historicalCarrying, closingRate: rate, revaluedBaseAmount: revalued, unrealizedGainLoss: revalued.minus(historicalCarrying) });
    }
    for (const ap of payables) {
      if (!ap.currencyId || !ap.remainingAmount || !ap.baseCurrencyAmount) continue;
      const rate = await this.resolveClosingRate(tenantId, ap.currencyId, baseCurrency.id, closingRateDate);
      const foreignAmount = new Decimal(ap.remainingAmount.toString());
      const historicalCarrying = foreignAmount.mul(new Decimal(ap.baseCurrencyAmount.toString())).div(new Decimal(ap.invoiceAmount.toString()));
      const revalued = foreignAmount.mul(rate);
      // AP: value increasing (rate up) is a LOSS (we owe more base currency).
      items.push({ sourceType: 'AP', sourceId: ap.id, currencyId: ap.currencyId, foreignAmount, historicalCarryingAmount: historicalCarrying, closingRate: rate, revaluedBaseAmount: revalued, unrealizedGainLoss: historicalCarrying.minus(revalued) });
    }

    await this.prisma.fXRevaluationItem.deleteMany({ where: { tenantId, runId: run.id } });
    for (const item of items) {
      await this.prisma.fXRevaluationItem.create({ data: { tenantId, runId: run.id, ...item, foreignAmount: item.foreignAmount.toString(), historicalCarryingAmount: item.historicalCarryingAmount.toString(), closingRate: item.closingRate.toString(), revaluedBaseAmount: item.revaluedBaseAmount.toString(), unrealizedGainLoss: item.unrealizedGainLoss.toString() } });
    }

    const netGainLoss = items.reduce((s, i) => s.plus(i.unrealizedGainLoss), new Decimal(0));
    if (netGainLoss.eq(0)) {
      return this.prisma.fXRevaluationRun.update({ where: { id: run.id }, data: { status: 'POSTED' } });
    }

    const arMonetaryAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, closingRateDate);
    const apMonetaryAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, closingRateDate);
    const gainAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.FX_UNREALIZED_GAIN, closingRateDate);
    const lossAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.FX_UNREALIZED_LOSS, closingRateDate);

    const lines = items
      .filter((i) => !i.unrealizedGainLoss.eq(0))
      .map((i) => {
        const monetaryAccountId = i.sourceType === 'AR' ? arMonetaryAccount.id : apMonetaryAccount.id;
        const isGain = i.unrealizedGainLoss.gt(0);
        // AR gain: Dr Receivable / Cr FX Gain. AR loss: Dr FX Loss / Cr Receivable.
        // AP loss (we owe more): Dr FX Loss / Cr Payable. AP gain: Dr Payable / Cr FX Gain.
        const monetarySide: 'DEBIT' | 'CREDIT' = i.sourceType === 'AR' ? (isGain ? 'DEBIT' : 'CREDIT') : (isGain ? 'DEBIT' : 'CREDIT');
        const counterAccountId = isGain ? gainAccount.id : lossAccount.id;
        const counterSide: 'DEBIT' | 'CREDIT' = monetarySide === 'DEBIT' ? 'CREDIT' : 'DEBIT';
        const amount = i.unrealizedGainLoss.abs();
        return [
          { accountId: monetaryAccountId, side: monetarySide, amountBase: amount.toString(), description: `FX revaluation ${i.sourceType} ${i.sourceId}` },
          { accountId: counterAccountId, side: counterSide, amountBase: amount.toString(), description: `FX revaluation ${i.sourceType} ${i.sourceId}` },
        ];
      })
      .flat();

    let journalEntryId: string | undefined;
    try {
      const batch = await this.posting.postBatch(tenantId, userId, {
        organizationId,
        businessDate: closingRateDate,
        description: `FX revaluation ${period}`,
        operationType: 'FX_REVALUATION',
        sourceDocumentType: 'FX_REVALUATION_RUN',
        sourceDocumentId: run.id,
        lines,
      });
      journalEntryId = batch.id;
    } catch (err) {
      if (!(err instanceof PostingDuplicateError)) throw err; // idempotent retry — already posted
    }

    await this.audit.record({ tenantId, eventType: 'FX_REVALUATION_COMPLETED', entityType: 'FXRevaluationRun', entityId: run.id, action: 'UPDATE', userId, newValues: { netGainLoss: netGainLoss.toString() } });
    return this.prisma.fXRevaluationRun.update({ where: { id: run.id }, data: { status: 'POSTED', journalEntryId } });
  }

  private async resolveClosingRate(tenantId: string, currencyId: string, baseCurrencyId: string, asOf: Date): Promise<Decimal> {
    const currency = await this.prisma.currency.findUniqueOrThrow({ where: { id: currencyId } });
    const baseCurrency = await this.prisma.currency.findUniqueOrThrow({ where: { id: baseCurrencyId } });
    const rate = await this.currency.resolveRate({ tenantId, currencyCode: currency.code, baseCurrencyCode: baseCurrency.code, businessDate: asOf });
    return new Decimal(rate.rate.toString());
  }

  async hasMultiCurrencyExposure(tenantId: string, organizationId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const [ar, ap] = await Promise.all([
      this.prisma.settlementObligation.count({ where: { tenantId, organizationId, status: 'OPEN', currencyId: { not: tenant.baseCurrencyId! } } }),
      this.prisma.supplierPayable.count({ where: { tenantId, organizationId, status: 'OPEN', currencyId: { not: tenant.baseCurrencyId! } } }),
    ]);
    return ar + ap > 0;
  }
}
