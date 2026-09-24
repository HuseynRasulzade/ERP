import Decimal from 'decimal.js';
import { money, unitCostOf } from '../costing.types';
import {
  ConsumptionResult,
  CostingState,
  InventoryCostingStrategy,
  IssueContext,
  IssueResult,
  LayerState,
  ReceiveResult,
  provisionalUnitCostFor,
  settleDeficits,
} from './costing-strategy';

/**
 * FIFOCostingStrategy (spec sections 8-11). Layers are consumed strictly in
 * (receipt effective date, posting sequence) order — the engine hands
 * layers in that order and never re-sorts by anything nondeterministic
 * (spec 10). A layer's remaining value is tracked separately from
 * `remaining × unit cost` so the consumption that empties a layer takes
 * exactly what is left (no lost cents).
 */
export class FifoCostingStrategy implements InventoryCostingStrategy {
  readonly method = 'FIFO' as const;

  processIncomingMovement(state: CostingState, costMovementId: string, sourceDocumentLineId: string | null, date: Date, sequence: bigint, quantity: Decimal, value: Decimal, provisional: boolean): ReceiveResult {
    const unitCost = unitCostOf(value, quantity);
    const { settlements, coveredQty, coveredValue } = settleDeficits(state, quantity, unitCost, value);
    const layer: LayerState = {
      persistedId: null,
      sourceCostMovementId: costMovementId,
      sourceDocumentLineId,
      receiptDate: date,
      sequence,
      originalQuantity: quantity,
      remainingQuantity: quantity.minus(coveredQty),
      unitCost,
      totalValue: value,
      remainingValue: value.minus(coveredValue),
      provisional,
    };
    state.layers.push(layer);
    state.lastUnitCost = unitCost;
    return { layer, settlements };
  }

  calculateOutgoingCost(state: CostingState, costMovementId: string, date: Date, sequence: bigint, quantity: Decimal, ctx: IssueContext): IssueResult {
    const consumptions: ConsumptionResult[] = [];
    let need = quantity;
    let value = new Decimal(0);
    let provisional = false;

    const take = (layer: LayerState) => {
      if (need.lte(0) || layer.remainingQuantity.lte(0)) return;
      const qty = Decimal.min(layer.remainingQuantity, need);
      const cost = qty.eq(layer.remainingQuantity) ? layer.remainingValue : money(qty.mul(layer.unitCost));
      layer.remainingQuantity = layer.remainingQuantity.minus(qty);
      layer.remainingValue = layer.remainingValue.minus(cost);
      consumptions.push({ layer, sourceIncomingCostMovementId: layer.sourceCostMovementId, quantity: qty, unitCost: layer.unitCost, cost });
      need = need.minus(qty);
      value = value.plus(cost);
      if (layer.provisional) provisional = true;
    };

    // Purchase return (spec 28): the source receipt's own layer first —
    // never a random/oldest layer when the source is known.
    if (ctx.specificReceiptLineIds && ctx.specificReceiptLineIds.length > 0) {
      for (const layer of state.layers) {
        if (layer.sourceDocumentLineId && ctx.specificReceiptLineIds.includes(layer.sourceDocumentLineId)) take(layer);
      }
    }
    for (const layer of state.layers) take(layer);

    let deficitQuantity = new Decimal(0);
    let provisionalUnitCost: Decimal | null = null;
    let blocked = false;
    if (need.gt(0)) {
      deficitQuantity = need;
      if (!ctx.allowNegativeQuantityCosting || ctx.negativeStockCostPolicy === 'BLOCK_COSTING') {
        blocked = true;
        provisionalUnitCost = new Decimal(0);
      } else {
        provisionalUnitCost = provisionalUnitCostFor(state, ctx.negativeStockCostPolicy);
      }
      const provisionalValue = money(need.mul(provisionalUnitCost));
      value = value.plus(provisionalValue);
      state.deficits.push({ costMovementId, effectiveDate: date, sequence, open: need, provisionalUnitCost, openProvisionalValue: provisionalValue });
      provisional = true;
    }

    const unit = unitCostOf(value, quantity);
    if (unit.gt(0)) state.lastUnitCost = unit;
    return { value, consumptions, deficitQuantity, provisionalUnitCost, provisional, blocked };
  }

  calculateClosingState(state: CostingState) {
    const open = state.layers.filter((l) => l.remainingQuantity.gt(0));
    const deficitQty = state.deficits.reduce((s, x) => s.plus(x.open), new Decimal(0));
    const deficitValue = state.deficits.reduce((s, x) => s.plus(x.openProvisionalValue), new Decimal(0));
    return {
      quantity: open.reduce((s, l) => s.plus(l.remainingQuantity), new Decimal(0)).minus(deficitQty),
      value: open.reduce((s, l) => s.plus(l.remainingValue), new Decimal(0)).minus(deficitValue),
      openLayers: open.map((l) => ({ sourceCostMovementId: l.sourceCostMovementId, remainingQuantity: l.remainingQuantity.toString(), unitCost: l.unitCost.toString(), remainingValue: l.remainingValue.toString() })),
    };
  }
}
