import {describe, expect, it} from 'vitest';
import {opinionAge, opinionPnl} from './opinion-card-display';

describe('Square card display', () => {
  it('shows compact relative time from the shared feed clock', () => {
    const now = 1_788_855_000_000;
    expect(opinionAge(now / 1000 - 32 * 60, now)).toBe('32m');
    expect(opinionAge(now / 1000 - 7200, now)).toBe('2h');
    expect(opinionAge(now / 1000 + 30, now)).toBe('now');
    expect(opinionAge(NaN, now)).toBe('');
  });
  it('uses a direction marker instead of a duplicate minus sign', () => {
    expect(opinionPnl('-98.9600')).toEqual({text: '98.96%', direction: 'down', label: '-98.96%'});
    expect(opinionPnl('12')).toEqual({text: '12.00%', direction: 'up', label: '+12.00%'});
    expect(opinionPnl('0')).toEqual({text: '0.00%', direction: 'flat', label: '0.00%'});
  });
  it('does not turn missing or invalid values into zero returns', () => {
    for (const value of [undefined, '', ' ', 'NaN', 'Infinity']) {
      expect(opinionPnl(value)).toEqual({text: '—', direction: 'flat', label: 'PnL unavailable'});
    }
  });
});
