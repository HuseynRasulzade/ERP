import Decimal from 'decimal.js';

/**
 * Centralized rounding/precision rules (section 17/41). Never scatter
 * `round(x, 2)` through the codebase and never use binary floating-point for
 * financial values — Money always wraps a Decimal.js value.
 *
 * Money and quantity are deliberately kept as separate concepts: use
 * `Money` for currency amounts (rounded to the currency's decimalPlaces,
 * ROUND_HALF_UP) and plain `Decimal` for quantities, which may need more
 * than 2 decimal places and must not be forced into currency rounding.
 */
export class Money {
  private readonly value: Decimal;
  readonly decimalPlaces: number;

  private constructor(value: Decimal, decimalPlaces: number) {
    this.decimalPlaces = decimalPlaces;
    this.value = value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  }

  static of(amount: Decimal.Value, decimalPlaces = 2): Money {
    return new Money(new Decimal(amount), decimalPlaces);
  }

  static zero(decimalPlaces = 2): Money {
    return Money.of(0, decimalPlaces);
  }

  add(other: Money): Money {
    this.assertSamePrecision(other);
    return Money.of(this.value.plus(other.value), this.decimalPlaces);
  }

  subtract(other: Money): Money {
    this.assertSamePrecision(other);
    return Money.of(this.value.minus(other.value), this.decimalPlaces);
  }

  multiply(factor: Decimal.Value): Money {
    return Money.of(this.value.times(factor), this.decimalPlaces);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  toDecimal(): Decimal {
    return this.value;
  }

  toString(): string {
    return this.value.toFixed(this.decimalPlaces);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  private assertSamePrecision(other: Money) {
    if (this.decimalPlaces !== other.decimalPlaces) {
      throw new Error(
        `Money precision mismatch: ${this.decimalPlaces} vs ${other.decimalPlaces}`,
      );
    }
  }
}
