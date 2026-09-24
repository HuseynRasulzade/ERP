import Decimal from 'decimal.js';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

export const INVENTORY_COST_ADJUSTMENT_TYPE = 'INVENTORY_COST_ADJUSTMENT';

export const CostingMethods = ['FIFO', 'WEIGHTED_AVERAGE'] as const;
export type CostingMethod = (typeof CostingMethods)[number];
export const AverageMethods = ['MOVING_AVERAGE', 'PERIODIC_WEIGHTED_AVERAGE'] as const;
export const NegativeStockCostPolicies = ['LAST_KNOWN_COST', 'CURRENT_AVERAGE', 'ZERO_PENDING', 'BLOCK_COSTING'] as const;
export const SalesReturnWithoutSourcePolicies = ['CURRENT_AVERAGE', 'LAST_KNOWN_COST', 'REQUIRE_MANUAL_REVIEW'] as const;
export const UnpostDependencyPolicies = ['BLOCK', 'RECALCULATE'] as const;

export type MovementClass = 'INCOMING_SOURCED' | 'INCOMING_DERIVED' | 'OUTGOING_STANDARD' | 'OUTGOING_SPECIFIC';
export type GlTreatment = 'SOURCE' | 'ENGINE' | 'NONE';
export type CostStatus = 'UNCALCULATED' | 'PROVISIONAL' | 'FINAL' | 'RECALCULATION_REQUIRED' | 'ERROR';

/** Movement types that never carry a cost consequence of their own: a
 * status re-tag (same warehouse, same costing key) or the IN_TRANSIT ->
 * AVAILABLE step of a two-step transfer receive (spec sections 32-33). */
export const NEUTRAL_MOVEMENT_TYPES = new Set(['STATUS_CHANGE_OUT', 'STATUS_CHANGE_IN', 'TRANSFER_RECEIVE_OUT', 'TRANSFER_RECEIVE_IN']);

/** Internal consumption operation type -> expense mapping key (spec 35),
 * used when the consumption line carries no explicit expense account. */
export const INTERNAL_CONSUMPTION_EXPENSE_MAPPING: Record<string, string> = {
  OFFICE_CONSUMPTION: MappingKeys.ADMIN_EXPENSE,
  MARKETING: MappingKeys.COMMERCIAL_EXPENSE,
  MAINTENANCE: MappingKeys.OTHER_OPERATING_EXPENSE,
  PROJECT_USE: MappingKeys.OTHER_OPERATING_EXPENSE,
  OTHER: MappingKeys.OTHER_OPERATING_EXPENSE,
};

export interface MovementClassification {
  movementClass: MovementClass;
  glTreatment: GlTreatment;
  counterMappingKey: string | null;
}

/**
 * Movement type -> costing behaviour (spec sections 17-35). The account
 * side is always a semantic mapping key resolved through the Accounting
 * Core mapping engine — never a literal account code (spec 24, 112).
 *  SOURCE  = the value source documents (Goods Receipt / Purchase Invoice /
 *            Additional Cost / manual cost adjustment) book their own GL.
 *  ENGINE  = the costing engine owns the inventory value of the movement;
 *            the owning document books it at posting time and the engine
 *            books every later delta as an InventoryCostAdjustment.
 *  NONE    = cost-preserving internal move (cross-key transfer) or an
 *            opening balance, no GL consequence.
 */
export function classifyMovementType(movementType: string, signedQuantity: Decimal): MovementClassification {
  const incoming = signedQuantity.gt(0);
  switch (movementType) {
    case 'PURCHASE_RECEIPT':
      return { movementClass: 'INCOMING_SOURCED', glTreatment: 'SOURCE', counterMappingKey: null };
    case 'OPENING_BALANCE':
      return { movementClass: 'INCOMING_SOURCED', glTreatment: 'NONE', counterMappingKey: null };
    case 'SURPLUS':
      return { movementClass: 'INCOMING_SOURCED', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.OTHER_OPERATING_INCOME };
    case 'SALES_RETURN':
      return { movementClass: 'INCOMING_DERIVED', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.COGS };
    case 'TRANSFER_IN':
      return { movementClass: 'INCOMING_DERIVED', glTreatment: 'NONE', counterMappingKey: null };
    case 'TRANSFER_OUT':
      return { movementClass: 'OUTGOING_STANDARD', glTreatment: 'NONE', counterMappingKey: null };
    case 'SALES_SHIPMENT':
      return { movementClass: 'OUTGOING_STANDARD', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.COGS };
    case 'INTERNAL_CONSUMPTION':
      return { movementClass: 'OUTGOING_STANDARD', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.ADMIN_EXPENSE };
    case 'WRITE_OFF':
      return { movementClass: 'OUTGOING_STANDARD', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.OTHER_OPERATING_EXPENSE };
    case 'PURCHASE_RETURN':
      return { movementClass: 'OUTGOING_SPECIFIC', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.OTHER_OPERATING_EXPENSE };
    default:
      return incoming
        ? { movementClass: 'INCOMING_DERIVED', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.OTHER_OPERATING_INCOME }
        : { movementClass: 'OUTGOING_STANDARD', glTreatment: 'ENGINE', counterMappingKey: MappingKeys.OTHER_OPERATING_EXPENSE };
  }
}

// ---- Deterministic decimal arithmetic (spec sections 50-51) ----

export const AMOUNT_DP = 2;
export const UNIT_COST_DP = 6;
export const QTY_DP = 6;

export function d(value: Decimal.Value | { toString(): string } | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(typeof value === 'object' && !(value instanceof Decimal) ? value.toString() : (value as Decimal.Value));
}

export function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(AMOUNT_DP, Decimal.ROUND_HALF_UP);
}

export function unitCostOf(value: Decimal, quantity: Decimal): Decimal {
  if (quantity.isZero()) return new Decimal(0);
  return value.abs().div(quantity.abs()).toDecimalPlaces(UNIT_COST_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Largest-remainder split (spec sections 51, 129): allocates `total` over
 * `weights` so that the parts always sum to EXACTLY `total` (no lost
 * cents). Ties broken by position, so the result is deterministic.
 */
export function splitAmount(total: Decimal, weights: Decimal[], dp = AMOUNT_DP): Decimal[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((s, w) => s.plus(w.abs()), new Decimal(0));
  if (totalWeight.isZero()) {
    const equal = weights.map(() => new Decimal(1));
    return splitAmount(total, equal, dp);
  }
  const unit = new Decimal(10).pow(-dp);
  const raw = weights.map((w) => total.mul(w.abs()).div(totalWeight));
  const floored = raw.map((r) => r.toDecimalPlaces(dp, Decimal.ROUND_DOWN));
  let remainder = total.minus(floored.reduce((s, v) => s.plus(v), new Decimal(0)));
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floored[i]) }))
    .sort((a, b) => (b.frac.cmp(a.frac) !== 0 ? b.frac.cmp(a.frac) : a.i - b.i));
  const result = [...floored];
  let k = 0;
  while (remainder.abs().gte(unit) && order.length > 0) {
    const step = remainder.gt(0) ? unit : unit.neg();
    result[order[k % order.length].i] = result[order[k % order.length].i].plus(step);
    remainder = remainder.minus(step);
    k++;
  }
  return result;
}

export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
