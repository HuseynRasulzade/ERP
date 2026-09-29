import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { InventoryCostingService } from './inventory-costing.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface BackfillResult {
  productId: string;
  warehouseId: string | null;
  batchId: string | null;
  received: number;
  consumed: number;
  skippedNoPolicy: number;
  skippedUnsupported: Array<{ movementId: string; movementType: string; reason: string }>;
}

/**
 * Outgoing `InventoryMovement.movementType` values this backfill knows how
 * to cost, mapped to the cost engine's OWN, narrower `movementType`
 * vocabulary each live posting handler actually calls `consumeCost` with.
 * These are two genuinely different vocabularies: `InventoryLedgerService.
 * recordMovement` (Shipment/Purchase Return) remaps the generic 'ISSUE' a
 * handler calls it with into a detailed, source-specific register value
 * (`SALES_SHIPMENT`/`PURCHASE_RETURN`) before it reaches the database,
 * while `ShipmentPostingHandler`/`PurchaseReturnPostingHandler` still call
 * `InventoryCostingService.consumeCost` with the original, generic
 * `'ISSUE'` — this map translates the former (what a raw movement row
 * actually holds) back into the latter (what the cost engine expects), so
 * a backfilled cost movement records the exact same `movementType` the
 * live path would have.
 */
const OUTGOING_COST_MOVEMENT_TYPE: Record<string, string> = {
  SALES_SHIPMENT: 'ISSUE',
  PURCHASE_RETURN: 'ISSUE',
  INTERNAL_CONSUMPTION: 'INTERNAL_CONSUMPTION',
  WRITE_OFF: 'WRITE_OFF',
};

/**
 * InventoryCostBackfillService — closes the "no automated backfill" gap
 * disclosed in docs/INVENTORY_COSTING.md: a movement dated before an
 * organization's first-ever costing policy was ADOPTED IN THE DATABASE
 * never got a cost, even if that policy's own `effectiveFrom` covers the
 * movement's date, because `receiveCost`/`consumeCost` were only ever
 * consulted at the moment each document ORIGINALLY posted — never
 * re-consulted afterward. `InventoryCostRecalculationService` cannot help
 * here either: it only replays `InventoryCostMovement` rows that already
 * exist, and a skipped movement never wrote one.
 *
 * This service replays raw `InventoryMovement` rows instead, in
 * chronological order, calling the exact same `receiveCost`/`consumeCost`
 * entry points every live document posting already uses — so a backfilled
 * receipt opens a real FIFO layer / feeds the weighted-average pool
 * exactly as if the policy had existed at the time, and a backfilled
 * consumption draws from whatever layers exist so far in the SAME replay
 * (additive, never a destructive rebuild — an already-costed movement in
 * the same chronological range is simply skipped, its layer/consumption
 * already stands).
 *
 * Deliberately scoped to what has a well-defined, single-document cost:
 * `GOODS_RECEIPT`-sourced receipts (priced from `GoodsReceiptLine.price`)
 * and single-document consumptions (Shipment/Internal Consumption/
 * Write-off, `ISSUE`/`INTERNAL_CONSUMPTION`/`WRITE_OFF`). Deliberately
 * NOT handled — reported back as `skippedUnsupported`, never silently
 * ignored: Warehouse Transfer (`TRANSFER_OUT`/`TRANSFER_IN` — the
 * destination's cost must equal the source's own outgoing cost from the
 * SAME operation, which a movement-by-movement replay cannot coordinate),
 * Inventory Status Transfer (no value consequence to begin with), and
 * Adjustment SURPLUS/opening balance (no natural per-unit price on the
 * raw movement — fabricating one would violate this module's own
 * "never a guessed cost" rule).
 *
 * Never posts a GL entry — the physical documents this replays are
 * already posted, in already-closed accounting periods in the common
 * case; retroactively injecting a GL consequence into old periods is a
 * separate, harder problem this pass does not attempt. This is subledger-
 * only: it makes `InventoryCostLayer`/`InventoryCostMovement`/valuation
 * reports and FUTURE cost calculations (consuming from a now-backfilled
 * layer) correct, without touching the General Ledger.
 */
