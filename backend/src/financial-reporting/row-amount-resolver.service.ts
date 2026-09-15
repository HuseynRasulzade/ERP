import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReportMappingService } from './financial-report-mapping.service';
import { FinancialReportFormulaService } from './financial-report-formula.service';

export type ReportingMode = { type: 'AS_OF'; asOfDate: Date } | { type: 'PERIOD'; periodStart: Date; periodEnd: Date };

export interface ResolvedRowAmount {
  rowCode: string;
  amount: Decimal;
  sourceCount: number;
}

/**
 * RowAmountResolverService (docx spec Phase 23, sections 3-13, 21, 25,
 * 31). The one shared calculation engine `TrialBalanceReportingService`,
 * `BalanceSheetService`, `ProfitLossService`, and `EquityStatementService`
 * all delegate to (spec section 153's own "Monolithic ReportService
 * yaratma" warning is about a single controller/facade class, not about
 * every statement type re-deriving its own account aggregation from
 * scratch — that WOULD duplicate logic). Reads exclusively from the
 * immutable `AccountingMovement` register (never a cached balance
 * column) — the single accounting source of truth (spec section 1's own
 * Layer 1, and the critical rule "Balance Sheet/P&L numbers-i editable
 * report cells kimi source-of-truth etmə").
 */
@Injectable()
export class RowAmountResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: FinancialReportMappingService,
    private readonly formula: FinancialReportFormulaService,
  ) {}

  async resolve(tenantId: string, organizationId: string, statementVersionId: string, mode: ReportingMode): Promise<Map<string, ResolvedRowAmount>> {
    const referenceDate = mode.type === 'AS_OF' ? mode.asOfDate : mode.periodEnd;
    const rows = await this.prisma.financialReportRowDefinition.findMany({ where: { tenantId, statementVersionId }, orderBy: { sequence: 'asc' } });
    const resolvedMappings = await this.mapping.resolveActiveMappings(tenantId, statementVersionId, referenceDate);

    const amounts = new Map<string, ResolvedRowAmount>();
    const formulaRows = new Map<string, string>();

    // --- DATA rows: aggregate GL movements per mapping, signed per policy ---
    for (const row of rows) {
      if (row.rowType !== 'DATA') continue;
      const rowMappings = resolvedMappings.filter((m) => m.reportRowId === row.id && m.strategy !== 'EXCLUSION');
      const exclusionMappings = resolvedMappings.filter((m) => m.reportRowId === row.id && m.strategy === 'EXCLUSION');
      const excludedAccountIds = new Set(exclusionMappings.flatMap((m) => m.accountIds));

      let total = new Decimal(0);
      let sourceCount = 0;
      for (const m of rowMappings) {
        const accountIds = m.accountIds.filter((id) => !excludedAccountIds.has(id));
        if (accountIds.length === 0) continue;
        const { amount, count } = await this.aggregate(tenantId, organizationId, accountIds, m.movementType, m.balanceSide, mode);
        total = total.plus(amount.mul(m.signMultiplier));
        sourceCount += count;
      }
      amounts.set(row.rowCode, { rowCode: row.rowCode, amount: row.signPolicy === 'FLIP' ? total.neg() : total, sourceCount });
    }

    // --- SUBTOTAL rows without an explicit formula: sum direct children ---
    const childrenByParent = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!row.parentRowId) continue;
      if (!childrenByParent.has(row.parentRowId)) childrenByParent.set(row.parentRowId, []);
      childrenByParent.get(row.parentRowId)!.push(row);
    }
    // Rows are processed in ascending `sequence` order, and a SUBTOTAL
    // row's own children are always authored with a lower sequence than
    // the subtotal itself (detail rows, then the total beneath them) —
    // so a child SUBTOTAL is already resolved by the time a parent
    // SUBTOTAL sums it. Disclosed as an authoring convention, not an
    // enforced constraint (docs/FINANCIAL_REPORTING.md section B).
    for (const row of rows) {
      if (row.rowType === 'SUBTOTAL' && !row.formula) {
        const children = childrenByParent.get(row.id) ?? [];
        const sum = children.reduce((s, c) => s.plus(amounts.get(c.rowCode)?.amount ?? new Decimal(0)), new Decimal(0));
        amounts.set(row.rowCode, { rowCode: row.rowCode, amount: sum, sourceCount: children.length });
      }
      if (row.formula && (row.rowType === 'FORMULA' || row.rowType === 'SUBTOTAL')) {
        formulaRows.set(row.rowCode, row.formula);
      }
    }

    // --- FORMULA rows: topological evaluation, cycle-checked ---
    if (formulaRows.size > 0) {
      const order = this.formula.topologicalOrder(formulaRows);
      for (const rowCode of order) {
        const flatAmounts = new Map(Array.from(amounts.entries()).map(([k, v]) => [k, v.amount]));
        const amount = this.formula.evaluate(formulaRows.get(rowCode)!, flatAmounts);
        amounts.set(rowCode, { rowCode, amount, sourceCount: 0 });
      }
    }

    return amounts;
  }

  private async aggregate(tenantId: string, organizationId: string, accountIds: string[], movementType: string, balanceSide: string | null, mode: ReportingMode): Promise<{ amount: Decimal; count: number }> {
    const dateFilter = mode.type === 'AS_OF' ? { lte: mode.asOfDate } : movementType === 'PERIOD_MOVEMENT' ? { gte: mode.periodStart, lte: mode.periodEnd } : { lte: mode.periodEnd };

    const agg = await this.prisma.accountingMovement.groupBy({
      by: ['side'],
      where: { tenantId, organizationId, accountId: { in: accountIds }, businessDate: dateFilter },
      _sum: { amountBase: true },
      _count: { _all: true },
    });
    const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
    const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
    const count = agg.reduce((s, r) => s + r._count._all, 0);

    if (balanceSide === 'DEBIT') return { amount: debit, count };
    if (balanceSide === 'CREDIT') return { amount: credit, count };
    return { amount: debit.minus(credit), count }; // NET (default) — signMultiplier handles presentation sign
  }
}
