import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationPollingService } from './integration-polling.service';

/**
 * IntegrationHealthService (docx spec Phase 28, sections 108-110).
 * Aggregates the minimum checks the spec names — expired credentials,
 * dead-letter/staging backlog, stale polling cursors, unresolved
 * reconciliation mismatches, disabled endpoints — into one severity-
 * ranked issue list, and additionally persists anything BLOCKING/ERROR
 * as an `IntegrationHealthIssue` row so it survives across health-check
 * calls for dashboards/alerting.
 */
@Injectable()
export class IntegrationHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: IntegrationCredentialService,
    private readonly polling: IntegrationPollingService,
  ) {}

  async summary(tenantId: string) {
    const [expiredCredentials, disabledEndpoints, deadLetterBacklog, stagingBacklog, staleCursors, unresolvedReconMismatches] = await Promise.all([
      this.credentials.listExpiring(tenantId, 7),
      this.prisma.integrationEndpoint.count({ where: { tenantId, enabled: false, status: 'ACTIVE' } }),
      this.prisma.integrationDeadLetter.count({ where: { tenantId, status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.integrationStagingBatch.count({ where: { tenantId, status: 'OPEN' } }),
      this.polling.listStale(tenantId, 60),
      this.prisma.integrationReconciliationResult.count({ where: { tenantId, resultType: { in: ['INTERNAL_MISSING', 'EXTERNAL_MISSING', 'AMOUNT_MISMATCH', 'UNRESOLVED'] } } }),
    ]);

    const issues: { issueType: string; severity: string; message: string }[] = [];
    if (expiredCredentials.length > 0) issues.push({ issueType: 'EXPIRED_CREDENTIAL', severity: 'ERROR', message: `${expiredCredentials.length} credential(s) expiring within 7 days` });
    if (disabledEndpoints > 0) issues.push({ issueType: 'ENDPOINT_DISABLED_UNEXPECTEDLY', severity: 'WARNING', message: `${disabledEndpoints} endpoint(s) marked ACTIVE but disabled` });
    if (deadLetterBacklog > 0) issues.push({ issueType: 'DEAD_LETTERS', severity: deadLetterBacklog > 20 ? 'BLOCKING' : 'WARNING', message: `${deadLetterBacklog} open dead letter(s)` });
    if (stagingBacklog > 0) issues.push({ issueType: 'STAGING_BACKLOG', severity: 'WARNING', message: `${stagingBacklog} open staging batch(es)` });
    if (staleCursors.length > 0) issues.push({ issueType: 'POLLING_STALE', severity: 'WARNING', message: `${staleCursors.length} polling cursor(s) stale beyond 60 minutes` });
    if (unresolvedReconMismatches > 0) issues.push({ issueType: 'RECONCILIATION_MISMATCH', severity: 'ERROR', message: `${unresolvedReconMismatches} unresolved reconciliation mismatch(es)` });

    for (const issue of issues.filter((i) => i.severity === 'ERROR' || i.severity === 'BLOCKING')) {
      await this.prisma.integrationHealthIssue.create({ data: { tenantId, issueType: issue.issueType, severity: issue.severity, message: issue.message } });
    }

    return { healthy: issues.length === 0, issues };
  }

  listOpenIssues(tenantId: string) {
    return this.prisma.integrationHealthIssue.findMany({ where: { tenantId, resolved: false }, orderBy: { detectedAt: 'desc' } });
  }

  async resolveIssue(tenantId: string, id: string) {
    return this.prisma.integrationHealthIssue.update({ where: { id }, data: { resolved: true, resolvedAt: new Date() } });
  }
}
