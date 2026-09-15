import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AIHealthService (docx spec Phase 29, sections 150-152). Same
 * rebuildable-projection pattern as every prior phase's own
 * `*HealthService` — computed live, never stored except for material
 * issues that should survive across checks for a dashboard.
 */
@Injectable()
export class AIHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(tenantId: string) {
    const [providerFailures, blockedInteractions, failedInteractions, unresolvedFailedEvals, staleModelDrafts, highRejectedActionRate] = await Promise.all([
      this.prisma.aIProvider.count({ where: { tenantId, status: 'SUSPENDED' } }),
      this.prisma.aIInteraction.count({ where: { tenantId, status: 'BLOCKED' } }),
      this.prisma.aIInteraction.count({ where: { tenantId, status: 'FAILED' } }),
      this.prisma.aIEvaluationRun.count({ where: { tenantId, passed: false } }),
      this.prisma.aIModelVersion.count({ where: { tenantId, status: 'DRAFT', evaluationStatus: 'FAILED' } }),
      this.prisma.aIActionProposal.count({ where: { tenantId, status: 'FAILED' } }),
    ]);

    const issues: { issueType: string; severity: string; message: string }[] = [];
    if (providerFailures > 0) issues.push({ issueType: 'PROVIDER_AUTH_FAILURE', severity: 'ERROR', message: `${providerFailures} provider(s) suspended` });
    if (blockedInteractions > 0) issues.push({ issueType: 'PERMISSION_FILTER_FAILURE', severity: 'INFO', message: `${blockedInteractions} interaction(s) blocked by guardrails (expected under normal operation)` });
    if (failedInteractions > 0) issues.push({ issueType: 'MODEL_UNAVAILABLE', severity: 'WARNING', message: `${failedInteractions} failed interaction(s)` });
    if (unresolvedFailedEvals > 0) issues.push({ issueType: 'EVALUATION_REGRESSION', severity: 'ERROR', message: `${unresolvedFailedEvals} failed evaluation run(s)` });
    if (highRejectedActionRate > 5) issues.push({ issueType: 'ACTION_PROPOSAL_EXECUTION_FAILURE', severity: 'WARNING', message: `${highRejectedActionRate} failed action proposal execution(s)` });

    for (const issue of issues.filter((i) => i.severity === 'ERROR' || i.severity === 'BLOCKING')) {
      await this.prisma.aIHealthIssue.create({ data: { tenantId, issueType: issue.issueType, severity: issue.severity, message: issue.message } });
    }

    return { healthy: issues.filter((i) => i.severity !== 'INFO').length === 0, issues };
  }

  listOpenIssues(tenantId: string) {
    return this.prisma.aIHealthIssue.findMany({ where: { tenantId, resolved: false }, orderBy: { detectedAt: 'desc' } });
  }
}
