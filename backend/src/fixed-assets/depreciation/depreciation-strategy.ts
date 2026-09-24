import Decimal from 'decimal.js';

/**
 * Depreciation strategy (spec section 140). One implementation per method;
 * DepreciationStrategyRegistry picks it by the method frozen on the asset's
 * effective book policy. Strategies are pure: no I/O, no rounding policy
 * lookups — everything they need arrives in the context.
 */
export interface DepreciationContext {
  /** Gross carrying amount basis (cost + revaluation, or policy override). */
  costBasis: Decimal;
  accumulatedDepreciation: Decimal;
  impairment: Decimal;
  residualValue: Decimal;
  /** Remaining depreciation periods INCLUDING the current one. */
  remainingPeriods: number;
  usefulLifeMonths: number;
  /** Annual rate in percent (declining-balance methods). */
  ratePercent?: Decimal | null;
  /** 0..1 fraction of the period the asset is depreciable (partial-period rule). */
  prorationFactor: Decimal;
  precision: number;
}

export interface DepreciationResult {
  amount: Decimal;
  finalPeriod: boolean;
  note?: string;
}

export interface DepreciationStrategy {
  readonly method: string;
  calculate(ctx: DepreciationContext): DepreciationResult;
}

export class UnsupportedDepreciationMethodError extends Error {
  constructor(method: string) {
    super(`Depreciation method ${method} is not implemented yet`);
  }
}

/** Remaining depreciable amount: carrying amount above residual (never < 0). */
export function remainingDepreciable(ctx: DepreciationContext): Decimal {
  const nbv = ctx.costBasis.minus(ctx.accumulatedDepreciation).minus(ctx.impairment);
  const r = nbv.minus(ctx.residualValue);
  return r.gt(0) ? r : new Decimal(0);
}

/** Final-period true-up (spec section 98): the last period takes whatever
 * remains so accumulated depreciation lands exactly on the depreciable
 * amount; otherwise round to precision and never exceed what remains. */
export function finalize(amount: Decimal, ctx: DepreciationContext): DepreciationResult {
  const remaining = remainingDepreciable(ctx);
  if (ctx.remainingPeriods <= 1) {
    return { amount: remaining.toDecimalPlaces(ctx.precision, Decimal.ROUND_HALF_UP), finalPeriod: true };
  }
  let a = amount.mul(ctx.prorationFactor).toDecimalPlaces(ctx.precision, Decimal.ROUND_HALF_UP);
  if (a.gt(remaining)) a = remaining.toDecimalPlaces(ctx.precision, Decimal.ROUND_HALF_UP);
  if (a.lt(0)) a = new Decimal(0);
  return { amount: a, finalPeriod: a.eq(remaining) };
}
