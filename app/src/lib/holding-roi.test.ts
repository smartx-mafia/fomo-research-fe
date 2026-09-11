import {describe, expect, it} from 'vitest';
import {holdingRoi} from './holding-roi';

describe('holding ROI', () => {
  it('uses total profit over lifetime buys and rounds signed percentages', () => {
    expect(holdingRoi('25', '100')).toEqual({text: '25.00%', direction: 1});
    expect(holdingRoi('-1', '6')).toEqual({text: '-16.67%', direction: -1});
    expect(holdingRoi('0', '100')).toEqual({text: '0.00%', direction: 0});
    expect(holdingRoi('-0.00001', '100')).toEqual({text: '0.00%', direction: 0});
  });
  it('preserves precision with large and tiny decimal amounts', () => {
    expect(holdingRoi('9007199254740993', '900719925474099300').text).toBe('1.00%');
    expect(holdingRoi('0.000000000000000001', '0.000000000000000003').text).toBe('33.33%');
  });
  it('does not manufacture a return for missing, invalid, or nonpositive cost', () => {
    for (const cost of [undefined, '', '0', '-1', 'invalid']) expect(holdingRoi('10', cost).text).toBe('—');
    expect(holdingRoi(undefined, '10').text).toBe('—');
  });
});
