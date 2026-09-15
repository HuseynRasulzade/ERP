import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * ManagementSnapshotService (docx spec Phase 24, sections 105-108, 138).
 * Freezes a `payload` (whatever KPI/measure results the caller has
 * already computed) plus every relevant source-version reference (close
 * run, semantic model version, allocation run ids, budget/forecast/
 * scenario) so a board pack remains reproducible even after a later
 * reclose or cost restatement (spec section 138 — the board never sees
 * a snapshot silently change; a new snapshot is generated instead).
 * Immutable once created — no update method exists on this service.
 */
@Injectable()
export class ManagementSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: {
      organizationId: string;
      snapshotType?: string;
      period: string;
      closeRunId?: string;
      semanticModelVersionId?: string;
      allocationRunIds?: string[];
      budgetVersionId?: string;
      forecastVersionId?: string;
      scenarioId?: string;
      payload: Record<string, unknown>;
    },
  ) {
    const snapshot = await this.prisma.managementReportingSnapshot.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        snapshotType: dto.snapshotType ?? 'MONTH_END',
        period: dto.period,
        closeRunId: dto.closeRunId,
        semanticModelVersionId: dto.semanticModelVersionId,
        allocationRunIds: dto.allocationRunIds as object | undefined,
        budgetVersionId: dto.budgetVersionId,
        forecastVersionId: dto.forecastVersionId,
        scenarioId: dto.scenarioId,
        payload: dto.payload as object,
        status: 'FINAL',
        generatedBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: dto.snapshotType === 'BOARD_PACK' ? 'BOARD_PACK_FROZEN' : 'MANAGEMENT_SNAPSHOT_GENERATED', entityType: 'ManagementReportingSnapshot', entityId: snapshot.id, action: 'CREATE', userId, newValues: { snapshotType: dto.snapshotType, period: dto.period } });
    return snapshot;
  }

  async get(tenantId: string, id: string) {
    const snapshot = await this.prisma.managementReportingSnapshot.findFirst({ where: { id, tenantId } });
    if (!snapshot) throw new NotFoundAppError('ManagementReportingSnapshot', id);
    return snapshot;
  }

  list(tenantId: string, organizationId: string, snapshotType?: string) {
    return this.prisma.managementReportingSnapshot.findMany({ where: { tenantId, organizationId, snapshotType }, orderBy: { generatedAt: 'desc' } });
  }
}
