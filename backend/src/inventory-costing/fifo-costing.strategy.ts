import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { IncomingCostContext, InventoryCostingStrategy, OutgoingCostContext, OutgoingCostResult } from './inventory-costing.types';

/**
 * FIFOCostingStrategy (spec sections 8-11). Every incoming movement opens
 * a cost layer; outgoing movements consume the oldest OPEN/PARTIALLY_
 * CONSUMED layer first, ordered by receiptDate then the DB-assigned
 * postingSequence tie-breaker (spec section 10 — never wall-clock time,
 * never iteration-order-dependent). Consumption is recorded per layer in
 * InventoryCostConsumption so a shipment's cost is traceable back to the
 * exact receipts it drew from (spec section 11).
 */
@Injectable()
export class FIFOCostingStrategy implements InventoryCostingStrategy {
  async processIncomingMovement(ctx: IncomingCostContext, tx: PrismaTransactionClient): Promise<void> {
    const totalCost = ctx.quantity.mul(ctx.unitCost);
    await tx.inventoryCostLayer.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        costingKey: ctx.costingKey,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId ?? undefined,
        batchId: ctx.batchId ?? undefined,
        sourceReceiptDocumentType: ctx.sourceDocumentType,
        sourceReceiptDocumentId: ctx.sourceDocumentId,
        sourceReceiptLineId: ctx.sourceDocumentLineId ?? '',
        sourceInventoryMovementId: ctx.inventoryMovementId,
        receiptDate: ctx.effectiveDate,
        originalQuantity: ctx.quantity.toString(),
        remainingQuantity: ctx.quantity.toString(),
        originalUnitCost: ctx.unitCost.toString(),
        currentUnitCost: ctx.unitCost.toString(),
        originalTotalCost: totalCost.toString(),
        currentRemainingValue: totalCost.toString(),
        currencyId: ctx.currencyId,
        status: 'OPEN',
      },
    });
  }

  async calculateOutgoingCost(ctx: OutgoingCostContext, tx: PrismaTransactionClient): Promise<OutgoingCostResult | null> {
    const layers = await tx.inventoryCostLayer.findMany({
      where: { tenantId: ctx.tenantId, costingKey: ctx.costingKey, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] } },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
    });

    let remaining = ctx.quantity;
    let totalCost = new Decimal(0);
    let costStatus: 'FINAL' | 'PROVISIONAL' = 'FINAL';
    let lastKnownUnitCost: Decimal | null = null;

    for (const layer of layers) {
      if (remaining.lte(0)) break;
      const layerRemaining = new Decimal(layer.remainingQuantity.toString());
      if (layerRemaining.lte(0)) continue;
      const layerUnitCost = new Decimal(layer.currentUnitCost.toString());
      lastKnownUnitCost = layerUnitCost;

      const consumeQty = Decimal.min(remaining, layerRemaining);
      const consumeCost = consumeQty.mul(layerUnitCost);

      await tx.inventoryCostConsumption.create({
        data: {
          tenantId: ctx.tenantId,
          outgoingInventoryMovementId: ctx.inventoryMovementId,
          outgoingDocumentType: ctx.sourceDocumentType,
          outgoingDocumentId: ctx.sourceDocumentId,
          outgoingDocumentLineId: ctx.sourceDocumentLineId ?? undefined,
          costLayerId: layer.id,
          consumedQuantity: consumeQty.toString(),
          unitCost: layerUnitCost.toString(),
          consumedCost: consumeCost.toString(),
        },
      });

      const newLayerRemaining = layerRemaining.minus(consumeQty);
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          remainingQuantity: newLayerRemaining.toString(),
          currentRemainingValue: newLayerRemaining.mul(layerUnitCost).toString(),
          status: newLayerRemaining.lte(0) ? 'CLOSED' : 'PARTIALLY_CONSUMED',
        },
      });

      totalCost = totalCost.plus(consumeCost);
      remaining = remaining.minus(consumeQty);
    }

    if (remaining.gt(0)) {
      // Spec section 52-54: no eligible layer for the shortfall (negative
      // stock or first-ever issue). Fall back to the last known layer
      // cost as a PROVISIONAL cost rather than fabricating COGS from
      // nothing; a later receipt corrects it via recalculation (not yet
      // implemented in this core build — flagged as a known follow-up).
      if (lastKnownUnitCost) {
        totalCost = totalCost.plus(remaining.mul(lastKnownUnitCost));
        costStatus = 'PROVISIONAL';
      } else {
        // No layers ever existed for this costing key — preserve the
        // pre-engine "skip, don't fabricate" contract.
        if (totalCost.eq(0)) return null;
        costStatus = 'PROVISIONAL';
      }
    }

    if (ctx.quantity.eq(0)) return null;
    const unitCost = totalCost.div(ctx.quantity);
    return { unitCost, totalCost, costStatus };
  }
}
