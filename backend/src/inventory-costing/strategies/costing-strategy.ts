import Decimal from 'decimal.js';
import { CostingMethod, money, unitCostOf } from '../costing.types';

/** In-memory FIFO layer during a replay. `persistedId` is set for layers
 * loaded from the opening state; new layers get it after persistence. */
export interface LayerState {
  persistedId: string | null;
  sourceCostMovementId: string | null; // null = synthetic balancing layer (method switch / migration)
  sourceDocumentLineId: string | null;
  receiptDate: Date;
  sequence: bigint;
  originalQuantity: Decimal;
  remainingQuantity: Decimal;
  unitCost: Decimal;
  totalValue: Decimal;
  remainingValue: Decimal;
  provisional: boolean;
}

export interface DeficitState {
  costMovementId: string;
  effectiveDate: Date;
  sequence: bigint;
  open: Decimal;
  provisionalUnitCost: Decimal;
  /** Provisional value still attributed to `open` (exact, no cent drift). */
  openProvisionalValue: Decimal;
}

export interface CostingState {
  method: CostingMethod;
  layers: LayerState[];
  poolQty: Decimal;
  poolValue: Decimal;
  poolProvisional: boolean;
  deficits: DeficitState[];
  lastUnitCost: Decimal;
}

export interface ConsumptionResult {
  layer: LayerState | null;
  sourceIncomingCostMovementId: string | null;
  quantity: Decimal;
  unitCost: Decimal;
  cost: Decimal;
}

export interface IssueContext {
  negativeStockCostPolicy: string;
  allowNegativeQuantityCosting: boolean;
  /** Purchase return (spec 28): consume these receipt lines' layers first. */
  specificReceiptLineIds?: string[];
  /** Weighted average specific unit cost (purchase return, spec 28/125). */
  specificUnitCost?: Decimal | null;
  /** Periodic weighted average (spec 13-14): value at this average. */
  periodicAverage?: Decimal | null;
}

export interface IssueResult {
  value: Decimal; // positive magnitude leaving inventory
  consumptions: ConsumptionResult[];
  deficitQuantity: Decimal;
  provisionalUnitCost: Decimal | null;
  provisional: boolean;
  blocked: boolean;
}

export interface SettlementResult {
  deficit: DeficitState;
  quantity: Decimal;
  unitCost: Decimal;
  cost: Decimal;
  /** Change of the deficit outgoing movement's SIGNED value (negative =
   * more cost leaves inventory than was provisionally booked). */
  delta: Decimal;
}

export interface ReceiveResult {
  layer: LayerState | null;
  settlements: SettlementResult[];
}

/**
 * InventoryCostingStrategy (spec section 88). The engine never branches on
 * the method — it asks the strategy. `adjustIncomingCost`/`reverseMovement`/
 * `rebuildFromDate` are realised by the engine as a deterministic replay
 * from the earliest affected date (spec 48), so each strategy only needs
 * to implement the per-movement primitives below.
 */
export interface InventoryCostingStrategy {
  readonly method: CostingMethod;
  processIncomingMovement(state: CostingState, costMovementId: string, sourceDocumentLineId: string | null, date: Date, sequence: bigint, quantity: Decimal, value: Decimal, provisional: boolean): ReceiveResult;
  calculateOutgoingCost(state: CostingState, costMovementId: string, date: Date, sequence: bigint, quantity: Decimal, ctx: IssueContext): IssueResult;
  calculateClosingState(state: CostingState): { quantity: Decimal; value: Decimal; openLayers: { sourceCostMovementId: string | null; remainingQuantity: string; unitCost: string; remainingValue: string }[] };
}

/** Negative-stock provisional unit cost (spec sections 52-54). */
export function provisionalUnitCostFor(state: CostingState, policy: string): Decimal {
  switch (policy) {
    case 'ZERO_PENDING':
      return new Decimal(0);
    case 'CURRENT_AVERAGE': {
      if (state.method === 'WEIGHTED_AVERAGE' && state.poolQty.gt(0)) return unitCostOf(state.poolValue, state.poolQty);
      const qty = state.layers.reduce((s, l) => s.plus(l.remainingQuantity), new Decimal(0));
      const val = state.layers.reduce((s, l) => s.plus(l.remainingValue), new Decimal(0));
      return qty.gt(0) ? unitCostOf(val, qty) : state.lastUnitCost;
    }
    case 'LAST_KNOWN_COST':
    default:
      return state.lastUnitCost;
  }
}

/** Shared deficit settlement: a new receipt first covers earlier
 * negative-stock issues at ITS cost; the difference against the
 * provisional cost becomes a COGS delta on the original issue (spec 53). */
export function settleDeficits(state: CostingState, quantity: Decimal, unitCost: Decimal, value: Decimal): { settlements: SettlementResult[]; coveredQty: Decimal; coveredValue: Decimal } {
  const settlements: SettlementResult[] = [];
  let available = quantity;
  let coveredQty = new Decimal(0);
  let coveredValue = new Decimal(0);
  for (const deficit of state.deficits) {
    if (available.lte(0)) break;
    if (deficit.open.lte(0)) continue;
    const take = Decimal.min(deficit.open, available);
    // The receipt's own value is split exactly: the piece that exhausts the
    // receipt takes whatever value is left (no lost cents, spec 51).
    const cost = take.eq(available) ? value.minus(coveredValue) : money(take.mul(unitCost));
    const provisionalCost = take.eq(deficit.open) ? deficit.openProvisionalValue : money(take.mul(deficit.provisionalUnitCost));
    settlements.push({ deficit, quantity: take, unitCost, cost, delta: provisionalCost.minus(cost) });
    deficit.openProvisionalValue = deficit.openProvisionalValue.minus(provisionalCost);
    deficit.open = deficit.open.minus(take);
    available = available.minus(take);
    coveredQty = coveredQty.plus(take);
    coveredValue = coveredValue.plus(cost);
  }
  state.deficits = state.deficits.filter((x) => x.open.gt(0));
  return { settlements, coveredQty, coveredValue };
}
