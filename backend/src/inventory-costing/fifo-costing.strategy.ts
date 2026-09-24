import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { NoEligibleCostLayerError, ValidationAppError } from '../common/errors/app-error';
import {
  CostEventContext,
  ConsumeInput,
  ConsumeResult,
  ConsumptionDetail,
  InventoryCostingStrategy,
  ReceiveInput,
  ReceiveResult,
} from './costing-strategy.interface';

/**
 * FIFOCostingStrategy (spec sections 8-11). Every incoming movement opens a
 * new immutable `InventoryCostLayer`; every outgoing movement consumes the
 * OLDEST open layer first, ordered by `(receiptDate, postingSequence)` —
 * `postingSequence` is a DB-generated autoincrement counter, never a
 * timestamp, so two receipts landing on the same `receiptDate` still have a
 * stable, deterministic order (spec section 10's explicit requirement).
 */
@Injectable()
export class FifoCostingStrategy implements InventoryCostingStrategy {
  async receive(ctx: CostEventContext, input: ReceiveInput, tx: PrismaTransactionClient): Promise<ReceiveResult> {
    const totalCost = input.unitCost.mul(input.quantity).toDecimalPlaces(2);
    const layer = await tx.inventoryCostLayer.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        costingKey: ctx.costingKey,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        batchId: ctx.batchId,
        sourceReceiptDocumentType: input.sourceReceiptDocumentType,
        sourceReceiptDocumentId: input.sourceReceiptDocumentId,
        sourceReceiptLineId: input.sourceReceiptLineId,
        sourceInventoryMovementId: input.sourceInventoryMovementId,
        receiptDate: input.effectiveDate,
        originalQuantity: input.quantity.toString(),
        remainingQuantity: input.quantity.toString(),
        originalUnitCost: input.unitCost.toString(),
        currentUnitCost: input.unitCost.toString(),
        originalTotalCost: totalCost.toString(),
        currentRemainingValue: totalCost.toString(),
        currencyId: ctx.currencyId,
        status: 'OPEN',
      },
    });
    return { unitCost: input.unitCost, totalCost, layerId: layer.id };
  }

  async consume(ctx: CostEventContext, input: ConsumeInput, tx: PrismaTransactionClient): Promise<ConsumeResult> {
    if (input.preferSourceLayerId) {
      return this.consumeExactLayer(ctx, input, tx);
    }

    const layers = await tx.inventoryCostLayer.findMany({
      where: { tenantId: ctx.tenantId, costingKey: ctx.costingKey, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] }, remainingQuantity: { gt: 0 } },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
    });

    let remaining = input.quantity;
    const details: ConsumptionDetail[] = [];

    for (const layer of layers) {
      if (remaining.lte(0)) break;
      const layerRemaining = new Decimal(layer.remainingQuantity.toString());
      const take = Decimal.min(layerRemaining, remaining);
      const unitCost = new Decimal(layer.currentUnitCost.toString());
      const cost = unitCost.mul(take).toDecimalPlaces(2);

      const newRemainingQty = layerRemaining.minus(take);
      const newRemainingValue = new Decimal(layer.currentRemainingValue.toString()).minus(cost);
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: {
          remainingQuantity: newRemainingQty.toString(),
          currentRemainingValue: newRemainingValue.lt(0) ? '0' : newRemainingValue.toString(),
          status: newRemainingQty.lte(0) ? 'CLOSED' : 'PARTIALLY_CONSUMED',
        },
      });

      await tx.inventoryCostConsumption.create({
        data: {
          tenantId: ctx.tenantId,
          costLayerId: layer.id,
          outgoingInventoryMovementId: input.outgoingInventoryMovementId ?? undefined,
          outgoingDocumentType: input.outgoingDocumentType,
          outgoingDocumentId: input.outgoingDocumentId,
          outgoingDocumentLineId: input.outgoingDocumentLineId,
          consumedQuantity: take.toString(),
          unitCost: unitCost.toString(),
          consumedCost: cost.toString(),
        },
      });

      details.push({ costLayerId: layer.id, quantity: take, unitCost, cost });
      remaining = remaining.minus(take);
    }

    let provisional = false;
    if (remaining.gt(0)) {
      if (!input.allowNegative) throw new NoEligibleCostLayerError(ctx.costingKey);
      const fallbackUnitCost = await this.negativeStockUnitCost(ctx, tx);
      const cost = fallbackUnitCost.mul(remaining).toDecimalPlaces(2);
      details.push({ quantity: remaining, unitCost: fallbackUnitCost, cost });
      provisional = true;
      remaining = new Decimal(0);
    }

    const totalCost = details.reduce((s, d) => s.plus(d.cost), new Decimal(0));
    return { totalCost, details, provisional };
  }

  async currentUnitCost(ctx: CostEventContext, _asOfDate: Date, tx: PrismaTransactionClient): Promise<Decimal | null> {
    const layer = await tx.inventoryCostLayer.findFirst({
      where: { tenantId: ctx.tenantId, costingKey: ctx.costingKey, status: { in: ['OPEN', 'PARTIALLY_CONSUMED'] }, remainingQuantity: { gt: 0 } },
      orderBy: [{ receiptDate: 'asc' }, { postingSequence: 'asc' }],
    });
    return layer ? new Decimal(layer.currentUnitCost.toString()) : null;
  }

  /** Purchase-return-to-supplier (spec section 28): consume the ONE layer
   * the return traces back to, never blind FIFO order — an arbitrary
   * layer pick here would be wrong even when it happens to be the oldest. */
  private async consumeExactLayer(ctx: CostEventContext, input: ConsumeInput, tx: PrismaTransactionClient): Promise<ConsumeResult> {
    const layer = await tx.inventoryCostLayer.findFirst({ where: { id: input.preferSourceLayerId!, tenantId: ctx.tenantId } });
    if (!layer) throw new NoEligibleCostLayerError(ctx.costingKey);
    const layerRemaining = new Decimal(layer.remainingQuantity.toString());
    if (layerRemaining.lt(input.quantity)) {
      throw new ValidationAppError(`Cannot return ${input.quantity.toString()} against source receipt layer — only ${layerRemaining.toString()} remains on that layer`);
    }
    const unitCost = new Decimal(layer.currentUnitCost.toString());
    const cost = unitCost.mul(input.quantity).toDecimalPlaces(2);
    const newRemainingQty = layerRemaining.minus(input.quantity);
    const newRemainingValue = new Decimal(layer.currentRemainingValue.toString()).minus(cost);

    await tx.inventoryCostLayer.update({
      where: { id: layer.id },
      data: {
        remainingQuantity: newRemainingQty.toString(),
        currentRemainingValue: newRemainingValue.lt(0) ? '0' : newRemainingValue.toString(),
        status: newRemainingQty.lte(0) ? 'CLOSED' : 'PARTIALLY_CONSUMED',
      },
    });
    await tx.inventoryCostConsumption.create({
      data: {
        tenantId: ctx.tenantId,
        costLayerId: layer.id,
        outgoingInventoryMovementId: input.outgoingInventoryMovementId ?? undefined,
        outgoingDocumentType: input.outgoingDocumentType,
        outgoingDocumentId: input.outgoingDocumentId,
        outgoingDocumentLineId: input.outgoingDocumentLineId,
        consumedQuantity: input.quantity.toString(),
        unitCost: unitCost.toString(),
        consumedCost: cost.toString(),
      },
    });

    return { totalCost: cost, details: [{ costLayerId: layer.id, quantity: input.quantity, unitCost, cost }], provisional: false };
  }

  /** Negative-stock costing (spec sections 52-54) — only reached when the
   * policy allows negative quantity costing at all (caller checks first). */
  private async negativeStockUnitCost(ctx: CostEventContext, tx: PrismaTransactionClient): Promise<Decimal> {
    switch (ctx.policy.negativeStockCostPolicy) {
      case 'ZERO_PENDING':
        return new Decimal(0);
      case 'BLOCK_COSTING':
        throw new NoEligibleCostLayerError(ctx.costingKey);
      case 'CURRENT_AVERAGE': {
        const agg = await tx.inventoryCostMovement.aggregate({ where: { tenantId: ctx.tenantId, costingKey: ctx.costingKey }, _sum: { quantity: true, totalCost: true } });
        const qty = new Decimal(agg._sum.quantity?.toString() ?? 0);
        if (qty.gt(0)) return new Decimal(agg._sum.totalCost?.toString() ?? 0).div(qty);
        return new Decimal(0);
      }
      case 'STANDARD_COST':
      case 'LAST_KNOWN_COST':
      default: {
        const lastClosed = await tx.inventoryCostLayer.findFirst({
          where: { tenantId: ctx.tenantId, costingKey: ctx.costingKey },
          orderBy: [{ receiptDate: 'desc' }, { postingSequence: 'desc' }],
        });
        return lastClosed ? new Decimal(lastClosed.currentUnitCost.toString()) : new Decimal(0);
      }
    }
  }
}
