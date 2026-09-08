import {describe, expect, it} from 'vitest';

import {
  addDecimalStrings,
  decimalSign,
  formatBaseUnitsExact,
  formatDecimalExact,
  marketValueFromBaseUnits,
  subtractDecimalStrings,
} from './exact-decimal';

describe('portfolio exact decimal math', () => {
  it('calculates market value and PnL without converting financial values to Number', () => {
    const marketValue = marketValueFromBaseUnits('37000000000000000000', 18, '0.250000000000');
    expect(marketValue).toBe('9.25');
    const unrealized = subtractDecimalStrings(marketValue, '10.00000000');
    expect(unrealized).toBe('-0.75');
    expect(addDecimalStrings(unrealized, '2.00000000')).toBe('1.25');
  });

  it('preserves large base-unit balances and legitimate zero-decimal assets', () => {
    expect(formatBaseUnitsExact('12345678901234567890123456', 6)).toBe('12345678901234567890.123456');
    expect(formatBaseUnitsExact('42', 0)).toBe('42');
    expect(formatBaseUnitsExact('42')).toBe('42 base units');
  });

  it('rounds display values deterministically and derives sign exactly', () => {
    expect(formatDecimalExact('1234.567', 2)).toBe('1,234.57');
    expect(formatDecimalExact('-0.0049', 2)).toBe('0');
    expect(decimalSign('-0.00000001')).toBe(-1);
    expect(decimalSign('0.000')).toBe(0);
  });
});
