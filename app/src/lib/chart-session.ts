import {chartTTL, MAX_CHART_BARS, PERIOD_SECONDS, mergeChartBars, previousChartRange} from './chart-data';
import type {OhlcvBar, OhlcvPeriod} from './types';

export type ChartSnapshot = {
  key: string; revision: number; bars: OhlcvBar[]; unconfirmed: number[]; loading: boolean; loadingHistory: boolean;
  error: string | null; historyError: string | null; historyMessage: string;
  historyEnd: boolean; updatedAt: number; nextRefreshAt: number;
};
export const emptyChart = (key: string): ChartSnapshot => ({key, revision: 0, bars: [], unconfirmed: [], loading: false, loadingHistory: false, error: null, historyError: null, historyMessage: '', historyEnd: false, updatedAt: 0, nextRefreshAt: 0});
export const chartKey = (chain: string, address: string, period: OhlcvPeriod) => JSON.stringify([chain, chain === 'solana' ? address : address.toLowerCase(), period]);
type Entry = {view: ChartSnapshot; cursor: number | null; latestTo: number | null; historyRetryAt: number};
type Fetcher = (chain: string, address: string, options: {period: OhlcvPeriod; from?: number; to?: number; signal: AbortSignal}) => Promise<OhlcvBar[]>;

