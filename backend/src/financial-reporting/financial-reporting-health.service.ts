import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReportMappingService } from './financial-report-mapping.service';

export interface FinancialReportingHealthFinding {
  check: string;
  count: number;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  blocking: boolean;
}

/**
 * FinancialReportingHealthService (docx spec Phase 23, section 111).
 * Computed live — same "rebuildable projection" convention as every
 * other Health service in this codebase. Feeds Phase 30's own
 * organization-wide Accounting Health engine (spec section 164).
 */
@Injectable()
export class FinancialReportingHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapping: FinancialReportMappingService,
  ) {}

  async check(tenantId: string, organizationId: string, statementVersionId?: string): Promise<FinancialReportingHealthFinding[]> {
    const findings: FinancialReportingHealthFinding[] = [];

    if (statementVersionId) {
      const coverage = await this.mapping.coverage(tenantId, organizationId, statementVersionId, new Date());
      if (coverage.unmappedAccounts.length > 0) findings.push({ check: 'UNMAPPED_MATERIAL_ACCOUNTS', count: coverage.unmappedAccounts.length, severity: 'BLOCKING', blocking: true });
      if (coverage.duplicateMappedAccounts.length > 0) findings.push({ check: 'DUPLICATE_MAPPING', count: coverage.duplicateMappedAccounts.length, severity: 'BLOCKING', blocking: true });
    }

    const blockingValidations = await this.prisma.financialReportValidationResult.count({ where: { tenantId, status: { in: ['FAIL', 'BLOCKING'] }, reportRun: { organizationId } } });
    if (blockingValidations > 0) findings.push({ check: 'CROSS_STATEMENT_MISMATCH', count: blockingValidations, severity: 'BLOCKING', blocking: true });

    const supersededFinal = await this.prisma.financialReportRun.count({ where: { tenantId, organizationId, status: 'SUPERSEDED' } });
    if (supersededFinal > 0) findings.push({ check: 'SUPERSEDED_CLOSE_VERSION_REPORT', count: supersededFinal, severity: 'INFO', blocking: false });

    const staleRuns = await this.prisma.financialReportRun.count({ where: { tenantId, organizationId, status: { in: ['CALCULATED', 'VALIDATION_WARNING'] }, generatedAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
    if (staleRuns > 0) findings.push({ check: 'STALE_UNFINALIZED_REPORT', count: staleRuns, severity: 'WARNING', blocking: false });

    return findings;
  }
}
