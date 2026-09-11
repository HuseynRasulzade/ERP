import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NegativeStockBlockedError } from '../common/errors/app-error';
import { PHYSICAL_STOCK_STATUSES } from './inventory-movement.service';
import { PURCHASE_ORDER_TYPE } from '../procurement/purchase-order.repository';
import { RelationTypes } from '../purchase-execution/purchase-fulfillment.service';

export interface StockSnapshot {
  physical: string;
  reserved: string;
  available: string;
  expected: string;
  inTransit: string;
  blocked: string;
  projected: string;
}

/**
 * StockAvailabilityService — the ONLY place in the platform that answers
 * "how much stock is there" (spec section 34: "Bütün modullar bu
 * service-dən istifadə etməlidir"). Every number is computed live from
 * `InventoryMovement` (physical/in-transit/blocked) and the existing
 * `StockReservation` register (reserved) — never a cached field. Formulas
 * match spec section 35 exactly:
 *   Physical  = Σ movements where stockStatus is a physical status
 *   Reserved  = Σ active StockReservation.quantity
 *   Available = Σ movements where stockStatus = AVAILABLE − Reserved
 *   Blocked   = Σ movements where stockStatus = BLOCKED
 *   Expected  = confirmed Supplier Order qty − received − cancelled
 *   InTransit = Σ movements where stockStatus = IN_TRANSIT
 *   Projected = Available + Expected + InTransit
 *
 * Every method accepts an optional `tx` — a posting handler validating
 * availability against writes it (or an earlier step of the same
 * transaction) already made needs to see them; a plain read elsewhere
 * omits it and reads the shared pool as usual.
 */
