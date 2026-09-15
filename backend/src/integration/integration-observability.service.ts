import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * IntegrationObservabilityService (docx spec Phase 28, section 107) —
 * a rebuildable-projection metrics rollup (same "computed live, never
 * stored" pattern as every prior phase's own health/reporting service),
 * scoped to one endpoint over a lookback window.
 */
@Injectable()
export class IntegrationObservabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async endpointMetrics(tenantId: string, endpointId: string, sinceHours = 24) {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const [received, processed, rejected, deadLettered, retries] = await Promise.all([
      this.prisma.integrationMessage.count({ where: { tenantId, endpointId, receivedAt: { gte: since } } }),
      this.prisma.integrationMessage.count({ where: { tenantId, endpointId, status: { in: ['PROCESSED', 'PARTIALLY_PROCESSED'] }, receivedAt: { gte: since } } }),
      this.prisma.integrationMessage.count({ where: { tenantId, endpointId, status: 'REJECTED', receivedAt: { gte: since } } }),
      this.prisma.integrationMessage.count({ where: { tenantId, endpointId, status: 'DEAD_LETTER', receivedAt: { gte: since } } }),
      this.prisma.integrationMessageAttempt.count({ where: { tenantId, message: { endpointId }, result: 'RETRYING', startedAt: { gte: since } } }),
    ]);

    return { endpointId, sinceHours, received, processed, rejected, deadLettered, retries, successRate: received === 0 ? null : processed / received };
  }
}
