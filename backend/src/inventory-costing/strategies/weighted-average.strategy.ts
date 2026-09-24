import Decimal from 'decimal.js';
import { money, unitCostOf } from '../costing.types';
import { CostingState, InventoryCostingStrategy, IssueContext, IssueResult, ReceiveResult, provisionalUnitCostFor, settleDeficits } from './costing-strategy';

/**
 * WeightedAverageCostingStrategy (spec sections 12-14).
 *  MOVING_AVERAGE: the pool average is updated after every incoming
 *  movement; an issue is valued at the average at that moment.
 *  PERIODIC_WEIGHTED_AVERAGE: during an open month issues are valued at
 *  the moving average (PROVISIONAL); at month close the engine hands in
 *  `ctx.periodicAverage` = (opening value + period incoming value) /
 *  (opening qty + period incoming qty) and every issue of that month is
 *  re-valued at it (spec 14's 1C-style month-close behaviour).
 * An issue that empties the pool takes the pool's exact remaining value,
 * so quantity 0 never leaves a residual value behind (spec 65).
 */
export class WeightedAverageCostingStrategy implements InventoryCostingStrategy {
  readonly method = 'WEIGHTED_AVERAGE' as const;

  processIncomingMovement(state: CostingState, costMovementId: string, _lineId: string | null, _date: Date, _sequence: bigint, quantity: Decimal, value: Decimal, provisional: boolean): ReceiveResult {
    const unitCost = unitCostOf(value, quantity);
    const { settlements } = settleDeficits(state, quantity, unitCost, value);
    // The pool is the signed sum of movement values: the settled issues'
    // values change by `delta`, so the pool absorbs the same delta.
    const deltaSum = settlements.reduce((s, x) => s.plus(x.delta), new Decimal(0));
    state.poolQty = state.poolQty.plus(quantity);
    state.poolValue = state.poolValue.plus(value).plus(deltaSum);
    if (provisional) state.poolProvisional = true;
    state.lastUnitCost = unitCost;
    return { layer: null, settlements };
  }

  calculateOutgoingCost(state: CostingState, costMovementId: string, date: Date, sequence: bigint, quantity: Decimal, ctx: IssueContext): IssueResult {
    let value: Decimal;
    let deficitQuantity = new Decimal(0);
    let provisionalUnitCost: Decimal | null = null;
    let blocked = false;
    let provisional = state.poolProvisional;

    const covered = Decimal.max(Decimal.min(state.poolQty, quantity), 0);
    if (covered.eq(quantity)) {
      if (quantity.eq(state.poolQty)) {
        value = state.poolValue; // empties the pool exactly
      } else if (ctx.periodicAverage) {
        value = money(quantity.mul(ctx.periodicAverage));
      } else if (ctx.specificUnitCost) {
        value = money(quantity.mul(ctx.specificUnitCost));
      } else {
        value = money(quantity.mul(state.poolValue).div(state.poolQty));
      }
    } else {
      const coveredValue = covered.gt(0) ? (covered.eq(state.poolQty) ? state.poolValue : money(covered.mul(state.poolValue).div(state.poolQty))) : new Decimal(0);
      deficitQuantity = quantity.minus(covered);
      if (!ctx.allowNegativeQuantityCosting || ctx.negativeStockCostPolicy === 'BLOCK_COSTING') {
        blocked = true;
        provisionalUnitCost = new Decimal(0);
      } else {
        provisionalUnitCost = provisionalUnitCostFor(state, ctx.negativeStockCostPolicy);
      }
      const provisionalValue = money(deficitQuantity.mul(provisionalUnitCost));
      value = coveredValue.plus(provisionalValue);
      state.deficits.push({ costMovementId, effectiveDate: date, sequence, open: deficitQuantity, provisionalUnitCost, openProvisionalValue: provisionalValue });
      provisional = true;
    }

    state.poolQty = state.poolQty.minus(quantity);
    state.poolValue = state.poolValue.minus(value);
    const unit = unitCostOf(value, quantity);
    if (unit.gt(0)) state.lastUnitCost = unit;
    return { value, consumptions: [], deficitQuantity, provisionalUnitCost, provisional, blocked };
  }

  calculateClosingState(state: CostingState) {
    return { quantity: state.poolQty, value: state.poolValue, openLayers: [] };
  }
}
