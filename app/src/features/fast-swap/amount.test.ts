import {describe, expect, it} from 'vitest';

import {formatUnits, parseUnits} from './amount';

describe('fast swap exact amounts', () => {
  it('converts decimal input without passing through Number', () => {
    expect(parseUnits('123456789012345678.000001', 6)).toBe('123456789012345678000001');
    expect(formatUnits('123456789012345678000001', 6)).toBe('123456789012345678.000001');
  });

  it('keeps unavailable distinct from a real zero', () => {
    expect(formatUnits(null, 6)).toBe('Unavailable');
    expect(formatUnits('0', 6)).toBe('0');
  });

  it('rejects excess precision and zero', () => {
    expect(() => parseUnits('1.001', 2)).toThrow(/at most 2/);
    expect(() => parseUnits('0', 6)).toThrow(/greater than zero/);
  });
});
