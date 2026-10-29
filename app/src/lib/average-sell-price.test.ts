import {expect, it} from 'vitest';
import {averageSellPrice} from './average-sell-price';

it('calculates a quantity-weighted sell price with exact decimal rounding', () => {
  expect(averageSellPrice('250', '100')).toBe('2.500000000000');
  expect(averageSellPrice('2', '3')).toBe('0.666666666667');
  expect(averageSellPrice('9007199254740993.12', '1')).toBe('9007199254740993.120000000000');
  expect(averageSellPrice('0.000000000001', '0.000000001')).toBe('0.001000000000');
});
it('distinguishes zero revenue from missing or invalid data', () => {
  expect(averageSellPrice('0', '10')).toBe('0.000000000000');
  for (const amount of [undefined, '', '0', '-1', 'invalid']) expect(averageSellPrice('10', amount)).toBeUndefined();
  expect(averageSellPrice(undefined, '10')).toBeUndefined();
  expect(averageSellPrice('-1', '10')).toBeUndefined();
});
