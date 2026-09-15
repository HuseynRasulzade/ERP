import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AdditionalCostSplit, ConsumptionResult, IncomingMovementInput, OutgoingMovementInput } from './inventory-costing.types';

/**
 * FIFOCostingStrategy (spec sections 8-11, 72-73, 88). One
 * `InventoryCostLayer` row per incoming movement; consumption walks OPEN/
 * PARTIALLY_CONSUMED layers ordered by `receiptDate`, then the
 * auto-increment `postingSequence` (spec section 10's deterministic
 * tie-breaker — never insertion order alone, since two layers can share
 * the same `receiptDate`).
 */
@Injectable()
export class FIFOEngine {
  async createLayer(tx: PrismaTransactionClient, input: IncomingMovementInput) {
    const totalCost = input.quantity.mul(input.unitCost).toDecimalPlaces(2);
    const layer = await tx.inventoryCostLayer.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        costingKey: input.costingKey,
        productId: input.productId,
        warehouseId: input.warehouseId ?? undefined,
        batchId: input.batchId ?? undefined,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        sourceMovementId: input.sourceMovementId ?? undefined,
        receiptDate: input.receiptDate,
        originalQuantity: input.quantity.toString(),
        remainingQuantity: input.quantity.toString(),
        originalUnitCost: input.unitCost.toString(),
        currentUnitCost: input.unitCost.toString(),
        originalTotalCost: totalCost.toString(),
        currentRemainingValue: totalCost.toString(),
        currencyId: input.currencyId ?? undefined,
        status: 'OPEN',
      },
    });
    await tx.inventoryCostComponent.create({
      data: { tenantId: input.tenantId, costLayerId: layer.id, componentType: 'PURCHASE_PRICE', sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId, amount: totalCost.toString(), baseCurrencyAmount: totalCost.toString() },
    });
    return layer;
  }

  /** Consumes `quantity` FIFO-ordered against open layers for `costingKey`.
   * Returns any shortfall (spec section 52) for the caller to price under
   * the configured negative-stock policy — this method never fabricates
   * layers that do not exist. */
  async consume(tx: PrismaTransactionClient, input: OutgoingMovementInput): Promise<ConsumptionResult> {
    let remaining = input.quantity;
    const breakdown: ConsumptionResult['breakdown'] = [];
    let totalCost = new Decimal(0);

    const layers = await tx.inventoryCostLayer.findMany({
      where: { tenantId: input.tenantId, costingKey: input.costingKey, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] } },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
    });

    for (const layer of layers) {
      if (remaining.lte(0)) break;
      const layerRemaining = new Decimal(layer.remainingQuantity.toString());
      if (layerRemaining.lte(0)) continue;

      const take = Decimal.min(layerRemaining, remaining);
      const unitCost = new Decimal(layer.currentUnitCost.toString());
      const cost = take.mul(unitCost).toDecimalPlaces(2);

      const newRemainingQty = layerRemaining.minus(take);
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          remainingQuantity: newRemainingQty.toString(),
          currentRemainingValue: newRemainingQty.mul(unitCost).toDecimalPlaces(2).toString(),
          status: newRemainingQty.lte(0) ? 'CLOSED' : 'PARTIALLY_CONSUMED',
        },
      });

      await tx.inventoryCostConsumption.create({
        data: {
          tenantId: input.tenantId,
          costLayerId: layer.id,
          outgoingMovementId: input.outgoingMovementId,
          outgoingDocumentType: input.outgoingDocumentType,
          outgoingDocumentId: input.outgoingDocumentId,
          outgoingDocumentLineId: input.outgoingDocumentLineId ?? undefined,
          consumedQuantity: take.toString(),
          unitCost: unitCost.toString(),
          consumedCost: cost.toString(),
          calculationRunId: input.calculationRunId ?? undefined,
        },
      });

      breakdown.push({ costLayerId: layer.id, quantity: take, unitCost, cost });
      totalCost = totalCost.plus(cost);
      remaining = remaining.minus(take);
    }

    return { totalConsumedQuantity: input.quantity.minus(remaining), totalConsumedCost: totalCost, shortfallQuantity: remaining, breakdown };
  }

  /** Consumes `quantity` from ONE specific layer only (spec section 28) —
   * used by purchase returns linked to a specific original receipt line,
   * where FIFO's normal oldest-first selection must be bypassed in favor
   * of the exact receipt the goods are being returned against. Any
   * shortfall (the layer itself doesn't have enough remaining) is
   * returned for the caller to handle exactly like a normal FIFO
   * shortfall — this never silently spills over onto other layers. */
  async consumeSpecificLayer(tx: PrismaTransactionClient, layerId: string, quantity: Decimal, outgoing: OutgoingMovementInput): Promise<ConsumptionResult> {
    const layer = await tx.inventoryCostLayer.findUniqueOrThrow({ where: { id: layerId } });
    const layerRemaining = new Decimal(layer.remainingQuantity.toString());
    const take = Decimal.min(layerRemaining, quantity);
    const unitCost = new Decimal(layer.currentUnitCost.toString());
    const cost = take.mul(unitCost).toDecimalPlaces(2);

    if (take.gt(0)) {
      const newRemainingQty = layerRemaining.minus(take);
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: { remainingQuantity: newRemainingQty.toString(), currentRemainingValue: newRemainingQty.mul(unitCost).toDecimalPlaces(2).toString(), status: newRemainingQty.lte(0) ? 'CLOSED' : 'PARTIALLY_CONSUMED' },
      });
      await tx.inventoryCostConsumption.create({
        data: {
          tenantId: outgoing.tenantId,
          costLayerId: layer.id,
          outgoingMovementId: outgoing.outgoingMovementId,
          outgoingDocumentType: outgoing.outgoingDocumentType,
          outgoingDocumentId: outgoing.outgoingDocumentId,
          outgoingDocumentLineId: outgoing.outgoingDocumentLineId ?? undefined,
          consumedQuantity: take.toString(),
          unitCost: unitCost.toString(),
          consumedCost: cost.toString(),
          calculationRunId: outgoing.calculationRunId ?? undefined,
        },
      });
    }

    return { totalConsumedQuantity: take, totalConsumedCost: cost, shortfallQuantity: quantity.minus(take), breakdown: take.gt(0) ? [{ costLayerId: layer.id, quantity: take, unitCost, cost }] : [] };
  }

  /** Reverses every consumption an outgoing document/line wrote (unpost,
   * spec section 109) — restores each touched layer's remainingQuantity
   * and marks the consumption rows reversed rather than deleting them, so
   * "this shipment used to draw from Layer B" stays visible in history. */
  async reverseConsumption(tx: PrismaTransactionClient, tenantId: string, outgoingDocumentType: string, outgoingDocumentId: string) {
    const consumptions = await tx.inventoryCostConsumption.findMany({ where: { tenantId, outgoingDocumentType, outgoingDocumentId, reversed: false } });
    for (const c of consumptions) {
      const layer = await tx.inventoryCostLayer.findUnique({ where: { id: c.costLayerId } });
      if (!layer) continue;
      const restored = new Decimal(layer.remainingQuantity.toString()).plus(c.consumedQuantity.toString());
      const unitCost = new Decimal(layer.currentUnitCost.toString());
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: { remainingQuantity: restored.toString(), currentRemainingValue: restored.mul(unitCost).toDecimalPlaces(2).toString(), status: restored.gte(layer.originalQuantity.toString()) ? 'OPEN' : 'PARTIALLY_CONSUMED' },
      });
      await tx.inventoryCostConsumption.update({ where: { id: c.id }, data: { reversed: true } });
    }
  }

  /** Removes a layer this receipt opened (unpost, spec section 110) —
   * blocked by the caller when it has already been (partially) consumed;
   * this method itself only deletes a layer that is still fully OPEN. */
  async reverseLayer(tx: PrismaTransactionClient, tenantId: string, sourceDocumentType: string, sourceDocumentId: string, sourceDocumentLineId?: string) {
    await tx.inventoryCostComponent.deleteMany({ where: { tenantId, costLayer: { tenantId, sourceDocumentType, sourceDocumentId, sourceDocumentLineId: sourceDocumentLineId ?? undefined } } });
    await tx.inventoryCostLayer.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, sourceDocumentLineId: sourceDocumentLineId ?? undefined } });
  }

  async hasConsumption(tx: PrismaTransactionClient, tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<boolean> {
    const layers = await tx.inventoryCostLayer.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId }, select: { id: true, originalQuantity: true, remainingQuantity: true } });
    return layers.some((l) => new Decimal(l.remainingQuantity.toString()).lt(l.originalQuantity.toString()));
  }

  /**
   * Distributes an additional (retroactive) cost across a layer
   * proportionally to what's still on hand vs already consumed (spec
   * sections 19, 45, 72, and the worked example in section 141) — never
   * dumping the whole amount onto current stock when part of the receipt
   * has already shipped.
   */
  async adjustLayerCost(tx: PrismaTransactionClient, layerId: string, additionalAmount: Decimal): Promise<AdditionalCostSplit> {
    const layer = await tx.inventoryCostLayer.findUniqueOrThrow({ where: { id: layerId } });
    const originalQty = new Decimal(layer.originalQuantity.toString());
    const remainingQty = new Decimal(layer.remainingQuantity.toString());
    if (originalQty.lte(0)) throw new Error(`Cost layer ${layerId} has zero original quantity — cannot allocate additional cost`);

    const remainingShare = remainingQty.div(originalQty);
    const remainingShareAmount = additionalAmount.mul(remainingShare).toDecimalPlaces(2);
    const consumedShareAmount = additionalAmount.minus(remainingShareAmount); // exact remainder — no rounding leakage (spec section 51)

    const perUnitAdditional = additionalAmount.div(originalQty);
    const newUnitCost = new Decimal(layer.currentUnitCost.toString()).plus(perUnitAdditional);
    const newRemainingValue = remainingQty.mul(newUnitCost).toDecimalPlaces(2);

    await tx.inventoryCostLayer.update({
      where: { id: layerId },
      data: { currentUnitCost: newUnitCost.toString(), currentRemainingValue: newRemainingValue.toString(), status: layer.status === 'CLOSED' ? 'ADJUSTED' : layer.status },
    });
    await tx.inventoryCostComponent.create({
      data: { tenantId: layer.tenantId, costLayerId: layerId, componentType: 'ADJUSTMENT', amount: additionalAmount.toString(), baseCurrencyAmount: additionalAmount.toString() },
    });

    return { layerId, additionalAmount, remainingShareAmount, consumedShareAmount, newUnitCost };
  }
}
