import {describe, expect, it} from 'vitest';
import {chartMinMove, formatChartPrice, MAX_CHART_BARS, mergeChartBars, normalizeChartBars, PERIOD_SECONDS, previousChartRange, shiftedChartRange, usableChartQuote} from './chart-data';

const now = Date.UTC(2026, 8, 9, 12, 1);
const t = Date.UTC(2026, 8, 9, 11, 0);
const candle = (time = t, close = 2) => ({t: time, o: 1, h: 3, l: 0.5, c: close, v: 10});

describe('chart data contract', () => {
  it('sorts and deduplicates in milliseconds, keeping the authoritative complete replacement', () => {
    expect(normalizeChartBars([candle(t + 300_000), candle(), {...candle(), v: 20}], '5m', now)).toEqual([{...candle(), v: 20}, candle(t + 300_000)]);
  });
  it.each([{t: t / 1000}, {t: t + 1}, {t: now + 300_000}, {o: 0}, {h: 0.5}, {l: 2}, {c: NaN}, {v: -1}, {v: '10'}])('rejects malformed candle %s', (delta) => {
    expect(() => normalizeChartBars([{...candle(), ...delta}], '5m', now)).toThrow();
  });
  it('distinguishes missing volume from actual zero and supports empty legacy responses', () => {
    expect(normalizeChartBars([{...candle(), v: null}], '5m', now)[0].v).toBeNull();
    expect(normalizeChartBars([{...candle(), v: 0}], '5m', now)[0].v).toBe(0);
    expect(normalizeChartBars(undefined, '5m')).toEqual([]);
  });
  it('keeps loaded history during refresh and replaces overlapping volume rather than accumulating it', () => {
    const before = [candle(t - 300_000), candle()];
    expect(mergeChartBars(before, [{...candle(), c: 2.5, v: 11}, candle(t + 300_000)])).toEqual([before[0], {...candle(), c: 2.5, v: 11}, candle(t + 300_000)]);
    expect(before[1].v).toBe(10);
  });
  it('bounds per-view memory', () => {
    const rows = Array.from({length: MAX_CHART_BARS + 100}, (_, i) => candle(t + i * 300_000));
    expect(mergeChartBars([], rows)).toHaveLength(MAX_CHART_BARS);
  });
  it('requests exactly one fixed 300-bar closed interval without overlap', () => {
    const range = previousChartRange(t / 1000, '5m', now)!;
    expect(range.to).toBe(t / 1000 - 300);
    expect((range.to - range.from) / 300 + 1).toBe(300);
    expect(range.from % 300).toBe(0);
  });
  it('does not cross the settlement or retention gate', () => {
    const range = previousChartRange(now / 1000, '1m', now)!;
    expect((range.to + 60 + 60) * 1000).toBeLessThanOrEqual(now);
    const oldest = (now - 7 * 86400_000) / 1000;
    expect(previousChartRange(oldest, '1m', now)).toBeNull();
    const clipped = previousChartRange(oldest + 600, '1m', now)!;
    expect(clipped.from).toBeGreaterThanOrEqual(oldest);
  });
  it('does not truncate tiny token prices to zero', () => {
    expect(formatChartPrice(0.0011345)).toBe('0.0011345');
    expect(formatChartPrice(0.00000000000032)).toContain('e-13');
    expect(chartMinMove(0.0011345)).toBeCloseTo(1e-7, 12);
  });
  it('anchors the same candle after history is prepended', () => {
    const before = [candle(), candle(t + 300_000)];
    const after = [candle(t - 600_000), candle(t - 300_000), ...before];
    expect(shiftedChartRange(before, after, {from: 0.25, to: 1.75})).toEqual({from: 2.25, to: 3.75});
  });
  it('isolates quotes from OHLC and rejects stale, future, invalid or wrong-token quotes', () => {
    const quote = {chain: 'solana', address: 'A', price: 0.001, observedAt: now - 10, connected: true};
    expect(usableChartQuote(quote, 'solana', 'A', now)).toBe(quote);
    expect(usableChartQuote({...quote, observedAt: now + 100}, 'solana', 'A', now)).toBeDefined();
    for (const delta of [{address: 'B'}, {price: 0}, {price: NaN}, {observedAt: now - 60_000}, {observedAt: now + 2001}, {connected: false}]) {
      expect(usableChartQuote({...quote, ...delta}, 'solana', 'A', now)).toBeUndefined();
    }
    expect(PERIOD_SECONDS['1d']).toBe(86400);
  });
});