@Injectable()
export class StockAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getPhysicalStock(tenantId: string, warehouseId: string, productId: string, opts: { batchId?: string; asOfDate?: Date; stockStatus?: string } = {}, tx?: PrismaTransactionClient): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const agg = await db.inventoryMovement.aggregate({
      where: {
        tenantId,
        warehouseId,
        productId,
        stockStatus: opts.stockStatus ? opts.stockStatus : { in: PHYSICAL_STOCK_STATUSES },
        ...(opts.batchId ? { batchId: opts.batchId } : {}),
        ...(opts.asOfDate ? { effectiveDate: { lte: opts.asOfDate } } : {}),
      },
      _sum: { quantity: true },
    });
    return new Decimal((agg._sum.quantity ?? 0).toString());
  }

  async getReservedStock(tenantId: string, warehouseId: string, productId: string, opts: { batchId?: string } = {}, tx?: PrismaTransactionClient): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const agg = await db.stockReservation.aggregate({
      where: { tenantId, warehouseId, productId, status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] }, ...(opts.batchId ? { batchId: opts.batchId } : {}) },
      _sum: { quantity: true },
    });
    return new Decimal((agg._sum.quantity ?? 0).toString());
  }

  async getBlockedStock(tenantId: string, warehouseId: string, productId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    return this.getPhysicalStock(tenantId, warehouseId, productId, { stockStatus: 'BLOCKED' }, tx);
  }

  async getAvailableStock(tenantId: string, warehouseId: string, productId: string, opts: { batchId?: string } = {}, tx?: PrismaTransactionClient): Promise<Decimal> {
    const [physicalAvailable, reserved] = await Promise.all([
      this.getPhysicalStock(tenantId, warehouseId, productId, { ...opts, stockStatus: 'AVAILABLE' }, tx),
      this.getReservedStock(tenantId, warehouseId, productId, opts, tx),
    ]);
    return physicalAvailable.minus(reserved);
  }

  async getInTransitStock(tenantId: string, warehouseId: string, productId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    return this.getPhysicalStock(tenantId, warehouseId, productId, { stockStatus: 'IN_TRANSIT' }, tx);
  }

  /** Confirmed Supplier Order qty − received − cancelled, aggregated for
   * one product/warehouse (spec section 9) — the same live computation
   * `ExpectedStockService` (Phase 8/9) already does per purchase order
   * line; this is the product/warehouse-level rollup other modules read. */
  async getExpectedStock(tenantId: string, warehouseId: string, productId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const lines = await db.purchaseOrderLine.findMany({
      where: { tenantId, productId, isService: false, purchaseOrder: { postingStatus: 'POSTED', status: { not: 'CANCELLED' } } },
      include: { purchaseOrder: true },
    });
    let total = new Decimal(0);
    for (const line of lines) {
      const lineWarehouseId = line.warehouseId ?? line.purchaseOrder.warehouseId;
      if (lineWarehouseId !== warehouseId) continue;
      const remaining = new Decimal(line.quantity.toString()).minus(line.cancelledQuantity.toString());
      if (remaining.lte(0)) continue;
      const received = await db.documentLineLink.aggregate({
        where: { tenantId, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceLineId: line.id, relationType: RelationTypes.SUPPLIER_ORDER_TO_RECEIPT },
        _sum: { quantity: true },
      });
      total = total.plus(remaining.minus(new Decimal((received._sum.quantity ?? 0).toString())));
    }
    return total;
  }

  async getProjectedStock(tenantId: string, warehouseId: string, productId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const [available, expected, inTransit] = await Promise.all([
      this.getAvailableStock(tenantId, warehouseId, productId, {}, tx),
      this.getExpectedStock(tenantId, warehouseId, productId, tx),
      this.getInTransitStock(tenantId, warehouseId, productId, tx),
    ]);
    return available.plus(expected).plus(inTransit);
  }

  async getSnapshot(tenantId: string, warehouseId: string, productId: string): Promise<StockSnapshot> {
    const [physical, reserved, available, expected, inTransit, blocked] = await Promise.all([
      this.getPhysicalStock(tenantId, warehouseId, productId),
      this.getReservedStock(tenantId, warehouseId, productId),
      this.getAvailableStock(tenantId, warehouseId, productId),
      this.getExpectedStock(tenantId, warehouseId, productId),
      this.getInTransitStock(tenantId, warehouseId, productId),
      this.getBlockedStock(tenantId, warehouseId, productId),
    ]);
    const projected = available.plus(expected).plus(inTransit);
    return { physical: physical.toString(), reserved: reserved.toString(), available: available.toString(), expected: expected.toString(), inTransit: inTransit.toString(), blocked: blocked.toString(), projected: projected.toString() };
  }

  async getStockByBatch(tenantId: string, batchId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const agg = await db.inventoryMovement.aggregate({
      where: { tenantId, batchId, stockStatus: { in: PHYSICAL_STOCK_STATUSES } },
      _sum: { quantity: true },
    });
    return new Decimal((agg._sum.quantity ?? 0).toString());
  }

  async getStockBySerial(tenantId: string, serialId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const agg = await db.inventoryMovement.aggregate({
      where: { tenantId, serialId, stockStatus: { in: PHYSICAL_STOCK_STATUSES } },
      _sum: { quantity: true },
    });
    return new Decimal((agg._sum.quantity ?? 0).toString());
  }

  /**
   * Server-side re-check (spec sections 22, 28, 70-71) — NEVER trust a
   * UI-computed remaining. Caller must have already acquired the stock
   * lock (`InventoryMovementService.lockStockKey`) inside the same
   * transaction before calling this, so the check and the movement
   * insert that follows it are race-free.
   */
  async validateAvailability(tenantId: string, warehouseId: string, warehouseCode: string, productId: string, productCode: string, requestedQty: Decimal, allowNegativeStock: boolean, opts: { batchId?: string } = {}, tx?: PrismaTransactionClient): Promise<void> {
    if (allowNegativeStock) return;
    const available = await this.getAvailableStock(tenantId, warehouseId, productId, opts, tx);
    if (requestedQty.gt(available)) {
      throw new NegativeStockBlockedError(warehouseCode, productCode, available.toFixed(6), requestedQty.toFixed(6));
    }
  }
}
