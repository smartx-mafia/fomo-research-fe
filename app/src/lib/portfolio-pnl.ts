import type {PnlPoint, PortfolioPnl, PortfolioBalanceCurve} from '@/api/portfolio';
import {parseExactDecimal} from '@/lib/exact-decimal';

export const PNL_PERIODS = ['24H', '7D', '30D', 'All'] as const;
const EAST_EIGHT = 8 * 3600_000;
export function pnlTimeParts(at: string | number) {
  const milliseconds = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(milliseconds)) return {date: '—', time: '—'};
  const iso = new Date(milliseconds + EAST_EIGHT).toISOString();
  return {date: iso.slice(0, 10), time: iso.slice(11, 19)};
}
export function formatPnlTime(at?: string) {
  if (!at || !Number.isFinite(Date.parse(at))) return 'Unavailable';
  const parts = pnlTimeParts(at);
  return `${parts.date} ${parts.time} UTC+08:00`;
}
export type PnlPeriod = typeof PNL_PERIODS[number];
export function pnlWindow(pnl: PortfolioPnl | undefined, period: PnlPeriod) {
  const window = pnl?.[period === '24H' ? 'd1' : period === '7D' ? 'd7' : period === '30D' ? 'd30' : 'all'];
  return {window, amount: window?.amount_usd ?? (period === 'All' ? pnl?.all_usd : undefined)};
}
export type PnlPlotPoint = PnlPoint & {atMs: number; x: number; y: number; segment: number};
export type PnlPlotTick = {at: string; atMs: number; sampleAt?: string; x: number; y?: number; pnl_usd?: string; label?: 'NOW'};

/** Match the actual PnL sample, not its rounded display label or a neighboring balance. */
export function balanceForPnlTick(point: PnlPlotTick, balance?: PortfolioBalanceCurve) {
  if (!balance) return undefined;
  if (point.label === 'NOW') return balance.now_usd === undefined ? undefined : {amount: balance.now_usd, at: balance.as_of};
  // Assets can be available even when the PnL baseline/cost basis is missing.
  const at = Date.parse(point.sampleAt ?? point.at);
  const sample = balance.points?.find((sample) => Date.parse(sample.at) === at);
  return sample ? {amount: sample.balance_usd, at: sample.at} : undefined;
}

/** Convert only normalized coordinates to Number; financial values and differences stay exact. */
export function pnlGeometry(curve: readonly PnlPoint[] | undefined, period: PnlPeriod, nowMs = Date.now(), currentAmount?: string) {
  const accepted: (PnlPoint & {atMs: number; segment: number; exact: ReturnType<typeof parseExactDecimal>})[] = [];
  for (const point of curve ?? []) {
    const atMs = Date.parse(point.at);
    if (!Number.isFinite(atMs) || atMs > nowMs || point.pnl_usd.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(point.pnl_usd)) continue;
    accepted.push({...point, atMs, segment: 0, exact: parseExactDecimal(point.pnl_usd)});
  }
  // Historical nodes are whole hours / UTC+8 midnights strictly before NOW.
  // A missing boundary can use the latest earlier observation within that interval,
  // with its real sample time retained. Never take a later value or sum cumulative PnL.
  accepted.reverse().sort((a, b) => b.atMs - a.atMs);
  const slots: {at: string; atMs: number; sampleAt?: string; pnl_usd?: string}[] = [];
  const validCurrent = currentAmount !== undefined && currentAmount.length <= 256 && /^-?\d+(?:\.\d+)?$/.test(currentAmount) ? currentAmount : undefined;
  if (period === 'All') slots.push(...accepted.slice().reverse());
  else if (accepted.length || validCurrent !== undefined) {
    const count = period === '24H' ? 24 : period === '7D' ? 42 : 30;
    const step = period === '24H' ? 3600_000 : period === '7D' ? 4 * 3600_000 : 86400_000;
    let anchor = Math.floor((nowMs + EAST_EIGHT) / step) * step - EAST_EIGHT;
    if (anchor === nowMs) anchor -= step;
    for (let index = count - 1; index >= 0; index--) {
      const atMs = anchor - index * step;
      const sample = accepted.find((candidate) => candidate.atMs <= atMs && candidate.atMs > atMs - step);
      slots.push({at: new Date(atMs).toISOString(), atMs, pnl_usd: sample?.pnl_usd, sampleAt: sample?.at});
    }
  }
  const last = slots.at(-1);
  if (last?.atMs === nowMs) {if (validCurrent !== undefined) last.pnl_usd = validCurrent;}
  else if (slots.length || validCurrent !== undefined) slots.push({at: new Date(nowMs).toISOString(), atMs: nowMs,
    pnl_usd: validCurrent ?? accepted.find((candidate) => candidate.atMs === nowMs)?.pnl_usd});
  const width = 960, right = width - 96;
  if (!slots.length) return {width, right, ticks: [] as PnlPlotTick[], points: [] as PnlPlotPoint[], segments: [] as PnlPlotPoint[][], min: undefined, max: undefined, zeroY: undefined};
  const displayed = slots.filter((slot): slot is PnlPoint & {atMs: number} => slot.pnl_usd !== undefined);
  const exact = displayed.map((slot) => parseExactDecimal(slot.pnl_usd));
  const scale = exact.reduce((max, value) => Math.max(max, value.scale), 0);
  const values = exact.map((value) => value.coefficient * BigInt(10) ** BigInt(scale - value.scale));
  let minIndex = 0, maxIndex = 0;
  values.forEach((value, i) => {if (value < values[minIndex]) minIndex = i; if (value > values[maxIndex]) maxIndex = i;});
  const low = values[minIndex] ?? BigInt(0), high = values[maxIndex] ?? BigInt(0), span = high - low;
  const y = (value: bigint) => span === BigInt(0) ? 130 : 236 - Number((value - low) * BigInt(1_000_000) / span) / 1_000_000 * 210;
  let valueIndex = 0;
  const ticks: PnlPlotTick[] = slots.map((slot, index) => ({...slot, label: index === slots.length - 1 ? 'NOW' : undefined,
    x: slots.length === 1 ? right : 20 + index / (slots.length - 1) * (right - 20), y: slot.pnl_usd === undefined ? undefined : y(values[valueIndex++])}));
  const points = ticks.filter((tick): tick is PnlPlotTick & {pnl_usd: string; y: number} => tick.pnl_usd !== undefined && tick.y !== undefined).map((tick) => ({...tick, segment: 0}));
  return {width, right, ticks, points, segments: points.length ? [points] : [], min: displayed[minIndex]?.pnl_usd, max: displayed[maxIndex]?.pnl_usd,
    zeroY: values.length && low <= BigInt(0) && high >= BigInt(0) ? y(BigInt(0)) : undefined};
}
