import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementSemanticModelService } from './management-semantic-model.service';
import { MeasureMode } from './management-measure.service';
import { FinancialReportFormulaService } from '../financial-reporting/financial-report-formula.service';
import { FinancialResultService } from '../period-close/financial-result.service';

/**
 * ManagementPnLService (docx spec Phase 24, sections 44-48). A
 * `ManagementPnLDefinition`'s rows may use a totally different
 * structure/grouping than Phase 23's statutory P&L (spec section 44's
 * own Fulfillment/Commercial Cost/EBITDA-style example) — this NEVER
 * touches Phase 4's GL structure to achieve that (spec section 46); it
 * only reads governed measures. `reconcileToFinancial` provides the
 * bridge spec section 47 requires, without forcing the two layouts to
 * match.
 */
@Injectable()
export class ManagementPnLService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticModel: ManagementSemanticModelService,
    private readonly formula: FinancialReportFormulaService,
    private readonly financialResult: FinancialResultService,
  ) {}

  async createDefinition(tenantId: string, dto: { code: string; name: string }) {
    return this.prisma.managementPnLDefinition.create({ data: { tenantId, code: dto.code, name: dto.name } });
  }

  async addRow(tenantId: string, definitionId: string, dto: { rowCode: string; label: string; rowType?: string; measureCode?: string; formula?: string; sequence?: number; parentRowId?: string }) {
    return this.prisma.managementPnLRow.create({ data: { tenantId, definitionId, rowCode: dto.rowCode, label: dto.label, rowType: dto.rowType ?? 'MEASURE', measureCode: dto.measureCode, formula: dto.formula, sequence: dto.sequence ?? 0, parentRowId: dto.parentRowId } });
  }

  async calculate(tenantId: string, organizationId: string, definitionCode: string, semanticModelVersionId: string, mode: MeasureMode): Promise<{ rowCode: string; label: string; amount: string }[]> {
    const definition = await this.prisma.managementPnLDefinition.findFirstOrThrow({ where: { tenantId, code: definitionCode } });
    const rows = await this.prisma.managementPnLRow.findMany({ where: { tenantId, definitionId: definition.id }, orderBy: { sequence: 'asc' } });

    const amounts = new Map<string, Decimal>();
    const formulaRows = new Map<string, string>();
    const childrenByParent = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.parentRowId) {
        if (!childrenByParent.has(row.parentRowId)) childrenByParent.set(row.parentRowId, []);
        childrenByParent.get(row.parentRowId)!.push(row);
      }
    }

    for (const row of rows) {
      if (row.rowType === 'MEASURE' && row.measureCode) {
        const result = await this.semanticModel.resolveMeasure(tenantId, organizationId, semanticModelVersionId, row.measureCode, mode);
        amounts.set(row.rowCode, result.value);
      } else if (row.rowType === 'SUBTOTAL' && !row.formula) {
        const children = childrenByParent.get(row.id) ?? [];
        amounts.set(row.rowCode, children.reduce((s, c) => s.plus(amounts.get(c.rowCode) ?? new Decimal(0)), new Decimal(0)));
      } else if (row.formula) {
        formulaRows.set(row.rowCode, row.formula);
      }
    }
    if (formulaRows.size > 0) {
      for (const rowCode of this.formula.topologicalOrder(formulaRows)) {
        amounts.set(rowCode, this.formula.evaluate(formulaRows.get(rowCode)!, amounts));
      }
    }

    return rows.map((r) => ({ rowCode: r.rowCode, label: r.label, amount: (amounts.get(r.rowCode) ?? new Decimal(0)).toFixed(2) }));
  }

  /** Management-to-Financial bridge (spec sections 47-48) — compares
   * the Management P&L's own bottom-line row against Phase 22's own
   * authoritative financial result for the same organization/period,
   * surfacing the raw difference for the caller to explain (this build
   * does not itself decompose the difference into named causes —
   * disclosed, docs/MANAGEMENT_REPORTING.md section F). */
  async reconcileToFinancial(tenantId: string, organizationId: string, managementResultRowAmount: string, periodStart: Date, periodEnd: Date) {
    const financial = await this.financialResult.calculate(tenantId, organizationId, periodStart, periodEnd);
    const difference = new Decimal(managementResultRowAmount).minus(financial.netResult);
    return { managementResult: managementResultRowAmount, financialResult: financial.netResult, difference: difference.toFixed(2), reconciled: difference.abs().lte('0.01') };
  }
}