/** One active view, one HTTP request at a time, six thousand candles per cached view. */
export function createChartSession(fetcher: Fetcher, notify: (snapshot: ChartSnapshot) => void, clock = Date.now) {
  const cache = new Map<string, Entry>();
  let current: {chain: string; address: string; period: OhlcvPeriod; entry: Entry} | undefined;
  let generation = 0;
  let visible = true;
  let pending: AbortController | undefined;
  const publish = () => {if (current) notify({...current.entry.view});};

  function cancel() {
    generation++;
    pending?.abort();
    pending = undefined;
    if (current) current.entry.view = {...current.entry.view, loading: false, loadingHistory: false};
  }

  async function request(history: boolean) {
    if (!current || !visible || pending) return;
    const {chain, address, period, entry} = current;
    const view = entry.view;
    if (!history && clock() < view.nextRefreshAt) return;
    if (history && (view.historyEnd || entry.cursor === null || clock() < entry.historyRetryAt)) return;
    if (history && view.bars.length >= MAX_CHART_BARS) {
      entry.view = {...view, historyMessage: '6,000 candles loaded. Choose a longer interval for a wider range.'};
      publish(); return;
    }
    const range = history ? previousChartRange(entry.cursor!, period, clock()) : null;
    if (history && !range) {
      entry.view = {...view, historyEnd: true, historyMessage: 'History limit reached for this interval.'};
      publish(); return;
    }
    const controller = new AbortController();
    const startedAt = clock();
    pending = controller;
    const epoch = generation;
    entry.view = {...view, loading: !history, loadingHistory: history,
      error: history ? view.error : null, historyError: history ? null : view.historyError};
    publish();
    try {
      // StrictMode cleanup and same-turn token changes can cancel before any HTTP call.
      await Promise.resolve();
      controller.signal.throwIfAborted();
      const rows = await fetcher(chain, address, {period, ...(range ?? {}), signal: controller.signal});
      if (controller.signal.aborted || epoch !== generation) return;
      if (range && rows.some((bar) => bar.t < range.from * 1000 || bar.t > range.to * 1000)) throw new Error('Chart history did not match the requested interval.');
      const step = PERIOD_SECONDS[period];
      const settledTo = Math.floor((Math.floor(startedAt / 1000) - 60 - step) / step) * step;
      const defaultFrom = settledTo - 299 * step;
      const completedFrom = Math.floor((Math.floor(clock() / 1000) - 60 - step) / step) * step - 299 * step;
      const gap = !history && entry.latestTo !== null && defaultFrom > entry.latestTo + step;
      // A slower history response cannot replace a newer overlapping tail.
      const unsettled = new Set(entry.view.unconfirmed);
      const isSettled = (t: number) => t + (PERIOD_SECONDS[period] + 60) * 1000 <= startedAt;
      const previous = new Map(entry.view.bars.map((bar) => [bar.t, bar]));
      const received = new Set(rows.map((bar) => bar.t));
      // The API has no pool/revision ID. If confirmed prices change or disappear
      // inside the definitely requested window, discard older cached segments so
      // histories from different primary pools cannot be silently spliced together.
      const revised = !history && (rows.some((row) => {
        const old = previous.get(row.t);
        return old && !unsettled.has(row.t) && isSettled(row.t) && (old.o !== row.o || old.h !== row.h || old.l !== row.l || old.c !== row.c);
      }) || entry.view.bars.some((bar) => !unsettled.has(bar.t) && bar.t >= completedFrom * 1000 && bar.t <= settledTo * 1000 && !received.has(bar.t)));
      const reset = gap || revised;
      // Previously synthesized tail candles become history only after the REST
      // feed confirms them. A quote-only bucket that disappears must not fossilize.
      const existing = reset ? [] : history ? entry.view.bars : entry.view.bars.filter((bar) => !unsettled.has(bar.t) || !isSettled(bar.t));
      const bars = history ? mergeChartBars(rows, existing) : mergeChartBars(existing, rows);
      for (const row of rows) {if (isSettled(row.t)) unsettled.delete(row.t); else unsettled.add(row.t);}
      // Even an empty first window has a lower boundary: older trades may exist.
      // An in-flight request can cross a settlement boundary. Completion time is
      // conservative for an empty page (at worst a small overlap, never a skipped bucket).
      const initialCursor = rows.length ? rows[0].t / 1000 : completedFrom;
      entry.cursor = range ? range.from : reset ? initialCursor : entry.cursor ?? initialCursor;
      if (!history) entry.latestTo = settledTo;
      entry.view = {...entry.view, bars, unconfirmed: bars.filter((bar) => unsettled.has(bar.t)).map((bar) => bar.t),
        updatedAt: history ? entry.view.updatedAt : clock(),
        nextRefreshAt: history ? entry.view.nextRefreshAt : clock() + chartTTL(period),
        revision: entry.view.revision + (reset ? 1 : 0),
        historyEnd: reset ? false : entry.view.historyEnd,
        historyMessage: gap ? 'Resumed from the latest window after a data gap. Load earlier to view older candles.' : revised ? 'Historical prices were revised. Showing the refreshed chart window.' : history ? (rows.length ? '' : 'No candles in this interval. You can load an earlier interval.') : entry.view.historyMessage,
        historyError: history ? null : entry.view.historyError,
        error: history ? entry.view.error : null};
    } catch (error) {
      if (controller.signal.aborted || epoch !== generation) return;
      const code = (error as {code?: number})?.code;
      const message = code === 200300 ? 'No candle history is available for this token.'
        : code === 100307 ? 'This history range is unavailable. Choose a longer interval.'
        : code === 400000 ? 'Please sign in again to load the chart.'
        : error instanceof Error ? error.message : 'Chart data is temporarily unavailable.';
      if (history) {
        entry.historyRetryAt = clock() + 60_000;
        entry.view = {...entry.view, historyError: message, historyEnd: code === 100307};
      } else {
        const permanent = code === 400000 || code === 100305 || code === 100306 || code === 100307 || code === 500098;
        entry.view = {...entry.view, error: message, nextRefreshAt: permanent ? Infinity : clock() + Math.max(60_000, chartTTL(period))};
      }
    } finally {
      if (epoch === generation && pending === controller) {
        pending = undefined;
        entry.view = {...entry.view, loading: false, loadingHistory: false};
        publish();
      }
    }
  }

  return {
    activate(chain: string, address: string, period: OhlcvPeriod) {
      cancel();
      const key = chartKey(chain, address, period);
      const entry = cache.get(key) ?? {view: emptyChart(key), cursor: null, latestTo: null, historyRetryAt: 0};
      cache.delete(key); cache.set(key, entry);
      while (cache.size > 6) cache.delete(cache.keys().next().value!);
      current = {chain, address: chain === 'solana' ? address : address.toLowerCase(), period, entry};
      publish();
    },
    setVisible(next: boolean) {if (!next) cancel(); visible = next; publish();},
    refresh: () => request(false),
    history: () => request(true),
    pause: () => {visible = false; cancel();},
  };
}
