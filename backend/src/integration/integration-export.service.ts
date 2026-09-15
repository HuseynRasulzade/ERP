import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { canonicalJson } from '../audit/audit-canonical-json.util';
import { IdempotencyService } from '../idempotency/idempotency.service';

export interface ExportRecordInput {
  internalEntityType: string;
  internalEntityId: string;
  sourceVersion?: number;
  data: Record<string, unknown>;
}

/**
 * IntegrationExportService (docx spec Phase 28, sections 88-96). Every
 * export job pins an exact `asOfSnapshotAt` and a `sourceVersionTag`
 * hash of the exported rows (spec section 90/219 — "export should know
 * exact source data/version/as-of time... especially for financial/
 * statutory exports") — never a vague "current state" export. Outbound
 * delivery reuses `IdempotencyService` keyed by
 * `(endpointId, exportJobId)` so a provider-side timeout-then-retry
 * never creates a duplicate provider object where the provider itself
 * supports idempotency (spec section 95/220).
 */
@Injectable()
export class IntegrationExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async generate(tenantId: string, input: { endpointId: string; contractCode: string; exportType: 'FULL' | 'INCREMENTAL' | 'CHANGED_SINCE_CURSOR' | 'EVENT_BASED'; requestedBy: string; filterScope?: Record<string, unknown>; records: ExportRecordInput[] }) {
    const asOfSnapshotAt = new Date();
    const sourceVersionTag = createHash('sha256').update(canonicalJson(input.records.map((r) => ({ id: r.internalEntityId, v: r.sourceVersion, data: r.data })))).digest('hex');

    const job = await this.prisma.integrationExportJob.create({
      data: {
        tenantId,
        endpointId: input.endpointId,
        contractCode: input.contractCode,
        exportType: input.exportType,
        requestedBy: input.requestedBy,
        filterScope: (input.filterScope ?? null) as object | undefined,
        status: 'GENERATED',
        recordCount: input.records.length,
        asOfSnapshotAt,
        sourceVersionTag,
        outputHash: sourceVersionTag,
      },
    });

    await this.prisma.integrationExportItem.createMany({
      data: input.records.map((r) => ({ tenantId, exportJobId: job.id, internalEntityType: r.internalEntityType, internalEntityId: r.internalEntityId, sourceVersion: r.sourceVersion, status: 'PENDING' as const })),
    });

    await this.audit.record({ tenantId, eventType: 'ExportGenerated', eventCategory: 'INTEGRATION', entityType: 'IntegrationExportJob', entityId: job.id, operation: 'CREATE', action: 'CREATE', userId: input.requestedBy, metadata: { contractCode: input.contractCode, recordCount: input.records.length, sourceVersionTag, filterScope: input.filterScope } });
    return job;
  }

  /** Delivery is idempotent per (endpoint, exportJob) — a timed-out
   * request that actually succeeded upstream and is retried reuses the
   * same logical result instead of re-delivering (spec section 95). */
  async deliver(tenantId: string, exportJobId: string, deliverFn: () => Promise<{ externalStatus: string }>) {
    const job = await this.get(tenantId, exportJobId);
    const result = await this.idempotency.withIdempotency(tenantId, `export:${exportJobId}`, 'integration.export.deliver', { exportJobId }, async () => {
      const updated = await this.prisma.integrationExportJob.update({ where: { id: exportJobId }, data: { status: 'DELIVERING' } });
      const delivery = await deliverFn();
      await this.prisma.integrationExportJob.update({ where: { id: exportJobId }, data: { status: 'DELIVERED', externalDeliveryStatus: delivery.externalStatus, completedAt: new Date() } });
      return delivery;
    });
    await this.audit.record({ tenantId, eventType: 'ExportDelivered', eventCategory: 'INTEGRATION', entityType: 'IntegrationExportJob', entityId: exportJobId, operation: 'UPDATE', action: 'DELIVER', userId: job.requestedBy, metadata: { externalStatus: result.externalStatus } });
    return result;
  }

  private async get(tenantId: string, id: string) {
    const row = await this.prisma.integrationExportJob.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('IntegrationExportJob', id);
    return row;
  }
}
