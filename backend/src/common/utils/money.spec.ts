import { Money } from './money';

describe('Money (section 41: exact decimal behavior, no float drift)', () => {
  it('never accumulates binary float error across repeated addition', () => {
    let total = Money.zero(2);
    for (let i = 0; i < 10; i++) {
      total = total.add(Money.of('0.1'));
    }
    // Naively summing 0.1 ten times in IEEE-754 float yields
    // 0.9999999999999999, not 1 — Money must not exhibit this.
    expect(total.toString()).toBe('1.00');
  });

  it('rounds half up to the currency precision', () => {
    expect(Money.of('10.005', 2).toString()).toBe('10.01');
  });

  it('rejects mixing amounts of different precision', () => {
    const twoDp = Money.of('1.00', 2);
    const fourDp = Money.of('1.0000', 4);
    expect(() => twoDp.add(fourDp)).toThrow();
  });
});
