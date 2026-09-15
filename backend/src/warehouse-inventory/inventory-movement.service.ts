import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { assertNotFrozenForMovement } from '../inventory-count/inventory-freeze.guard';

/** Physical stock statuses (spec section 6-7) — everything actually
 * sitting in a warehouse, whatever its quality state. IN_TRANSIT is
 * deliberately excluded: it is a placeholder at the destination
 * warehouse for stock that has left the source but has not yet been
 * received (spec section 10) — not physically available there. */
export const PHYSICAL_STOCK_STATUSES = ['AVAILABLE', 'QUARANTINE', 'QUALITY_CONTROL', 'REJECTED', 'DAMAGED', 'BLOCKED', 'EXPIRED'];

export interface RecordMovementInput {
  organizationId: string;
  warehouseId: string;
  locationId?: string | null;
  productId: string;
  unitId: string;
  batchId?: string | null;
  serialId?: string | null;
  ownershipType?: string;
  ownerCounterpartyId?: string | null;
  stockStatus?: string;
  movementType: string;
  quantity: Decimal.Value; // signed: positive = IN, negative = OUT
  baseQuantity?: Decimal.Value; // defaults to quantity when the line's own unit already is the base unit
  effectiveDate: Date;
  registrarDocumentType: string;
  registrarDocumentId: string;
  registrarLineId?: string | null;
  provisionalCost?: Decimal.Value | null;
  createdBy?: string;
}

/**
 * InventoryMovementService — the writer half of the Stock Truth Engine
 * (spec sections 3-4, 55). Every write to `InventoryMovement` goes
 * through here; nothing else in this codebase is allowed to insert a row
 * directly (spec section 55: "Direct public API ilə arbitrary movement
 * yaratmaq default olaraq qadağan olsun"). Movements are immutable —
 * `deleteMovementsFor` (called from a posting handler's `undoSideEffects`
 * on unpost) is the only removal path, mirroring the same delete-on-
 * unpost convention every other register in this codebase already uses
 * (never a resurrected "reversal" row — see docs/WAREHOUSE_INVENTORY.md).
 */
@Injectable()
export class InventoryMovementService {
  /**
   * Postgres session-scoped advisory lock keyed to
   * (tenant, warehouse, product[, batch]) — serializes concurrent posts
   * against the SAME stock key inside one transaction (spec section 71).
   * Held until the surrounding transaction commits or rolls back
   * (`pg_advisory_xact_lock`), so two concurrent shipments against the
   * same product/warehouse can never both pass the availability check
   * before either commits.
   */
  async lockStockKey(tx: PrismaTransactionClient, tenantId: string, warehouseId: string, productId: string, batchId?: string | null): Promise<void> {
    const key = `${tenantId}:${warehouseId}:${productId}:${batchId ?? ''}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  async recordMovement(tenantId: string, input: RecordMovementInput, tx: PrismaTransactionClient) {
    // Phase 12 hard-freeze check (spec section 12) — the single choke
    // point every stock-affecting movement in the platform passes
    // through, so every document type gets this for free with no
    // per-handler wiring (see inventory-count/inventory-freeze.guard.ts
    // for why this is a plain function call, not an injected service).
    await assertNotFrozenForMovement(tx, tenantId, { organizationId: input.organizationId, warehouseId: input.warehouseId, locationId: input.locationId, productId: input.productId, batchId: input.batchId });

    return tx.inventoryMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        locationId: input.locationId ?? undefined,
        productId: input.productId,
        unitId: input.unitId,
        batchId: input.batchId ?? undefined,
        serialId: input.serialId ?? undefined,
        ownershipType: input.ownershipType ?? 'OWN',
        ownerCounterpartyId: input.ownerCounterpartyId ?? undefined,
        stockStatus: input.stockStatus ?? 'AVAILABLE',
        movementType: input.movementType,
        quantity: new Decimal(input.quantity).toString(),
        baseQuantity: new Decimal(input.baseQuantity ?? input.quantity).toString(),
        effectiveDate: input.effectiveDate,
        registrarDocumentType: input.registrarDocumentType,
        registrarDocumentId: input.registrarDocumentId,
        registrarLineId: input.registrarLineId ?? undefined,
        provisionalCost: input.provisionalCost != null ? new Decimal(input.provisionalCost).toString() : undefined,
        createdBy: input.createdBy,
      },
    });
  }

  /** Every movement a document posted, removed atomically — called from
   * `undoSideEffects` on unpost. Immutable rows are never edited, only
   * deleted-and-recreated on repost, same as every other register in
   * this codebase (RegisterMovement's own convention). */
  async deleteMovementsFor(tenantId: string, registrarDocumentType: string, registrarDocumentId: string, tx: PrismaTransactionClient) {
    return tx.inventoryMovement.deleteMany({ where: { tenantId, registrarDocumentType, registrarDocumentId } });
  }
}
