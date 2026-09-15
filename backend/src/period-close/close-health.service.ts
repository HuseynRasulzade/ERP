import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CloseHealthFinding {
  module: string;
  check: string;
  count: number;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  blocking: boolean;
}

/**
 * CloseHealthService (docx spec Phase 22, sections 143-144). Computed
 * live, same "rebuildable projection" convention as every other Health
 * service in this codebase — no stored `close_health_issues` table
 * (disclosed simplification, docs/MONTH_CLOSE.md section L). Feeds
 * Phase 30's own organization-wide Accounting Health engine (spec
 * section 170) by exposing this same shape.
 */
@Injectable()
export class CloseHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<CloseHealthFinding[]> {
    const findings: CloseHealthFinding[] = [];

    const staleRunningSteps = await this.prisma.periodCloseStep.count({
      where: { tenantId, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 4 * 60 * 60 * 1000) }, closeRun: { organizationId } },
    });
    if (staleRunningSteps > 0) findings.push({ module: 'CLOSE', check: 'STALE_RUNNING_STEP', count: staleRunningSteps, severity: 'ERROR', blocking: false });

    const unresolvedBlockingIssues = await this.prisma.periodCloseIssue.count({ where: { tenantId, blocking: true, status: { in: ['OPEN', 'IN_REVIEW'] }, closeRun: { organizationId } } });
    if (unresolvedBlockingIssues > 0) findings.push({ module: 'CLOSE', check: 'UNRESOLVED_BLOCKING_ISSUE', count: unresolvedBlockingIssues, severity: 'BLOCKING', blocking: true });

    const blockingReconciliationDifferences = await this.prisma.periodReconciliationResult.count({ where: { tenantId, status: 'BLOCKING', closeRun: { organizationId } } });
    if (blockingReconciliationDifferences > 0) findings.push({ module: 'RECONCILIATION', check: 'BLOCKING_DIFFERENCE', count: blockingReconciliationDifferences, severity: 'BLOCKING', blocking: true });

    const pendingReopenRequests = await this.prisma.periodReopenRequest.count({ where: { tenantId, status: 'PENDING', financialPeriod: { organizationId } } });
    if (pendingReopenRequests > 0) findings.push({ module: 'CLOSE', check: 'PENDING_REOPEN_REQUEST', count: pendingReopenRequests, severity: 'WARNING', blocking: false });

    const invalidatedSteps = await this.prisma.periodCloseStep.count({ where: { tenantId, status: 'INVALIDATED', closeRun: { organizationId } } });
    if (invalidatedSteps > 0) findings.push({ module: 'CLOSE', check: 'INVALIDATED_STEP_AWAITING_RECLOSE', count: invalidatedSteps, severity: 'WARNING', blocking: false });

    return findings;
  }
}
