import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { BankCashMovementService } from './bank-cash-movement.service';

/**
 * TreasuryReportingService (spec sections 84, 132-140). Plan vs Actual
 * (spec sections 84, 175) compares `PaymentCalendarItem.amount` (never
 * mutated) against its own `executedAmount` — timing differences are
 * visible without losing the original plan.
 */
@Injectable()
export class TreasuryReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async planVsActual(tenantId: string, organizationId: string, fromDate: Date, toDate: Date) {
    const items = await this.prisma.paymentCalendarItem.findMany({ where: { tenantId, organizationId, itemDate: { gte: fromDate, lte: toDate } } });
    const byCategory = new Map<string, { planned: Decimal; actual: Decimal }>();
    for (const i of items) {
      const entry = byCategory.get(i.category) ?? { planned: new Decimal(0), actual: new Decimal(0) };
      entry.planned = entry.planned.plus(i.amount.toString());
      entry.actual = entry.actual.plus(i.executedAmount.toString());
      byCategory.set(i.category, entry);
    }
    return Array.from(byCategory.entries()).map(([category, v]) => ({ category, planned: v.planned.toString(), actual: v.actual.toString(), variance: v.actual.minus(v.planned).toString(), variancePercent: v.planned.gt(0) ? v.actual.minus(v.planned).div(v.planned).mul(100).toDecimalPlaces(2).toString() : null }));
  }

  async bankBalances(tenantId: string, organizationId: string) {
    const accounts = await this.prisma.bankAccount.findMany({ where: { organizationId, active: true } });
    const rows = [];
    for (const a of accounts) {
      const bookBalance = await this.bankCash.getBookBalance(tenantId, a.id);
      const lastStatement = await this.prisma.bankStatement.findFirst({ where: { tenantId, bankAccountId: a.id }, orderBy: { periodEnd: 'desc' } });
      const lastStatementBalance = lastStatement ? new Decimal(lastStatement.closingBalance.toString()) : null;
      rows.push({
        bankAccountId: a.id,
        accountName: a.accountName,
        currencyId: a.currencyId,
        bookBalance: bookBalance.toString(),
        lastStatementBalance: lastStatementBalance?.toString() ?? null,
        unreconciledDifference: lastStatementBalance ? bookBalance.minus(lastStatementBalance).toString() : null,
        availableOverdraft: a.overdraftAllowed && a.overdraftLimit ? a.overdraftLimit.toString() : '0',
        availableLiquidity: bookBalance.plus(a.overdraftAllowed && a.overdraftLimit ? new Decimal(a.overdraftLimit.toString()) : 0).toString(),
      });
    }
    return rows;
  }

  async unmatchedBankTransactions(tenantId: string, bankAccountId: string) {
    const lines = await this.prisma.bankStatementLine.findMany({ where: { tenantId, matchStatus: { in: ['UNMATCHED', 'SUGGESTED', 'EXCEPTION'] }, statement: { bankAccountId } }, orderBy: { transactionDate: 'asc' } });
    return lines.map((l) => ({ statementId: l.statementId, date: l.transactionDate, amount: l.amount.toString(), counterparty: l.counterpartyName, reference: l.bankReference, daysUnmatched: Math.floor((Date.now() - l.transactionDate.getTime()) / 86_400_000), status: l.matchStatus }));
  }

  async outstandingPayments(tenantId: string, organizationId: string, bankAccountId?: string) {
    const payments = await this.prisma.settlementPayment.findMany({ where: { tenantId, organizationId, bankAccountId, postingStatus: 'POSTED', matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] } } });
    return payments.map((p) => ({ paymentId: p.id, number: p.number, date: p.documentDate, amount: p.amount.toString(), bankAccountId: p.bankAccountId, counterpartyId: p.counterpartyId, daysOutstanding: Math.floor((Date.now() - p.documentDate.getTime()) / 86_400_000) }));
  }

  async bankFeesReport(tenantId: string, organizationId: string, fromDate: Date, toDate: Date) {
    const fees = await this.prisma.bankFee.findMany({ where: { tenantId, organizationId, feeDate: { gte: fromDate, lte: toDate }, postingStatus: 'POSTED' } });
    const total = fees.reduce((s, f) => s.plus(f.amount.toString()), new Decimal(0));
    return { fees, totalAmount: total.toString(), averageMonthly: fees.length > 0 ? total.div(Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (30 * 86_400_000)))).toDecimalPlaces(2).toString() : '0' };
  }

  async internalTransfersReport(tenantId: string, organizationId: string) {
    return this.prisma.internalBankTransfer.findMany({ where: { tenantId, organizationId }, orderBy: { documentDate: 'desc' } });
  }

  async fxConversionsReport(tenantId: string, organizationId: string) {
    const conversions = await this.prisma.fXConversion.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED' } });
    return conversions.map((c) => ({
      id: c.id,
      date: c.conversionDate,
      sourceCurrencyId: c.sourceCurrencyId,
      destinationCurrencyId: c.destinationCurrencyId,
      sourceAmount: c.sourceAmount.toString(),
      destinationAmount: c.destinationAmount.toString(),
      tradeRate: c.tradeRate.toString(),
      officialRate: c.officialRate?.toString() ?? null,
      difference: c.officialRate ? new Decimal(c.destinationAmount.toString()).minus(new Decimal(c.sourceAmount.toString()).mul(c.officialRate.toString())).toString() : null,
      fee: c.bankFeeAmount.toString(),
    }));
  }
}
