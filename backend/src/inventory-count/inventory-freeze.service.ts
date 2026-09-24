import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { InventoryMovementGuard, RecordMovementInput } from '../warehouse-inventory/inventory-movement.service';
import { INVENTORY_COUNT_ADJUSTMENT_TYPE } from './inventory-count.constants';
import { CountLockConflictError, CountLockedError } from './inventory-count.errors';
import { ResolvedScope } from './inventory-count-scope.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';

/**
 * InventoryFreezeService (spec sections 11-14, 59, 64).
 *
 * Activating a freeze writes `InventoryCountFreezeLock` rows for the
 * session's resolved scope (warehouse × optional location × optional
 * product). The same service is registered as an `InventoryMovementGuard`
 * on Phase 10's single movement writer, so EVERY stock-affecting posting
 * (receipt, shipment, transfer, write-off, consumption, status transfer,
 * adjustment, returns — and their unposts) is checked inside its own
 * transaction:
 *   HARD_FREEZE — the write is rejected ("Warehouse/location is locked for
 *                 inventory count session …"); the posting rolls back, no
 *                 movement is generated.
 *   SOFT_FREEZE — the write proceeds but is audited with the count session
 *                 linkage (INVENTORY_COUNT_FREEZE_OVERRIDDEN); the
 *                 reconciliation engine picks it up as a post-snapshot
 *                 movement.
 *   NO_FREEZE   — no lock rows at all; post-snapshot movements are found by
 *                 the reconciliation query.
 * The session's own count-adjustment documents are exempt from its locks.
 * Stock outside the locked slice is never affected (scope isolation).
 */
@Injectable()
export class InventoryFreezeService implements InventoryMovementGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async activate(tenantId: string, session: { id: string; sessionNumber: string; planId: string }, policy: string, scope: ResolvedScope, userId: string, tx: PrismaTransactionClient) {
    const slices: { warehouseId: string; locationId: string | null; productId: string | null }[] = [];
    const locations = scope.locationInclude ? Array.from(scope.locationInclude) : [null];
    const products = scope.productInclude && scope.productInclude.size <= 200 ? Array.from(scope.productInclude) : [null];
    const locWarehouse = new Map<string, string>();
    if (scope.locationInclude) {
      const locs = await tx.warehouseLocation.findMany({ where: { id: { in: Array.from(scope.locationInclude) } }, select: { id: true, warehouseId: true } });
      locs.forEach((l) => locWarehouse.set(l.id, l.warehouseId));
    }
    for (const warehouseId of scope.warehouseIds) {
      for (const locationId of locations) {
        if (locationId && locWarehouse.get(locationId) !== warehouseId) continue;
        for (const productId of products) slices.push({ warehouseId, locationId, productId });
      }
    }

    // Overlap check against other sessions' active HARD freezes.
    for (const s of slices) {
      const clash = await tx.inventoryCountFreezeLock.findFirst({
        where: {
          tenantId,
          active: true,
          policy: 'HARD_FREEZE',
          warehouseId: s.warehouseId,
          sessionId: { not: session.id },
          ...(s.locationId ? { OR: [{ locationId: null }, { locationId: s.locationId }] } : {}),
          ...(s.productId ? { AND: [{ OR: [{ productId: null }, { productId: s.productId }] }] } : {}),
        },
        include: { session: { select: { sessionNumber: true } } },
      });
      if (clash) throw new CountLockConflictError(await this.describe(tx, s.warehouseId, s.locationId), clash.session.sessionNumber);
    }

