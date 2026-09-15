import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FinancialReportExportService (docx spec Phase 23, sections 139-142).
 * Produces the frozen, machine-readable JSON export (spec section 139's
 * own "machine-readable JSON/API") from a report run's stored
 * `FinancialReportCell` rows — a preliminary run's export is clearly
 * labeled PRELIMINARY. Binary PDF/XLSX rendering is a presentation-layer
 * concern this build does not implement (disclosed simplification,
 * docs/FINANCIAL_REPORTING.md section E) — `toCsv` demonstrates the same
 * frozen-data contract a real PDF/XLSX renderer would consume.
 */
@Injectable()
export class FinancialReportExportService {
  constructor(private readonly prisma: PrismaService) {}

  async toJson(tenantId: string, reportRunId: string) {
    const run = await this.prisma.financialReportRun.findFirst({
      where: { id: reportRunId, tenantId },
      include: { cells: true, organization: true, reportingCurrency: true, statementDefinition: true, statementVersion: true, frameworkVersion: { include: { framework: true } } },
    });
    if (!run) throw new NotFoundAppError('FinancialReportRun', reportRunId);

    // spec section 114 — an open-period/non-final run's export must be
    // clearly labeled PRELIMINARY, computed once below via `metadata.status`.
    return {
      metadata: {
        organization: run.organization.name,
        reportingPeriod: run.asOfDate ? { asOfDate: run.asOfDate } : { periodStart: run.periodStart, periodEnd: run.periodEnd },
        currency: run.reportingCurrency.code,
        framework: run.frameworkVersion.framework.code,
        statementType: run.statementDefinition.statementType,
        reportVersion: run.calculationVersion,
        generatedAt: run.generatedAt,
        status: run.status === 'FINAL' || run.status === 'SIGNED' ? 'FINAL' : 'PRELIMINARY',
        closeRunId: run.closeRunId,
      },
      rows: run.cells.map((c) => ({ rowCode: c.rowCode, columnCode: c.columnCode, amount: c.amount.toString() })),
    };
  }

  async toCsv(tenantId: string, reportRunId: string): Promise<string> {
    const json = await this.toJson(tenantId, reportRunId);
    const header = 'row_code,column_code,amount';
    const lines = json.rows.map((r) => `${r.rowCode},${r.columnCode},${r.amount}`);
    return [header, ...lines].join('\n');
  }

  async assertExportable(tenantId: string, reportRunId: string) {
    const run = await this.prisma.financialReportRun.findFirst({ where: { id: reportRunId, tenantId } });
    if (!run) throw new NotFoundAppError('FinancialReportRun', reportRunId);
    if (run.status === 'CREATED' || run.status === 'CALCULATING') throw new ValidationAppError('Report is still calculating — nothing to export yet.');
  }
}
