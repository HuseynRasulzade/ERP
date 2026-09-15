import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface FinancialResult {
  totalRevenue: string;
  totalExpense: string;
  netResult: string;
}

/**
 * FinancialResultService (docx spec Phase 22, sections 100-101). Never
 * stores period profit/loss as an arbitrary field — always DERIVES it
 * from REVENUE/CONTRA_REVENUE/EXPENSE account movements for the period,
 * read straight off the immutable AccountingMovement register (spec
 * section 101, 197's own "financial result-u manual master field kimi
 * saxlama"). This chart-of-accounts model has no CONTRA_EXPENSE class
 * (only CONTRA_REVENUE) — disclosed in docs/MONTH_CLOSE.md section O.
 */
@Injectable()
export class FinancialResultService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date): Promise<FinancialResult> {
    const accounts = await this.prisma.account.findMany({
      where: { tenantId, accountClass: { in: ['REVENUE', 'CONTRA_REVENUE', 'EXPENSE'] } },
      select: { id: true, accountClass: true, normalBalance: true },
    });
    const accountIds = accounts.map((a) => a.id);
    if (accountIds.length === 0) return { totalRevenue: '0', totalExpense: '0', netResult: '0' };

    const movements = await this.prisma.accountingMovement.groupBy({
      by: ['accountId', 'side'],
      where: { tenantId, organizationId, accountId: { in: accountIds }, businessDate: { gte: periodStart, lte: periodEnd } },
      _sum: { amountBase: true },
    });

    let totalRevenue = new Decimal(0);
    let totalExpense = new Decimal(0);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const byAccount = new Map<string, { DEBIT: Decimal; CREDIT: Decimal }>();
    for (const m of movements) {
      const entry = byAccount.get(m.accountId) ?? { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
      entry[m.side as 'DEBIT' | 'CREDIT'] = new Decimal((m._sum.amountBase ?? 0).toString());
      byAccount.set(m.accountId, entry);
    }
    for (const [accountId, sums] of byAccount) {
      const account = accountMap.get(accountId)!;
      // Revenue/contra-revenue accounts normally carry a CREDIT balance;
      // expense/contra-expense normally carry DEBIT — net using each
      // account's own `normalBalance` so a contra account's sign is
      // handled automatically.
      const net = account.normalBalance === 'CREDIT' ? sums.CREDIT.minus(sums.DEBIT) : sums.DEBIT.minus(sums.CREDIT);
      // A contra account's normal-balance activity REDUCES its parent
      // class total rather than adding to it.
      const isContra = account.accountClass === 'CONTRA_REVENUE';
      const signedNet = isContra ? net.neg() : net;
      if (account.accountClass === 'REVENUE' || account.accountClass === 'CONTRA_REVENUE') totalRevenue = totalRevenue.plus(signedNet);
      else totalExpense = totalExpense.plus(signedNet);
    }

    return { totalRevenue: totalRevenue.toString(), totalExpense: totalExpense.toString(), netResult: totalRevenue.minus(totalExpense).toString() };
  }
}