    await tx.inventoryCountFreezeLock.createMany({ data: slices.map((s) => ({ tenantId, sessionId: session.id, ...s, policy, activatedBy: userId })) });
    await this.events.emit(tenantId, InventoryCountEvents.FREEZE_ACTIVATED, { sessionId: session.id, planId: session.planId }, { policy, lockCount: slices.length }, tx);
    return slices.length;
  }

  async release(tenantId: string, sessionId: string, userId: string, tx: PrismaTransactionClient) {
    const res = await tx.inventoryCountFreezeLock.updateMany({ where: { tenantId, sessionId, active: true }, data: { active: false, releasedAt: new Date(), releasedBy: userId } });
    return res.count;
  }

  async beforeRecord(tenantId: string, input: RecordMovementInput, tx: PrismaTransactionClient): Promise<void> {
    await this.check(tenantId, [{ warehouseId: input.warehouseId, locationId: input.locationId ?? null, productId: input.productId }], input.registrarDocumentType, input.registrarDocumentId, tx, input);
  }

  async beforeDelete(tenantId: string, registrarDocumentType: string, registrarDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const anyLock = await tx.inventoryCountFreezeLock.findFirst({ where: { tenantId, active: true }, select: { id: true } });
    if (!anyLock) return;
    const rows = await tx.inventoryMovement.findMany({
      where: { tenantId, registrarDocumentType, registrarDocumentId },
      select: { warehouseId: true, locationId: true, productId: true },
    });
    await this.check(tenantId, rows, registrarDocumentType, registrarDocumentId, tx);
  }

  private async check(
    tenantId: string,
    rows: { warehouseId: string; locationId: string | null; productId: string }[],
    registrarDocumentType: string,
    registrarDocumentId: string,
    tx: PrismaTransactionClient,
    input?: RecordMovementInput,
  ) {
    if (rows.length === 0) return;
    const warehouseIds = Array.from(new Set(rows.map((r) => r.warehouseId)));
    const locks = await tx.inventoryCountFreezeLock.findMany({
      where: { tenantId, active: true, warehouseId: { in: warehouseIds } },
      include: { session: { select: { id: true, sessionNumber: true, planId: true } } },
    });
    if (locks.length === 0) return;

    let ownSessionId: string | null = null;
    if (registrarDocumentType === INVENTORY_COUNT_ADJUSTMENT_TYPE) {
      const doc = await tx.inventoryCountAdjustment.findFirst({ where: { id: registrarDocumentId, tenantId }, select: { sessionId: true } });
      ownSessionId = doc?.sessionId ?? null;
    }

    for (const row of rows) {
      for (const lock of locks) {
        if (lock.sessionId === ownSessionId) continue;
        if (lock.warehouseId !== row.warehouseId) continue;
        if (lock.locationId && lock.locationId !== row.locationId) continue;
        if (lock.productId && lock.productId !== row.productId) continue;
        if (lock.policy === 'HARD_FREEZE') {
          throw new CountLockedError(await this.describe(tx, row.warehouseId, lock.locationId), lock.session.sessionNumber);
        }
        // SOFT_FREEZE: allowed, but audited with count-session linkage.
        await this.events.audit(
          tenantId,
          {
            eventType: 'INVENTORY_COUNT_FREEZE_OVERRIDDEN',
            entityType: 'INVENTORY_COUNT_SESSION',
            entityId: lock.sessionId,
            action: 'SOFT_FREEZE_MOVEMENT',
            userId: this.requestContext.getUser()?.userId ?? null,
            newValues: {
              sessionNumber: lock.session.sessionNumber,
              registrarDocumentType,
              registrarDocumentId,
              warehouseId: row.warehouseId,
              locationId: row.locationId,
              productId: row.productId,
              quantity: input ? String(input.quantity) : undefined,
              movementType: input?.movementType,
            },
          },
          tx,
        );
        break;
      }
    }
  }

  private async describe(tx: PrismaTransactionClient, warehouseId: string, locationId: string | null): Promise<string> {
    if (locationId) {
      const loc = await tx.warehouseLocation.findFirst({ where: { id: locationId }, select: { code: true } });
      return `Location ${loc?.code ?? locationId}`;
    }
    const wh = await tx.warehouse.findFirst({ where: { id: warehouseId }, select: { code: true } });
    return `Warehouse ${wh?.code ?? warehouseId}`;
  }
}
