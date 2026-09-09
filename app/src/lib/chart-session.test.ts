import {describe, expect, it, vi} from 'vitest';
import {createChartSession, type ChartSnapshot} from './chart-session';
import {chartTTL, PERIOD_SECONDS} from './chart-data';
import type {OhlcvBar, OhlcvPeriod} from './types';

const start = Date.UTC(2026, 8, 9, 12, 2);
const bar = (t = Date.UTC(2026, 8, 9, 11), c = 2): OhlcvBar => ({t, o: 1, h: 3, l: 0.5, c, v: 10});
type Options = {period: OhlcvPeriod; from?: number; to?: number; signal: AbortSignal};
const fault = (code: number) => Object.assign(new Error('API failure'), {code});

function setup(implementation = async (_chain: string, _address: string, _options: Options) => [bar()]) {
  let now = start;
  let current!: ChartSnapshot;
  const fetcher = vi.fn(implementation);
  const session = createChartSession(fetcher, (view) => {current = view;}, () => now);
  session.activate('solana', 'A', '5m');
  return {session, fetcher, view: () => current, advance: (ms: number) => {now += ms;}};
}

describe('chart session reconciliation and request budget', () => {
  it('invalidates older cached segments when confirmed prices are revised', async () => {
    const s = setup(async (_chain, _address, opts) => opts.from ? [bar(opts.from * 1000)] : [bar()]);
    await s.session.refresh(); await s.session.history();
    expect(s.view().bars).toHaveLength(2);
    s.advance(chartTTL('5m')); s.fetcher.mockResolvedValueOnce([bar(undefined, 2.8)]);
    await s.session.refresh();
    expect(s.view().bars).toEqual([bar(undefined, 2.8)]);
    expect(s.view().revision).toBe(1);
    expect(s.view().historyMessage).toContain('revised');
  });
  it('does not skip an older candle when an empty response crosses the settlement boundary', async () => {
    let now = Date.UTC(2026, 8, 9, 12, 0, 59);
    const fetcher = vi.fn(async (_chain: string, _address: string, opts: Options) => {
      if (!opts.from) {now += 2000; return [];}
      return [bar(opts.from * 1000)];
    });
    const session = createChartSession(fetcher, () => {}, () => now);
    session.activate('solana', 'A', '1m'); await session.refresh(); await session.history();
    expect(fetcher.mock.calls[1][2].to).toBe(Date.UTC(2026, 8, 9, 6, 59) / 1000);
  });
  it('resumes with a new continuous window after an uncovered offline gap, without scanning it automatically', async () => {
    let first = true;
    const s = setup(async (_chain, _address, opts) => {
      if (opts.from) return [bar(opts.from * 1000)];
      const end = start - 2 * 60_000 + (first ? 0 : 8 * 3600_000);
      first = false;
      return Array.from({length: 300}, (_, i) => bar(end - (299 - i) * 60_000));
    });
    s.session.activate('solana', 'A', '1m'); await s.session.refresh();
    const oldEnd = s.view().bars.at(-1)!.t;
    s.session.setVisible(false); s.advance(8 * 3600_000); s.session.setVisible(true); await s.session.refresh();
    expect(s.view().bars).toHaveLength(300);
    expect(s.view().bars[0].t).toBeGreaterThan(oldEnd);
    expect(s.view().revision).toBe(1);
    expect(s.view().historyMessage).toContain('data gap');
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    const oldest = s.view().bars[0].t / 1000;
    await s.session.history();
    expect(s.fetcher.mock.calls[2][2].to).toBe(oldest - 60);
  });
  it('uses default latest requests, does not auto-backfill, and respects TTL across period switches', async () => {
    const s = setup();
    await s.session.refresh(); await s.session.refresh();
    expect(s.fetcher).toHaveBeenCalledTimes(1);
    expect(s.fetcher.mock.calls[0][2]).toMatchObject({period: '5m'});
    expect(s.fetcher.mock.calls[0][2].from).toBeUndefined();
    s.session.activate('solana', 'A', '1h'); await s.session.refresh();
    s.session.activate('solana', 'A', '5m'); await s.session.refresh();
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(s.view().bars).toHaveLength(1);
  });
  it('retains prepended history when latest REST arrives, without duplicate volume', async () => {
    const s = setup(async (_chain, _address, opts) => opts.from ? [bar(opts.from * 1000)] : [bar()]);
    await s.session.refresh(); await s.session.history();
    const oldest = s.view().bars[0].t;
    s.advance(chartTTL('5m')); await s.session.refresh();
    expect(s.view().bars).toHaveLength(2);
    expect(s.view().bars[0].t).toBe(oldest);
    expect(s.view().bars[1].v).toBe(10);
  });
  it('allows a valid empty first window to load earlier data explicitly', async () => {
    const s = setup(async (_chain, _address, opts) => opts.from ? [bar(opts.from * 1000)] : []);
    await s.session.refresh(); expect(s.view().bars).toHaveLength(0);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
    await s.session.history(); expect(s.view().bars).toHaveLength(1);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it('advances an empty historical window once without declaring the end or recursively scanning', async () => {
    const s = setup(async (_chain, _address, opts) => opts.from ? [] : [bar()]);
    await s.session.refresh(); await s.session.history();
    const first = s.fetcher.mock.calls[1][2];
    expect(s.view().historyEnd).toBe(false);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    await s.session.history();
    expect(s.fetcher.mock.calls[2][2].to).toBe(first.from! - 300);
  });
  it('rejects historical responses outside the requested range and preserves the chart', async () => {
    const s = setup(); await s.session.refresh(); await s.session.history();
    expect(s.view().historyError).toContain('interval');
    expect(s.view().bars).toHaveLength(1);
    await s.session.history(); expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it('aborts and ignores a delayed response after a token switch', async () => {
    let resolve!: (rows: OhlcvBar[]) => void;
    const s = setup(async (_chain, address) => address === 'A' ? new Promise((done) => {resolve = done;}) : [bar(undefined, 2.5)]);
    const old = s.session.refresh(); await Promise.resolve();
    const signal = s.fetcher.mock.calls[0][2].signal;
    s.session.activate('solana', 'B', '5m'); await s.session.refresh();
    expect(signal.aborted).toBe(true);
    resolve([bar()]); await old;
    expect(s.view().bars[0].c).toBe(2.5);
    expect(s.view().key).toContain('B');
  });
  it('cancels before the first HTTP call during same-turn StrictMode cleanup', async () => {
    const s = setup(); const first = s.session.refresh();
    s.session.pause(); s.session.activate('solana', 'A', '5m'); s.session.setVisible(true);
    await s.session.refresh(); await first;
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  });
  it('stops network work while hidden and resumes stale snapshots on return', async () => {
    const s = setup(); await s.session.refresh(); s.session.setVisible(false); s.advance(1000_000);
    await s.session.refresh(); await s.session.history(); expect(s.fetcher).toHaveBeenCalledTimes(1);
    s.session.setVisible(true); await s.session.refresh(); expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it('retains useful candles on refresh failure and applies backoff', async () => {
    const s = setup(); await s.session.refresh();
    s.advance(chartTTL('5m')); s.fetcher.mockRejectedValueOnce(fault(500097));
    await s.session.refresh(); expect(s.view().bars).toHaveLength(1); expect(s.view().error).not.toBeNull();
    await s.session.refresh(); expect(s.fetcher).toHaveBeenCalledTimes(2);
    s.advance(chartTTL('5m')); await s.session.refresh(); expect(s.view().error).toBeNull();
  });
  it('does not retry permanent errors on the periodic tick', async () => {
    const s = setup(async () => {throw fault(100307);});
    await s.session.refresh(); s.advance(86400_000); await s.session.refresh();
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  });
  it('never fossilizes a previously synthesized tail that disappears from confirmed history', async () => {
    const tail = Math.floor(start / 300_000) * 300_000;
    const s = setup(async () => [bar(), bar(tail)]);
    await s.session.refresh(); expect(s.view().unconfirmed).toContain(tail);
    s.advance(chartTTL('5m') + 60_000); s.fetcher.mockResolvedValueOnce([bar()]);
    await s.session.refresh(); expect(s.view().bars.map((b) => b.t)).not.toContain(tail);
    expect(s.view().unconfirmed).toEqual([]);
  });
  it('promotes a provisional candle only when a later REST response confirms it', async () => {
    const tail = Math.floor(start / 300_000) * 300_000;
    const s = setup(async () => [bar(), bar(tail)]);
    await s.session.refresh(); s.advance((PERIOD_SECONDS['5m'] + 60) * 1000);
    s.fetcher.mockResolvedValueOnce([bar(), {...bar(tail), c: 2.7, v: 120}]);
    await s.session.refresh(); expect(s.view().unconfirmed).toEqual([]);
    expect(s.view().bars.at(-1)).toMatchObject({c: 2.7, v: 120});
  });
});
