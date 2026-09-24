import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const InventoryCountEvents = {
  PLANNED: 'InventoryCountPlanned',
  STARTED: 'InventoryCountStarted',
  SNAPSHOT_CREATED: 'InventorySnapshotCreated',
  FREEZE_ACTIVATED: 'InventoryFreezeActivated',
  FREEZE_RELEASED: 'InventoryFreezeReleased',
  ENTRY_RECORDED: 'InventoryCountEntryRecorded',
  COMPLETED: 'InventoryCountCompleted',
  RECOUNT_REQUESTED: 'InventoryRecountRequested',
  VARIANCE_CALCULATED: 'InventoryVarianceCalculated',
  VARIANCE_APPROVED: 'InventoryVarianceApproved',
  ADJUSTMENT_POSTED: 'InventoryAdjustmentPosted',
  RECONCILED: 'InventoryCountReconciled',
  CLOSED: 'InventoryCountClosed',
  CANCELLED: 'InventoryCountCancelled',
} as const;

/**
 * Domain events (spec section 105) via a transactional outbox: the event
 * row is written inside the same transaction as the state change, so an
 * event exists if and only if the change committed ("reliable publish").
 * A future dispatcher marks rows `publishedAt` after delivery; consumers
 * (Phase 22 month close, Phase 30 health) can also simply read the table.
 *
 * Also the single place this module writes audit events (spec section 78)
 * so every audit row carries the same entity typing.
 */
@Injectable()
export class InventoryCountEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async emit(tenantId: string, eventType: string, refs: { sessionId?: string | null; planId?: string | null }, payload: Record<string, unknown>, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    await client.inventoryCountEvent.create({
      data: { tenantId, eventType, sessionId: refs.sessionId ?? undefined, planId: refs.planId ?? undefined, payload: payload as any },
    });
  }

  async audit(
    tenantId: string,
    params: { eventType: string; entityType: string; entityId: string; action: string; userId?: string | null; oldValues?: unknown; newValues?: unknown; reason?: string },
    tx?: PrismaTransactionClient,
  ) {
    await this.auditService.record({ tenantId, ...params }, tx);
  }

  list(tenantId: string, filter: { sessionId?: string; planId?: string }) {
    return this.prisma.inventoryCountEvent.findMany({
      where: { tenantId, ...(filter.sessionId ? { sessionId: filter.sessionId } : {}), ...(filter.planId ? { planId: filter.planId } : {}) },
      orderBy: { occurredAt: 'asc' },
    });
  }
}
