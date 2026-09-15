import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ManagementReportingHealthFinding {
  check: string;
  count: number;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  blocking: boolean;
}

/**
 * ManagementReportingHealthService (docx spec Phase 24, section 126).
 * Computed live — same "rebuildable projection" convention as every
 * other Health service in this codebase. Feeds Phase 30's own
 * organization-wide Accounting Health engine (spec section 172).
 */
@Injectable()
export class ManagementReportingHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<ManagementReportingHealthFinding[]> {
    const findings: ManagementReportingHealthFinding[] = [];

    const draftBudgets = await this.prisma.budgetVersion.count({ where: { tenantId, organizationId, status: { in: ['DRAFT', 'WORKING'] } } });
    if (draftBudgets > 0) findings.push({ check: 'MISSING_APPROVED_BUDGET_VERSION', count: draftBudgets, severity: 'WARNING', blocking: false });

    const unpublishedForecasts = await this.prisma.managementForecastVersion.count({ where: { tenantId, organizationId, status: 'DRAFT' } });
    if (unpublishedForecasts > 0) findings.push({ check: 'UNPUBLISHED_FORECAST', count: unpublishedForecasts, severity: 'INFO', blocking: false });

    const staleSnapshots = await this.prisma.managementReportingSnapshot.count({ where: { tenantId, organizationId, generatedAt: { lt: new Date(Date.now() - 45 * 86400000) }, snapshotType: 'BOARD_PACK' } });
    if (staleSnapshots > 0) findings.push({ check: 'STALE_BOARD_SNAPSHOT', count: staleSnapshots, severity: 'INFO', blocking: false });

    const measuresWithoutFormula = await this.prisma.managementMeasureDefinition.count({ where: { tenantId, aggregationType: 'FORMULA', formula: null, semanticModelVersion: { status: 'ACTIVE' } } });
    if (measuresWithoutFormula > 0) findings.push({ check: 'UNMAPPED_MANAGEMENT_MEASURE', count: measuresWithoutFormula, severity: 'BLOCKING', blocking: true });

    const unresolvedAllocationRuns = await this.prisma.managementAllocationRun.count({ where: { tenantId, organizationId, status: { not: 'COMPLETED' } } });
    if (unresolvedAllocationRuns > 0) findings.push({ check: 'ALLOCATION_RESIDUAL', count: unresolvedAllocationRuns, severity: 'WARNING', blocking: false });

    return findings;
  }
}
