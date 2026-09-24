import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DepreciationMethod } from '../fixed-assets.constants';
import {
  DepreciationContext,
  DepreciationResult,
  DepreciationStrategy,
  UnsupportedDepreciationMethodError,
  finalize,
  remainingDepreciable,
} from './depreciation-strategy';

/**
 * Straight line (spec sections 21-22), applied PROSPECTIVELY:
 *   periodic = (carrying amount - residual) / remaining periods
 * With no parameter change this equals the textbook
 * (cost - residual) / useful life; after an impairment, modernization or
 * useful-life change it automatically spreads the NEW carrying amount over
 * the NEW remaining life without touching past periods (sections 35, 47, 55).
 */
export class StraightLineDepreciationStrategy implements DepreciationStrategy {
  readonly method = DepreciationMethod.STRAIGHT_LINE;
  calculate(ctx: DepreciationContext): DepreciationResult {
    const remaining = remainingDepreciable(ctx);
    const periods = Math.max(ctx.remainingPeriods, 1);
    return finalize(remaining.div(periods), ctx);
  }
}

/** Declining balance: NBV x annual rate / 12, switching to straight line
 * once that is higher (so the asset still reaches residual on time). */
export class DecliningBalanceStrategy implements DepreciationStrategy {
  constructor(readonly method: string = DepreciationMethod.DECLINING_BALANCE, private readonly factor = 1) {}
  calculate(ctx: DepreciationContext): DepreciationResult {
    const nbv = ctx.costBasis.minus(ctx.accumulatedDepreciation).minus(ctx.impairment);
    const years = new Decimal(Math.max(ctx.usefulLifeMonths, 1)).div(12);
    const annualRate = ctx.ratePercent && ctx.ratePercent.gt(0) ? ctx.ratePercent.div(100) : new Decimal(this.factor).div(years);
    const declining = nbv.mul(annualRate).div(12);
    const straight = remainingDepreciable(ctx).div(Math.max(ctx.remainingPeriods, 1));
    return finalize(Decimal.max(declining, straight), ctx);
  }
}

/** Sum-of-years'-digits on a monthly basis, prospective. */
export class SumOfYearsDigitsStrategy implements DepreciationStrategy {
  readonly method = DepreciationMethod.SUM_OF_YEARS_DIGITS;
  calculate(ctx: DepreciationContext): DepreciationResult {
    const n = Math.max(ctx.remainingPeriods, 1);
    return finalize(remainingDepreciable(ctx).mul(2).div(n + 1), ctx);
  }
}

/** Architectural placeholder for methods whose inputs this phase does not
 * capture yet (production units, manual schedules, localization tax
 * methods): selecting them produces a depreciation-run error, never a
 * silently wrong amount. */
export class NotImplementedStrategy implements DepreciationStrategy {
  constructor(readonly method: string) {}
  calculate(): DepreciationResult {
    throw new UnsupportedDepreciationMethodError(this.method);
  }
}

@Injectable()
export class DepreciationStrategyRegistry {
  private readonly strategies = new Map<string, DepreciationStrategy>();

  constructor() {
    this.register(new StraightLineDepreciationStrategy());
    this.register(new DecliningBalanceStrategy(DepreciationMethod.DECLINING_BALANCE, 1));
    this.register(new DecliningBalanceStrategy(DepreciationMethod.DOUBLE_DECLINING, 2));
    this.register(new SumOfYearsDigitsStrategy());
    this.register(new NotImplementedStrategy(DepreciationMethod.UNITS_OF_PRODUCTION));
    this.register(new NotImplementedStrategy(DepreciationMethod.MANUAL));
    this.register(new NotImplementedStrategy(DepreciationMethod.TAX_METHOD));
  }

  register(strategy: DepreciationStrategy) {
    this.strategies.set(strategy.method, strategy);
  }

  get(method: string): DepreciationStrategy {
    return this.strategies.get(method) ?? new NotImplementedStrategy(method);
  }

  supported(): string[] {
    return [...this.strategies.values()].filter((s) => !(s instanceof NotImplementedStrategy)).map((s) => s.method);
  }
}
