import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';

const CASH_CATEGORIES = ['CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE'] as const;

/**
 * Pul vəsaitlərinin hərəkəti (Cash Flow Statement) — a simple direct-method
 * report built from ACTUAL cash movements, not GL postings: every
 * BankStatementLine (the real bank ledger, signed — positive is an
 * inflow) plus every posted CashTransaction (cashbox receipts/payments).
 * Deliberately not derived from the chart of accounts like the other
 * reports in AccountingQueryService — a bank statement line can exist
 * (imported, matched or not) without ever touching a GL account, and
 * this report's whole point is "what actually moved through the bank/
 * cashbox", which the GL's accrual-based view doesn't directly answer.
 */
@Injectable()
export class CashFlowReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async get(tenantId: string, membershipId: string, organizationId: string, params: { fromDate: Date; toDate: Date }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (params.fromDate > params.toDate) throw new ValidationAppError('fromDate must not be after toDate');

    const [bankLines, cashTransactions] = await Promise.all([
      this.prisma.bankStatementLine.findMany({
        where: { organizationId, statementDate: { gte: params.fromDate, lte: params.toDate } },
      }),
      this.prisma.cashTransaction.findMany({
        where: { organizationId, postingStatus: 'POSTED', documentDate: { gte: params.fromDate, lte: params.toDate } },
      }),
    ]);

    let bankInflow = new Decimal(0);
    let bankOutflow = new Decimal(0);
    for (const line of bankLines) {
      const amount = new Decimal(line.amount.toString());
      if (amount.gte(0)) bankInflow = bankInflow.plus(amount);
      else bankOutflow = bankOutflow.plus(amount.abs());
    }

    const cashByCategory = CASH_CATEGORIES.map((category) => {
      const inflow = cashTransactions
        .filter((t) => t.category === category && t.direction === 'RECEIPT')
        .reduce((sum, t) => sum.plus(t.amount.toString()), new Decimal(0));
      const outflow = cashTransactions
        .filter((t) => t.category === category && t.direction === 'PAYMENT')
        .reduce((sum, t) => sum.plus(t.amount.toString()), new Decimal(0));
      return { category, inflow: inflow.toFixed(2), outflow: outflow.toFixed(2) };
    });
    const cashInflow = cashByCategory.reduce((sum, c) => sum.plus(c.inflow), new Decimal(0));
    const cashOutflow = cashByCategory.reduce((sum, c) => sum.plus(c.outflow), new Decimal(0));

    const totalInflow = bankInflow.plus(cashInflow);
    const totalOutflow = bankOutflow.plus(cashOutflow);

    return {
      fromDate: params.fromDate.toISOString().slice(0, 10),
      toDate: params.toDate.toISOString().slice(0, 10),
      bank: { inflow: bankInflow.toFixed(2), outflow: bankOutflow.toFixed(2), net: bankInflow.minus(bankOutflow).toFixed(2), lineCount: bankLines.length },
      cash: { byCategory: cashByCategory, inflow: cashInflow.toFixed(2), outflow: cashOutflow.toFixed(2), net: cashInflow.minus(cashOutflow).toFixed(2) },
      totalInflow: totalInflow.toFixed(2),
      totalOutflow: totalOutflow.toFixed(2),
      netCashFlow: totalInflow.minus(totalOutflow).toFixed(2),
    };
  }
}
