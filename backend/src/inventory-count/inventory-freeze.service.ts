import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CountWarehouseLockedError } from '../common/errors/app-error';

const ACTIVE_FREEZE_STATUSES = ['SNAPSHOT_CREATED', 'COUNTING', 'RECOUNT_REQUIRED', 'UNDER_REVIEW', 'PENDING_APPROVAL'];

interface ScopeRow {
  includeExclude: string;
  warehouseId: string | null;
  locationId: string | null;
}

/**
 * InventoryFreezeService (spec sections 11-14) — the movement-control half
 * of the count engine. `HARD_FREEZE` actually blocks stock-affecting
 * postings inside the frozen scope (spec section 12's own exact error
 * wording: "Warehouse/location is locked for inventory count session
 * IC-2026-001"); `SOFT_FREEZE` lets them through but records an audit
 * warning; `NO_FREEZE_WITH_MOVEMENT_TRACKING` (the default) never blocks
 * anything — `InventoryVarianceService` accounts for post-snapshot
 * movements arithmetically instead (spec section 14).
 *
 * The count session's OWN corrective postings (a real `InventoryAdjustment`/
 * `WarehouseTransfer`/`InventoryStatusTransfer` document created by
 * `InventoryCountAdjustmentService` and already linked via
 * `InventoryCountAdjustmentLink` before it is posted) are always exempt —
 * otherwise a HARD_FREEZE could never be lifted by the very posting that
 * is supposed to end it. Freeze operates at warehouse/location
 * granularity (not per-product), matching the spec's own error message.
 */
@Injectable()
export class InventoryFreezeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assertNotFrozen(
    tenantId: string,
    warehouseId: string,
    locationId: string | null | undefined,
    documentType: string,
    documentId: string,
    userId: string | undefined,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const ownCorrection = await tx.inventoryCountAdjustmentLink.findFirst({ where: { tenantId, adjustmentDocumentType: documentType, adjustmentDocumentId: documentId } });
    if (ownCorrection) return;

    const activeSessions = await tx.inventoryCountSession.findMany({
      where: { tenantId, status: { in: ACTIVE_FREEZE_STATUSES }, freezePolicy: { in: ['HARD_FREEZE', 'SOFT_FREEZE'] } },
      include: { plan: { include: { scopes: true } } },
    });

    for (const session of activeSessions) {
      if (!this.scopeCovers(session.plan.scopes, warehouseId, locationId ?? null)) continue;

      if (session.freezePolicy === 'HARD_FREEZE') {
        const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId } });
        throw new CountWarehouseLockedError(warehouse?.code ?? warehouseId, session.sessionNumber ?? session.id);
      }

      // SOFT_FREEZE: allowed through, but audited (spec section 13).
      await this.audit.record(
        {
          tenantId,
          eventType: 'INVENTORY_COUNT_SOFT_FREEZE_OVERRIDE',
          entityType: documentType,
          entityId: documentId,
          action: 'CREATE',
          userId: userId ?? 'system',
          newValues: { sessionId: session.id, warehouseId, locationId },
        },
        tx,
      );
    }
  }

  private scopeCovers(scopes: ScopeRow[], warehouseId: string, locationId: string | null): boolean {
    if (scopes.length === 0) return false;
    const matches = (s: ScopeRow) => (!s.warehouseId || s.warehouseId === warehouseId) && (!s.locationId || s.locationId === locationId);
    const included = scopes.filter((s) => s.includeExclude === 'INCLUDE').some(matches);
    const excluded = scopes.filter((s) => s.includeExclude === 'EXCLUDE').some(matches);
    return included && !excluded;
  }
}
