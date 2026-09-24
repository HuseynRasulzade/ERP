import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { IncomingCostContext, InventoryCostingStrategy, OutgoingCostContext, OutgoingCostResult } from './inventory-costing.types';

/**
 * WeightedAverageCostingStrategy (spec sections 12-13) — MOVING_AVERAGE
 * mode: every incoming movement immediately recomputes the running
 * average for its costingKey. `InventoryCostBalance` is a rebuildable
 * projection (spec section 2), not a second source of truth — it can
 * always be reconstructed by replaying InventoryCostMovement rows for
 * the key in order.
 *
 * PERIODIC_WEIGHTED_AVERAGE (spec section 13) is not implemented in this
 * core build; MOVING_AVERAGE covers the "at least one model must fully
 * work" acceptance bar (spec section 555 policy note).
 */
@Injectable()
export class WeightedAverageCostingStrategy implements InventoryCostingStrategy {
  async processIncomingMovement(ctx: IncomingCostContext, tx: PrismaTransactionClient): Promise<void> {
    const balance = await tx.inventoryCostBalance.findUnique({ where: { tenantId_costingKey: { tenantId: ctx.tenantId, costingKey: ctx.costingKey } } });
    const incomingValue = ctx.quantity.mul(ctx.unitCost);

    const priorQty = balance ? new Decimal(balance.quantity.toString()) : new Decimal(0);
    const priorValue = balance ? new Decimal(balance.totalValue.toString()) : new Decimal(0);

    const newQty = priorQty.plus(ctx.quantity);
    const newValue = priorValue.plus(incomingValue);
    const newAvg = newQty.gt(0) ? newValue.div(newQty) : new Decimal(0);

    await tx.inventoryCostBalance.upsert({
      where: { tenantId_costingKey: { tenantId: ctx.tenantId, costingKey: ctx.costingKey } },
      create: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        costingKey: ctx.costingKey,
        quantity: newQty.toString(),
        totalValue: newValue.toString(),
        averageUnitCost: newAvg.toString(),
        currencyId: ctx.currencyId,
      },
      update: {
        quantity: newQty.toString(),
        totalValue: newValue.toString(),
        averageUnitCost: newAvg.toString(),
      },
    });
  }

  async calculateOutgoingCost(ctx: OutgoingCostContext, tx: PrismaTransactionClient): Promise<OutgoingCostResult | null> {
    const balance = await tx.inventoryCostBalance.findUnique({ where: { tenantId_costingKey: { tenantId: ctx.tenantId, costingKey: ctx.costingKey } } });
    if (!balance) return null; // no cost history for this key — preserve "skip, don't fabricate"

    const unitCost = new Decimal(balance.averageUnitCost.toString());
    const priorQty = new Decimal(balance.quantity.toString());
    const priorValue = new Decimal(balance.totalValue.toString());
    const totalCost = ctx.quantity.mul(unitCost);

    const newQty = priorQty.minus(ctx.quantity);
    const newValue = priorValue.minus(totalCost);

    await tx.inventoryCostBalance.update({
      where: { tenantId_costingKey: { tenantId: ctx.tenantId, costingKey: ctx.costingKey } },
      data: {
        quantity: newQty.toString(),
        totalValue: newValue.toString(),
        // averageUnitCost intentionally unchanged by an outgoing movement — only receipts move the average.
      },
    });

    return { unitCost, totalCost, costStatus: newQty.lt(0) ? 'PROVISIONAL' : 'FINAL' };
  }
}
