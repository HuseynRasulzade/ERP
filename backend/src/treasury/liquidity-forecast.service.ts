import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { BankCashMovementService } from './bank-cash-movement.service';

/**
 * TreasuryLiquidityService (spec sections 19-22, 76-78). Current bank
 * balance and projected balance are ALWAYS shown separately (spec section
 * 22) — planned calendar items never touch `BankCashMovementService`'s
 * own book balance.
 */
@Injectable()
export class LiquidityForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async position(tenantId: string, organizationId: string, bankAccountId: string, asOfDate: Date = new Date()) {
    const account = await this.prisma.bankAccount.findFirstOrThrow({ where: { id: bankAccountId, tenantId } });
    const openingBalance = await this.bankCash.getBookBalance(tenantId, bankAccountId, undefined, asOfDate);

    const items = await this.prisma.paymentCalendarItem.findMany({ where: { tenantId, organizationId, bankAccountId, itemDate: { gt: asOfDate } } });
    const plannedInflows = items.filter((i) => i.cashFlowDirection === 'INFLOW').reduce((s, i) => s.plus(i.remainingAmount.toString()), new Decimal(0));
    const plannedOutflows = items.filter((i) => i.cashFlowDirection === 'OUTFLOW').reduce((s, i) => s.plus(i.remainingAmount.toString()), new Decimal(0));
    const projectedClosingBalance = openingBalance.plus(plannedInflows).minus(plannedOutflows);

    const availableOverdraft = account.overdraftAllowed && account.overdraftLimit ? new Decimal(account.overdraftLimit.toString()) : new Decimal(0);
    const minimumBuffer = account.minimumBalance ? new Decimal(account.minimumBalance.toString()) : new Decimal(0);
    const cashGap = projectedClosingBalance.lt(minimumBuffer) ? minimumBuffer.minus(projectedClosingBalance) : new Decimal(0);

    return {
      bankAccountId,
      currentBalance: openingBalance.toString(),
      plannedInflows: plannedInflows.toString(),
      plannedOutflows: plannedOutflows.toString(),
      projectedClosingBalance: projectedClosingBalance.toString(),
      availableOverdraft: availableOverdraft.toString(),
      availableLiquidity: projectedClosingBalance.plus(availableOverdraft).toString(),
      minimumBuffer: minimumBuffer.toString(),
      cashGap: cashGap.gt(0) ? cashGap.toString() : null,
    };
  }

  /** Currency- and bank-account-separated forecast (spec sections 76-77)
   * — never a single blended number across currencies. */
  async forecastByAccount(tenantId: string, organizationId: string, asOfDate: Date = new Date()) {
    const accounts = await this.prisma.bankAccount.findMany({ where: { organizationId, active: true } });
    const positions = [];
    for (const a of accounts) positions.push(await this.position(tenantId, organizationId, a.id, asOfDate));
    return positions;
  }

  async cashGapAlerts(tenantId: string, organizationId: string, asOfDate: Date = new Date()) {
    const positions = await this.forecastByAccount(tenantId, organizationId, asOfDate);
    return positions.filter((p) => p.cashGap != null).map((p) => ({ bankAccountId: p.bankAccountId, cashGap: p.cashGap, message: `Projected cash deficit of ${p.cashGap} on account ${p.bankAccountId}.` }));
  }

  /** Funding transfer suggestion (spec section 78) — a recommendation
   * only, never auto-executed. */
  async fundingSuggestions(tenantId: string, organizationId: string, asOfDate: Date = new Date()) {
    const positions = await this.forecastByAccount(tenantId, organizationId, asOfDate);
    const deficits = positions.filter((p) => new Decimal(p.projectedClosingBalance).lt(0));
    const surpluses = positions.filter((p) => new Decimal(p.projectedClosingBalance).gt(new Decimal(p.minimumBuffer)));
    const suggestions: { fromBankAccountId: string; toBankAccountId: string; amount: string }[] = [];
    for (const d of deficits) {
      const need = new Decimal(d.projectedClosingBalance).abs();
      const source = surpluses.find((s) => new Decimal(s.projectedClosingBalance).minus(s.minimumBuffer).gte(need));
      if (source) suggestions.push({ fromBankAccountId: source.bankAccountId, toBankAccountId: d.bankAccountId, amount: need.toString() });
    }
    return suggestions;
  }
}
