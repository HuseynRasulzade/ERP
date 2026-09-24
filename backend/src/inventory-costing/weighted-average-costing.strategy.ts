import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { NoEligibleCostLayerError } from '../common/errors/app-error';
import { CostEventContext, ConsumeInput, ConsumeResult, InventoryCostingStrategy, ReceiveInput, ReceiveResult } from './costing-strategy.interface';

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * WeightedAverageCostingStrategy (spec sections 12-14). Deliberately holds
 * NO mutable "average cost" field anywhere — every average is computed on
 * demand by aggregating `InventoryCostMovement` (quantity/totalCost both
 * SIGNED, so `SUM(totalCost)/SUM(quantity)` over a costing key at any point
 * in time IS the average as of that point — spec section 50's determinism/
 * rebuildability requirement falls out of this for free, no separate
 * snapshot table needed for correctness).
 *
 * MOVING_AVERAGE: the average recomputes after every movement (queries
 * everything up to and including `effectiveDate`).
 *
 * PERIODIC_WEIGHTED_AVERAGE: every issue during an open month is costed
 * PROVISIONALLY at the *opening-of-month* rate (spec section 15: "Period
 * ərzində shipment-lər provisional cost ilə gedə bilər"); the true period
 * average (opening + this month's receipts) is only computed once, at
 * `CostingPeriodService.finalize`, which then raises a delta adjustment for
 * every provisional issue in that period (spec section 14/57).
 */
@Injectable()
export class WeightedAverageCostingStrategy implements InventoryCostingStrategy {
  async receive(_ctx: CostEventContext, input: ReceiveInput): Promise<ReceiveResult> {
    // No layer bookkeeping — the register aggregate itself IS the pool.
    return { unitCost: input.unitCost, totalCost: input.unitCost.mul(input.quantity).toDecimalPlaces(2) };
  }

  async consume(ctx: CostEventContext, input: ConsumeInput, tx: PrismaTransactionClient): Promise<ConsumeResult> {
    const periodic = ctx.policy.averageMethod === 'PERIODIC_WEIGHTED_AVERAGE';
    const asOf = periodic ? new Date(startOfMonth(input.effectiveDate).getTime() - 1) : input.effectiveDate;

    let { qty, value } = await this.aggregateUpTo(ctx, asOf, tx);
    let provisional = periodic;

    let unitCost: Decimal;
    if (qty.gt(0)) {
      unitCost = value.div(qty);
    } else if (!periodic) {
      // MOVING_AVERAGE bootstrap: no history at all as of this date — fall
      // back to the full-history aggregate (covers same-day receipt+issue).
      const full = await this.aggregateUpTo(ctx, input.effectiveDate, tx);
      if (full.qty.gt(0)) {
        unitCost = full.value.div(full.qty);
      } else if (input.allowNegative) {
        unitCost = new Decimal(0);
        provisional = true;
      } else {
        throw new NoEligibleCostLayerError(ctx.costingKey);
      }
    } else if (input.allowNegative) {
      unitCost = new Decimal(0);
    } else {
      throw new NoEligibleCostLayerError(ctx.costingKey);
    }

    const cost = unitCost.mul(input.quantity).toDecimalPlaces(2);
    return { totalCost: cost, details: [{ quantity: input.quantity, unitCost, cost }], provisional };
  }

  async currentUnitCost(ctx: CostEventContext, asOfDate: Date, tx: PrismaTransactionClient): Promise<Decimal | null> {
    const { qty, value } = await this.aggregateUpTo(ctx, asOfDate, tx);
    return qty.gt(0) ? value.div(qty) : null;
  }

  private async aggregateUpTo(ctx: CostEventContext, date: Date, tx: PrismaTransactionClient): Promise<{ qty: Decimal; value: Decimal }> {
    const agg = await tx.inventoryCostMovement.aggregate({
      where: { tenantId: ctx.tenantId, costingKey: ctx.costingKey, effectiveDate: { lte: date } },
      _sum: { quantity: true, totalCost: true },
    });
    return { qty: new Decimal(agg._sum.quantity?.toString() ?? 0), value: new Decimal(agg._sum.totalCost?.toString() ?? 0) };
  }
}
