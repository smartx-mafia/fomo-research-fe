import type {OhlcvBar, OhlcvPeriod} from './types';

export const CHART_PERIODS: OhlcvPeriod[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
export const PERIOD_SECONDS: Record<OhlcvPeriod, number> = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400};
export const RETENTION_DAYS: Record<OhlcvPeriod, number | null> = {'1m': 7, '5m': 30, '15m': 90, '1h': 365, '4h': 730, '1d': null};
export const CHART_PAGE_SIZE = 300;
export const MAX_CHART_BARS = 6000;
export const chartTTL = (period: OhlcvPeriod) => Math.min(PERIOD_SECONDS[period], 900) * 1000;

/** Timestamp units and period boundaries are a contract, never guessed or rounded. */
export function normalizeChartBars(raw: unknown, period: OhlcvPeriod, now = Date.now()): OhlcvBar[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 2001) throw new Error('Invalid candle response.');
  const step = PERIOD_SECONDS[period] * 1000;
  const rows = new Map<number, OhlcvBar>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error('Invalid candle response.');
    const {t, o, h, l, c, v} = item;
    if (!Number.isSafeInteger(t) || t < 1e12 || t > Math.floor(now / step) * step || t % step !== 0
      || ![o, h, l, c].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
      || h < Math.max(o, c) || l > Math.min(o, c) || h < l
      || (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))) {
      throw new Error('The chart feed returned an invalid candle. Please retry later.');
    }
    rows.set(t, {t, o, h, l, c, v: v ?? null});
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

/** Latest REST overwrites overlap (including volume); it never discards an older loaded page. */
export function mergeChartBars(existing: OhlcvBar[], incoming: OhlcvBar[]): OhlcvBar[] {
  const merged = new Map(existing.map((bar) => [bar.t, bar]));
  for (const bar of incoming) merged.set(bar.t, bar);
  return [...merged.values()].sort((a, b) => a.t - b.t).slice(-MAX_CHART_BARS);
}

/** A sparse/empty page advances the cursor, but does not prove all earlier history is empty. */
export function previousChartRange(beforeSeconds: number, period: OhlcvPeriod, now = Date.now()) {
  const step = PERIOD_SECONDS[period];
  // Historical requests must end before the backend's 60s settlement window,
  // otherwise the endpoint switches to live mode and appends a current quote bar.
  const settled = Math.floor((Math.floor(now / 1000) - 60 - step) / step) * step;
  const to = Math.min(Math.floor(beforeSeconds / step) * step - step, settled);
  const retention = RETENTION_DAYS[period];
  // Leave one minute of headroom against the server's moving retention gate.
  const oldest = retention === null ? Math.ceil(1e9 / step) * step
    : Math.ceil((Math.floor(now / 1000) - retention * 86400 + 60) / step) * step;
  const from = Math.max(oldest, to - (CHART_PAGE_SIZE - 1) * step);
  return from <= to ? {from, to} : null;
}

export function formatChartPrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  if (price === 0) return '0';
  const abs = Math.abs(price);
  if (abs < 1e-8) return price.toExponential(4);
  const decimals = Math.min(12, Math.max(2, 4 - Math.floor(Math.log10(abs))));
  return price.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
}

export function chartMinMove(price: number): number {
  return price > 0 && Number.isFinite(price) ? Math.max(Number.MIN_VALUE, 10 ** (Math.floor(Math.log10(price)) - 4)) : 0.01;
}

export type TimedQuote = {chain: string; address: string; price: number; observedAt: number; connected: boolean};
export function usableChartQuote(quote: TimedQuote | undefined, chain: string, address: string, now: number) {
  if (!quote || quote.chain !== chain || quote.address !== address || !quote.connected
    || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isSafeInteger(quote.observedAt)
    // Permit small browser/server clock skew, but reject materially future data.
    || quote.observedAt <= 0 || quote.observedAt > now + 2000 || now - quote.observedAt >= 60_000) return undefined;
  return quote;
}

/** Preserve the exact candle at the left edge after prepending a page or trimming old data. */
export function shiftedChartRange(before: OhlcvBar[], after: OhlcvBar[], range: {from: number; to: number}) {
  if (!before.length || !after.length) return range;
  const anchor = Math.min(before.length - 1, Math.max(0, Math.floor(range.from)));
  const nextIndex = after.findIndex((bar) => bar.t === before[anchor].t);
  if (nextIndex < 0) return range;
  const offset = nextIndex - anchor;
  return {from: range.from + offset, to: range.to + offset};
}
