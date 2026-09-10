import {describe, expect, it} from 'vitest';
import {opinionAge, opinionCycleReturn} from './opinion-card-display';

describe('Square card display', () => {
  it('shows compact relative time from the shared feed clock', () => {
    const now = 1_788_855_000_000;
    expect(opinionAge(now / 1000 - 32 * 60, now)).toBe('32m');
    expect(opinionAge(now / 1000 - 7200, now)).toBe('2h');
    expect(opinionAge(now / 1000 + 30, now)).toBe('now');
    expect(opinionAge(NaN, now)).toBe('');
  });
  it('uses a direction marker instead of a duplicate minus sign', () => {
    expect(opinionCycleReturn('-0.9896')).toEqual({text: '98.96%', direction: 'down', label: 'Cycle return -98.96%'});
    expect(opinionCycleReturn('0.12')).toEqual({text: '12%', direction: 'up', label: 'Cycle return +12%'});
    expect(opinionCycleReturn('0')).toEqual({text: '0%', direction: 'flat', label: 'Cycle return 0%'});
  });
  it('does not turn missing or invalid values into zero returns', () => {
    for (const value of [undefined, '', ' ', 'NaN', 'Infinity']) {
      expect(opinionCycleReturn(value)).toEqual({text: '—', direction: 'flat', label: 'Cycle return unavailable'});
    }
  });
});
