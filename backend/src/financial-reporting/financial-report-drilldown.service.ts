import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReportMappingService } from './financial-report-mapping.service';
import { NotFoundAppError } from '../common/errors/app-error';

const SENSITIVE_SOURCE_MODULES = new Set(['PAYROLL', 'PAYROLL_POSTING']);

/**
 * FinancialReportDrilldownService (docx spec Phase 23, sections 91-101).
 * Report Row -> Mapping -> Account(s) -> GL Journal Entries, one level
 * per call so the caller renders each step and a permission check can
 * gate the NEXT hop rather than the whole chain at once. Payroll
 * detail is aggregated-only unless `includeSensitive` is explicitly
 * true (spec section 99 — the controller decides that from the caller's
 * own permissions, never this service).
 */
@Injectable()
export class FinancialReportDrilldownService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: FinancialReportMappingService,
  ) {}

  /** Cell -> mapped accounts (spec section 100's own lineage chain,
   * step 1). */
  async cellToAccounts(tenantId: string, reportRunId: string, rowCode: string) {
    const cell = await this.prisma.financialReportCell.findFirst({ where: { tenantId, reportRunId, rowCode, columnCode: 'CURRENT' } });
    if (!cell) throw new NotFoundAppError('FinancialReportCell', `${reportRunId}/${rowCode}`);
    const run = await this.prisma.financialReportRun.findUniqueOrThrow({ where: { id: reportRunId } });
    const row = await this.prisma.financialReportRowDefinition.findFirstOrThrow({ where: { tenantId, statementVersionId: run.statementVersionId, rowCode } });
    const referenceDate = run.asOfDate ?? run.periodEnd ?? new Date();
    const resolved = await this.mapping.resolveActiveMappings(tenantId, run.statementVersionId, referenceDate);
    const rowMappings = resolved.filter((m) => m.reportRowId === row.id);
    const accountIds = Array.from(new Set(rowMappings.flatMap((m) => m.accountIds)));
    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, code: true, name: true, accountClass: true } });
    return { cellAmount: cell.amount.toString(), accounts };
  }

  /** Account -> GL journal entries for the run's own period/as-of window
   * (spec section 101's own "Explain Report Cell" — opening, movements,
   * closing, adjustments). */
  async accountToMovements(tenantId: string, reportRunId: string, accountId: string, limit = 100) {
    const run = await this.prisma.financialReportRun.findUniqueOrThrow({ where: { id: reportRunId } });
    const dateFilter = run.asOfDate ? { lte: run.asOfDate } : { gte: run.periodStart ?? new Date(0), lte: run.periodEnd ?? new Date() };
    return this.prisma.accountingMovement.findMany({
      where: { tenantId, organizationId: run.organizationId, accountId, businessDate: dateFilter },
      include: { journalEntry: { select: { journalNumber: true, description: true, sourceDocumentType: true, sourceDocumentId: true } } },
      orderBy: [{ businessDate: 'asc' }, { postingSequence: 'asc' }],
      take: limit,
    });
  }

  /** Aggregated-only view of a sensitive source module (spec section 99
   * — "show aggregated source without sensitive fields"). */
  isSensitiveSourceModule(sourceDocumentType: string): boolean {
    return SENSITIVE_SOURCE_MODULES.has(sourceDocumentType);
  }

  /** Full conceptual lineage summary for one cell (spec section 100). */
  async explainCell(tenantId: string, reportRunId: string, rowCode: string) {
    const run = await this.prisma.financialReportRun.findUniqueOrThrow({ where: { id: reportRunId } });
    const { cellAmount, accounts } = await this.cellToAccounts(tenantId, reportRunId, rowCode);
    return {
      rowCode,
      cellAmount,
      mappedAccounts: accounts,
      closeRunId: run.closeRunId,
      frameworkVersionId: run.frameworkVersionId,
      statementVersionId: run.statementVersionId,
      calculationVersion: run.calculationVersion,
    };
  }
}
