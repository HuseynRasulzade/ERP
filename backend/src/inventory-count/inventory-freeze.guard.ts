import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * Freeze guard (Phase 12 spec sections 11-13) — a plain, DI-free function
 * (not an injectable service) so `InventoryMovementService.recordMovement`
 * (Phase 10, `warehouse-inventory` module) can call it as the SINGLE choke
 * point every stock-affecting movement in the platform already passes
 * through, without `warehouse-inventory` needing to import the
 * `inventory-count` module (which itself imports `warehouse-inventory` for
 * `InventoryMovementService`/`StockAvailabilityService` — a real NestJS
 * module cycle a plain function import sidesteps entirely).
 *
 * Only `HARD_FREEZE` blocks here (spec section 12); `SOFT_FREEZE` and
 * `NO_FREEZE_WITH_MOVEMENT_TRACKING` movements always proceed —
 * `InventoryVarianceService` is what accounts for them afterward (spec
 * sections 13-14).
 */
export async function assertNotFrozenForMovement(
  tx: PrismaTransactionClient,
  tenantId: string,
  params: { organizationId: string; warehouseId: string; locationId?: string | null; productId: string; batchId?: string | null },
): Promise<void> {
  const activeSessions = await tx.inventoryCountSession.findMany({
    where: {
      tenantId,
      organizationId: params.organizationId,
      freezePolicy: 'HARD_FREEZE',
      status: { in: ['SNAPSHOT_CREATED', 'COUNTING', 'RECOUNT_REQUIRED', 'UNDER_REVIEW', 'PENDING_APPROVAL'] },
    },
    select: { id: true, sessionNumber: true, planId: true },
  });
  if (activeSessions.length === 0) return;

  for (const session of activeSessions) {
    const scopes = await tx.inventoryCountScope.findMany({ where: { tenantId, planId: session.planId } });
    if (scopeCovers(scopes, params)) {
      throw new ValidationAppError(`Warehouse/location is locked for inventory count session ${session.sessionNumber ?? session.id}.`);
    }
  }
}

function scopeCovers(scopes: { warehouseId: string | null; locationId: string | null; productId: string | null; batchId: string | null; rule: string }[], params: { warehouseId: string; locationId?: string | null; productId: string; batchId?: string | null }): boolean {
  if (scopes.length === 0) return true; // no scope rows recorded — treat the whole organization as in scope

  const includes = scopes.filter((s) => s.rule !== 'EXCLUDE');
  const excludes = scopes.filter((s) => s.rule === 'EXCLUDE');

  const matches = (s: { warehouseId: string | null; locationId: string | null; productId: string | null; batchId: string | null }) =>
    (s.warehouseId == null || s.warehouseId === params.warehouseId) &&
    (s.locationId == null || s.locationId === params.locationId) &&
    (s.productId == null || s.productId === params.productId) &&
    (s.batchId == null || s.batchId === params.batchId);

  if (excludes.some(matches)) return false;
  if (includes.length === 0) return false; // only EXCLUDE rows defined, nothing explicitly included
  return includes.some(matches);
}
