import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ConsumptionResult, IncomingMovementInput, OutgoingMovementInput } from './inventory-costing.types';

const WAC_BUCKET_TYPE = 'WAC_BUCKET';

/**
 * WeightedAverageCostingStrategy — MOVING_AVERAGE mode (spec sections
 * 12-14, 88): the running average is recomputed after every incoming
 * movement. One continuously-updated `InventoryCostLayer` row per
 * `costingKey` (`sourceDocumentType = 'WAC_BUCKET'`) stands in for what
 * FIFO models as many discrete layers — there is exactly one "layer" to
 * consume from, so no ordering concept applies.
 *
 * PERIODIC_WEIGHTED_AVERAGE (spec section 13) is NOT computed live here —
 * shipments during an open period are costed provisionally at this same
 * moving average, and `CostingPeriodService.finalize` re-derives the true
 * period average (opening + period receipts, divided by opening + period
 * quantity) and adjusts the difference across the period's outgoing
 * movements, per spec section 14's month-close description.
 *
 * Disclosed simplification vs FIFO: an additional (retroactive) cost
 * applied to a WAC bucket via `applyAdditionalCost` is folded into the
 * pool's current average PROSPECTIVELY only (spec section 43's "reduce
 * inventory cost" treatment) — WAC does not preserve which units of the
 * pool came from which receipt, so there is no way to retroactively
 * identify "the portion of THIS additional cost that was already sold"
 * the way a FIFO layer's own `remainingQuantity` can. Full period-average
 * revaluation (which does implicitly correct this) happens at finalize.
 */
@Injectable()
export class WeightedAverageEngine {
  async getOrCreateBucket(tx: PrismaTransactionClient, tenantId: string, organizationId: string, costingKey: string, productId: string, warehouseId?: string | null) {
    const existing = await tx.inventoryCostLayer.findFirst({ where: { tenantId, costingKey, sourceDocumentType: WAC_BUCKET_TYPE } });
    if (existing) return existing;
    return tx.inventoryCostLayer.create({
      data: {
        tenantId,
        organizationId,
        costingKey,
        productId,
        warehouseId: warehouseId ?? undefined,
        sourceDocumentType: WAC_BUCKET_TYPE,
        sourceDocumentId: costingKey,
        receiptDate: new Date(0),
        originalQuantity: '0',
        remainingQuantity: '0',
        originalUnitCost: '0',
        currentUnitCost: '0',
        originalTotalCost: '0',
        currentRemainingValue: '0',
        status: 'OPEN',
      },
    });
  }

  async receive(tx: PrismaTransactionClient, input: IncomingMovementInput) {
    const bucket = await this.getOrCreateBucket(tx, input.tenantId, input.organizationId, input.costingKey, input.productId, input.warehouseId);
    const currentQty = new Decimal(bucket.remainingQuantity.toString());
    const currentValue = new Decimal(bucket.currentRemainingValue.toString());
    const incomingValue = input.quantity.mul(input.unitCost);

    const newQty = currentQty.plus(input.quantity);
    const newValue = currentValue.plus(incomingValue).toDecimalPlaces(2);
    const newUnitCost = newQty.gt(0) ? newValue.div(newQty) : new Decimal(0);

    await tx.inventoryCostLayer.update({
      where: { id: bucket.id },
      data: { remainingQuantity: newQty.toString(), originalQuantity: newQty.toString(), currentUnitCost: newUnitCost.toString(), originalUnitCost: newUnitCost.toString(), currentRemainingValue: newValue.toString(), originalTotalCost: newValue.toString() },
    });
    await tx.inventoryCostComponent.create({
      data: { tenantId: input.tenantId, costLayerId: bucket.id, componentType: 'PURCHASE_PRICE', sourceDocumentType: input.sourceDocumentType, sourceDocumentId: input.sourceDocumentId, amount: incomingValue.toDecimalPlaces(2).toString(), baseCurrencyAmount: incomingValue.toDecimalPlaces(2).toString() },
    });
    return { bucketId: bucket.id, newUnitCost };
  }

