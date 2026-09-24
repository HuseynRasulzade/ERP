import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';

/**
 * CostingService (spec sections 36-38, 115). `getCostForShipmentLine` is
 * now the preferred path: it reads the real cost the Phase 11 Inventory
 * Costing Engine computed for that exact shipment line's outgoing
 * movement (FIFO consumption or Weighted Average — see
 * inventory-costing/inventory-cost-calculation.service.ts), keyed by
 * `sourceDocumentType/sourceDocumentId/sourceDocumentLineId`, so it never
 * has to guess which of several same-day shipments a cost belongs to.
 *
 * `getUnitCost` is the pre-Phase-11 fallback for movements the costing
 * engine never processed (posted before this module existed) — a naive
 * weighted-average of receipt-time unit price (GoodsReceiptLine.price)
 * across every RECEIPT movement for this product/warehouse on or before
 * `businessDate`. Returns `null` — never a fabricated cost — when no data
 * exists; every caller treats `null` as "skip the COGS posting entirely
 * for this line".
 */
@Injectable()
export class CostingService {
  /** Preferred lookup (spec sections 24, 26): the exact cost the costing
   * engine assigned to a specific outgoing movement, traced by document
   * type/id/line rather than re-derived from an average. */
  async getCostForShipmentLine(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, sourceDocumentLineId: string, tx: PrismaTransactionClient): Promise<Decimal | null> {
    const movement = await tx.inventoryCostMovement.findFirst({
      where: { tenantId, sourceDocumentType, sourceDocumentId, sourceDocumentLineId, movementType: 'ISSUE' },
    });
    return movement ? new Decimal(movement.unitCost.toString()) : null;
  }

  async getUnitCost(
    tenantId: string,
    _organizationId: string,
    productId: string,
    warehouseId: string,
    businessDate: Date,
    tx: PrismaTransactionClient,
  ): Promise<Decimal | null> {
    const receipts = await tx.inventoryMovement.findMany({
      where: {
        tenantId,
        productId,
        warehouseId,
        registrarDocumentType: 'GOODS_RECEIPT',
        quantity: { gt: 0 },
        effectiveDate: { lte: businessDate },
      },
    });
    if (receipts.length === 0) return null;

    const lineIds = receipts.map((r) => r.registrarLineId).filter((id): id is string => !!id);
    if (lineIds.length === 0) return null;
    const lines = await tx.goodsReceiptLine.findMany({ where: { id: { in: lineIds }, tenantId } });
    const priceByLineId = new Map(lines.map((l) => [l.id, new Decimal(l.price.toString())]));

    let totalQty = new Decimal(0);
    let totalCost = new Decimal(0);
    for (const receipt of receipts) {
      const price = receipt.registrarLineId ? priceByLineId.get(receipt.registrarLineId) : undefined;
      if (!price) continue; // this receipt line's price is unknown — don't let it skew the average
      const qty = new Decimal(receipt.quantity.toString());
      totalQty = totalQty.plus(qty);
      totalCost = totalCost.plus(qty.mul(price));
    }
    if (totalQty.lte(0)) return null;
    return totalCost.div(totalQty);
  }
}
