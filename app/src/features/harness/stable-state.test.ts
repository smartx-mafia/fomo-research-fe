import {describe, expect, it} from 'vitest';

import {keepPreviousWireValue} from './stable-state';

describe('keepPreviousWireValue', () => {
  it('preserves identity for an unchanged polling payload', () => {
    const previous = [{id: 'swap-1', status: 2}];
    const next = [{id: 'swap-1', status: 2}];

    expect(keepPreviousWireValue(previous, next)).toBe(previous);
  });

  it('publishes a changed polling payload', () => {
    const previous = [{id: 'swap-1', status: 2}];
    const next = [{id: 'swap-1', status: 3}];

    expect(keepPreviousWireValue(previous, next)).toBe(next);
  });
});
