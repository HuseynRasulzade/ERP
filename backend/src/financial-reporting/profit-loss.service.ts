import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { RowAmountResolverService } from './row-amount-resolver.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ProfitLossService (docx spec Phase 23, sections 31-38). A Period
 * report (spec section 5) — movements between `periodStart` and
 * `periodEnd`, never a naive list of every account's closing balance
 * (spec section 32, 193's own critical rule).
 */
@Injectable()
export class ProfitLossService {
  constructor(
    private readonly resolver: RowAmountResolverService,
    private readonly prisma: PrismaService,
  ) {}

  async run(tenantId: string, organizationId: string, statementVersionId: string, periodStart: Date, periodEnd: Date) {
    const amounts = await this.resolver.resolve(tenantId, organizationId, statementVersionId, { type: 'PERIOD', periodStart, periodEnd });
    const rows = await this.prisma.financialReportRowDefinition.findMany({ where: { tenantId, statementVersionId }, orderBy: { sequence: 'asc' } });
    const netResult = amounts.get('NET_PROFIT')?.amount ?? new Decimal(0);

    return {
      rows: rows.map((r) => ({ rowCode: r.rowCode, label: r.label, rowType: r.rowType, level: r.level, amount: amounts.get(r.rowCode)?.amount.toFixed(2) ?? null, sourceCount: amounts.get(r.rowCode)?.sourceCount ?? 0 })),
      netResult: netResult.toFixed(2),
    };
  }
}