  async consume(tx: PrismaTransactionClient, input: OutgoingMovementInput): Promise<ConsumptionResult> {
    const bucket = await this.getOrCreateBucket(tx, input.tenantId, input.organizationId, input.costingKey, input.productId, input.warehouseId);
    const currentQty = new Decimal(bucket.remainingQuantity.toString());
    const unitCost = new Decimal(bucket.currentUnitCost.toString());
    const take = Decimal.min(currentQty, input.quantity); // allow_negative handled by caller for the shortfall
    const shortfall = input.quantity.minus(take);
    const cost = take.mul(unitCost).toDecimalPlaces(2);

    const newQty = currentQty.minus(take);
    await tx.inventoryCostLayer.update({ where: { id: bucket.id }, data: { remainingQuantity: newQty.toString(), currentRemainingValue: newQty.mul(unitCost).toDecimalPlaces(2).toString() } });

    if (take.gt(0)) {
      await tx.inventoryCostConsumption.create({
        data: {
          tenantId: input.tenantId,
          costLayerId: bucket.id,
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
    }

    return { totalConsumedQuantity: take, totalConsumedCost: cost, shortfallQuantity: shortfall, breakdown: take.gt(0) ? [{ costLayerId: bucket.id, quantity: take, unitCost, cost }] : [] };
  }

  async reverseConsumption(tx: PrismaTransactionClient, tenantId: string, outgoingDocumentType: string, outgoingDocumentId: string) {
    const consumptions = await tx.inventoryCostConsumption.findMany({ where: { tenantId, outgoingDocumentType, outgoingDocumentId, reversed: false } });
    for (const c of consumptions) {
      const bucket = await tx.inventoryCostLayer.findUnique({ where: { id: c.costLayerId } });
      if (!bucket) continue;
      const restored = new Decimal(bucket.remainingQuantity.toString()).plus(c.consumedQuantity.toString());
      const unitCost = new Decimal(bucket.currentUnitCost.toString());
      await tx.inventoryCostLayer.update({ where: { id: bucket.id }, data: { remainingQuantity: restored.toString(), currentRemainingValue: restored.mul(unitCost).toDecimalPlaces(2).toString() } });
      await tx.inventoryCostConsumption.update({ where: { id: c.id }, data: { reversed: true } });
    }
  }

  /** Reverses a receipt into the pool (unpost) — only safe when nothing
   * has been consumed since (the caller enforces that, spec section 110's
   * "dependency block"); otherwise the pool's average would silently
   * misstate history. */
  async reverseReceipt(tx: PrismaTransactionClient, tenantId: string, costingKey: string, quantity: Decimal, unitCost: Decimal, sourceDocumentType: string, sourceDocumentId: string) {
    const bucket = await tx.inventoryCostLayer.findFirst({ where: { tenantId, costingKey, sourceDocumentType: WAC_BUCKET_TYPE } });
    if (!bucket) return;
    const currentQty = new Decimal(bucket.remainingQuantity.toString());
    const currentValue = new Decimal(bucket.currentRemainingValue.toString());
    const newQty = currentQty.minus(quantity);
    const newValue = currentValue.minus(quantity.mul(unitCost)).toDecimalPlaces(2);
    const newUnitCost = newQty.gt(0) ? newValue.div(newQty) : new Decimal(0);
    await tx.inventoryCostLayer.update({
      where: { id: bucket.id },
      data: { remainingQuantity: newQty.toString(), originalQuantity: newQty.toString(), currentUnitCost: newUnitCost.toString(), originalUnitCost: newUnitCost.toString(), currentRemainingValue: newValue.toString(), originalTotalCost: newValue.toString() },
    });
    await tx.inventoryCostComponent.deleteMany({ where: { tenantId, costLayerId: bucket.id, sourceDocumentType, sourceDocumentId } });
  }

  /** Prospective revaluation (see class docstring) — adds `additionalAmount`
   * straight into the pool's value and recomputes the average over
   * whatever quantity currently remains. */
  async applyAdditionalCost(tx: PrismaTransactionClient, tenantId: string, costingKey: string, additionalAmount: Decimal, sourceDocumentType: string, sourceDocumentId: string) {
    const bucket = await tx.inventoryCostLayer.findFirst({ where: { tenantId, costingKey, sourceDocumentType: WAC_BUCKET_TYPE } });
    if (!bucket) throw new Error(`No weighted-average bucket exists yet for costing key ${costingKey}`);
    const qty = new Decimal(bucket.remainingQuantity.toString());
    const newValue = new Decimal(bucket.currentRemainingValue.toString()).plus(additionalAmount).toDecimalPlaces(2);
    const newUnitCost = qty.gt(0) ? newValue.div(qty) : new Decimal(0);
    await tx.inventoryCostLayer.update({ where: { id: bucket.id }, data: { currentUnitCost: newUnitCost.toString(), currentRemainingValue: newValue.toString() } });
    await tx.inventoryCostComponent.create({ data: { tenantId, costLayerId: bucket.id, componentType: 'ADJUSTMENT', sourceDocumentType, sourceDocumentId, amount: additionalAmount.toString(), baseCurrencyAmount: additionalAmount.toString() } });
    return newUnitCost;
  }
}