@Injectable()
export class InventoryCostBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly costing: InventoryCostingService,
  ) {}

  async backfill(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    params: { productId: string; warehouseId?: string; batchId?: string },
  ): Promise<BackfillResult> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction((tx) => this.backfillTx(tenantId, organizationId, userId, params, tx));
  }

  private async backfillTx(
    tenantId: string,
    organizationId: string,
    userId: string,
    params: { productId: string; warehouseId?: string; batchId?: string },
    tx: PrismaTransactionClient,
  ): Promise<BackfillResult> {
    const movements = await tx.inventoryMovement.findMany({
      where: {
        tenantId,
        organizationId,
        productId: params.productId,
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
        ...(params.batchId ? { batchId: params.batchId } : {}),
      },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    });

    const result: BackfillResult = {
      productId: params.productId,
      warehouseId: params.warehouseId ?? null,
      batchId: params.batchId ?? null,
      received: 0,
      consumed: 0,
      skippedNoPolicy: 0,
      skippedUnsupported: [],
    };

    for (const movement of movements) {
      if (movement.costingStatus !== null) continue; // already costed — its layer/consumption already stands

      const ctx = await this.costing.resolveContext(tenantId, organizationId, movement.productId, movement.warehouseId, movement.batchId, movement.effectiveDate, tx);
      if (!ctx) {
        result.skippedNoPolicy += 1;
        continue;
      }

      const quantity = new Decimal(movement.quantity.toString());
      if (quantity.gt(0)) {
        if (movement.registrarDocumentType !== 'GOODS_RECEIPT' || !movement.registrarLineId) {
          result.skippedUnsupported.push({ movementId: movement.id, movementType: movement.movementType, reason: 'Not a GOODS_RECEIPT-sourced receipt — no well-defined per-unit price to backfill from' });
          continue;
        }
        const receiptLine = await tx.goodsReceiptLine.findFirst({ where: { id: movement.registrarLineId, tenantId } });
        if (!receiptLine) {
          result.skippedUnsupported.push({ movementId: movement.id, movementType: movement.movementType, reason: 'Source GoodsReceiptLine no longer exists' });
          continue;
        }
        await this.costing.receiveCost(
          tenantId,
          {
            organizationId,
            productId: movement.productId,
            warehouseId: movement.warehouseId,
            batchId: movement.batchId,
            quantity,
            unitCost: new Decimal(receiptLine.price.toString()),
            effectiveDate: movement.effectiveDate,
            sourceInventoryMovementId: movement.id,
            sourceDocumentType: movement.registrarDocumentType,
            sourceDocumentId: movement.registrarDocumentId,
            sourceDocumentLineId: movement.registrarLineId,
            // The cost engine's own `movementType` vocabulary for a
            // receipt is always 'RECEIPT' — a different, narrower string
            // than the raw InventoryMovement.movementType this replays
            // (e.g. GoodsReceiptPostingHandler always calls receiveCost
            // with 'RECEIPT', never the register's own 'PURCHASE_RECEIPT').
            movementType: 'RECEIPT',
          },
          tx,
        );
        result.received += 1;
      } else if (quantity.lt(0)) {
        const costMovementType = OUTGOING_COST_MOVEMENT_TYPE[movement.movementType];
        if (!costMovementType) {
          result.skippedUnsupported.push({ movementId: movement.id, movementType: movement.movementType, reason: 'Not a single-document consumption this backfill coordinates (e.g. a transfer leg needs its paired movement)' });
          continue;
        }
        await this.costing.consumeCost(
          tenantId,
          {
            organizationId,
            productId: movement.productId,
            warehouseId: movement.warehouseId,
            batchId: movement.batchId,
            quantity: quantity.abs(),
            effectiveDate: movement.effectiveDate,
            sourceInventoryMovementId: movement.id,
            sourceDocumentType: movement.registrarDocumentType,
            sourceDocumentId: movement.registrarDocumentId,
            sourceDocumentLineId: movement.registrarLineId,
            movementType: costMovementType,
            allowNegativeOverride: true, // Phase 10 already validated physical availability when this originally posted
          },
          tx,
        );
        result.consumed += 1;
      }
    }

    if (result.received === 0 && result.consumed === 0 && result.skippedNoPolicy === 0 && result.skippedUnsupported.length === 0) {
      throw new ValidationAppError('No uncosted movements found for this product/warehouse/batch — nothing to backfill');
    }

    await this.audit.record(
      {
        tenantId,
        eventType: 'INVENTORY_COST_BACKFILLED',
        entityType: 'InventoryMovement',
        entityId: params.productId,
        action: 'UPDATE',
        userId,
        newValues: { productId: params.productId, warehouseId: params.warehouseId, batchId: params.batchId, received: result.received, consumed: result.consumed, skippedNoPolicy: result.skippedNoPolicy, skippedUnsupportedCount: result.skippedUnsupported.length },
      },
      tx,
    );

    return result;
  }
}
