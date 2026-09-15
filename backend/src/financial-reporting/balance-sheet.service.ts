import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RowAmountResolverService } from './row-amount-resolver.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BalanceSheetService (docx spec Phase 23, sections 25-30). An As-Of
 * report (spec section 5) — balances, not period movements. Assets are
 * never computed as current product cost × quantity (spec section 30) —
 * `RowAmountResolverService` reads the Inventory row's mapped GL
 * accounts, period, full stop; Phase 11's own valuation is a supporting
 * schedule/drill-down target only (`SupportingScheduleService`).
 */
@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly resolver: RowAmountResolverService,
    private readonly prisma: PrismaService,
  ) {}

  async run(tenantId: string, organizationId: string, statementVersionId: string, asOfDate: Date) {
    const amounts = await this.resolver.resolve(tenantId, organizationId, statementVersionId, { type: 'AS_OF', asOfDate });
    const rows = await this.prisma.financialReportRowDefinition.findMany({ where: { tenantId, statementVersionId }, orderBy: { sequence: 'asc' } });

    const totalAssets = amounts.get('TOTAL_ASSETS')?.amount ?? new Decimal(0);
    const totalLiabilities = amounts.get('TOTAL_LIABILITIES')?.amount ?? new Decimal(0);
    const totalEquity = amounts.get('TOTAL_EQUITY')?.amount ?? new Decimal(0);
    const equationDifference = totalAssets.minus(totalLiabilities).minus(totalEquity);

    return {
      rows: rows.map((r) => ({ rowCode: r.rowCode, label: r.label, rowType: r.rowType, level: r.level, amount: amounts.get(r.rowCode)?.amount.toFixed(2) ?? null, sourceCount: amounts.get(r.rowCode)?.sourceCount ?? 0 })),
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      equationDifference: equationDifference.toFixed(2), // spec section 25 — mandatory validation input
    };
  }
}
