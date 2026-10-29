import {call} from './envelope';
import {normalizePortfolioPosition, PortfolioDataError, type PortfolioPosition, type ProtoTimestamp, type PortfolioPartialError} from './portfolio';

export type PortfolioWindow = '1d' | '7d' | '30d' | 'all';
export type PartName = 'history-curves' | 'cash' | 'positions' | 'current';
export type PartMeta = {read_id: string; snapshot_id: string; expires_at: ProtoTimestamp};
export type PerformancePoint = {at: string; pnl_usd?: string; balance_usd?: string; roi_ratio?: string};
export type PerformanceWindow = {amount_usd?: string; roi_ratio?: string; baseline_as_of?: string; partial: boolean; simulated: boolean; curve: PerformancePoint[]};
export type PortfolioPart = {
  meta: PartMeta; window?: PortfolioWindow; window_context?: string; pnl_rules_version?: string;
  pnl?: PerformanceWindow; balance?: PerformanceWindow; pnl_point?: PerformancePoint; balance_point?: PerformancePoint;
  total_assets_usd?: string; total_value_usd?: string; cash_balance_usd?: string;
  observed_at?: ProtoTimestamp; cash_observed_at?: ProtoTimestamp; history_epoch?: string;
  completeness?: string; quantity_completeness?: string; performance_status?: string; consistency?: string;
  partial_errors: PortfolioPartialError[]; positions: PortfolioPosition[];
  next_cursor: string; total_count?: number; page_expires_at?: ProtoTimestamp;
};
export type PositionFilters = {sort: '' | 'value_desc' | 'last_trade_desc'; hide_small_value?: boolean; hide_honeypot?: boolean; hide_small_pool?: boolean; hide_external?: boolean; sink_risk?: boolean; position_trust?: 'all' | 'trusted' | 'untrusted'};
export type PartRequest = {read_id: string; snapshot_id?: string; window?: PortfolioWindow; window_context?: string; force_refresh: boolean; cursor?: string} & Partial<PositionFilters>;
function object(v: unknown): Record<string, unknown> {if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid portfolio object.'); return v as Record<string, unknown>;}
function str(v: unknown): string | undefined {if (v == null || v === '') return undefined; if (typeof v !== 'string') throw new Error('Invalid portfolio string.'); return v;}
function required(v: unknown) {const s = str(v); if (!s) throw new Error('Missing portfolio identity.'); return s;}
function decimal(v: unknown) {const s = str(v); if (s && (s.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(s))) throw new Error('Invalid portfolio decimal.'); return s;}
function date(v: unknown) {const s = str(v); if (s && !Number.isFinite(Date.parse(s))) throw new Error('Invalid portfolio date.'); return s;}
function timestamp(v: unknown): ProtoTimestamp | undefined {
  if (v == null) return undefined;
  const r = object(v), seconds = Number(r.seconds), nanos = r.nanos ?? 0;
  if (seconds === 0) return undefined;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) throw new Error('Invalid portfolio timestamp.');
  return {seconds, nanos};
}
export function timestampMs(v?: ProtoTimestamp) {return v ? Number(v.seconds) * 1000 + (v.nanos ?? 0) / 1e6 : 0;}
function array(v: unknown): unknown[] {if (v == null) return []; if (!Array.isArray(v)) throw new Error('Invalid portfolio array.'); return v;}
function point(v: unknown, metric: 'pnl_usd' | 'balance_usd', strict = false): PerformancePoint | undefined {
  if (v == null) return undefined;
  const r = object(v), at = date(r.at), amount = decimal(r[metric]);
  if (!at || amount === undefined) {if (strict) throw new Error('Invalid historical point.'); return undefined;}
  return {at, [metric]: amount, roi_ratio: decimal(r.roi_ratio)};
}
function windowData(v: unknown, metric: 'pnl_usd' | 'balance_usd'): PerformanceWindow | undefined {
  if (v == null) return undefined;
  const r = object(v);
  return {amount_usd: decimal(r.amount_usd), roi_ratio: decimal(r.roi_ratio), baseline_as_of: date(r.baseline_as_of), partial: r.partial === true, simulated: r.simulated === true, curve: array(r.curve).map(p => point(p, metric, true)!)};
}
export function normalizePortfolioPart(value: unknown, part: PartName): PortfolioPart {
  const r = object(value), m = object(r.meta), expires = timestamp(m.expires_at);
  if (!expires) throw new Error('Missing read expiry.');
  const window = str(r.window);
  if ((part === 'current' || part === 'history-curves') && !['1d', '7d', '30d', 'all'].includes(window ?? '')) throw new Error('Invalid portfolio window.');
  const total = r.total_count, pageExpires = timestamp(r.page_expires_at);
  if (part === 'positions' && (!Number.isInteger(total) || (total as number) < 0 || !pageExpires)) throw new Error('Portfolio pagination is unavailable. Upgrade the backend before using this page.');
  const pnl = windowData(r.pnl, 'pnl_usd'), balance = windowData(r.balance, 'balance_usd');
  if (part === 'history-curves') {
    const a = pnl?.curve ?? [], b = balance?.curve ?? [];
    if (a.length !== b.length || a.some((p, i) => Date.parse(p.at) !== Date.parse(b[i].at) || (i > 0 && Date.parse(p.at) <= Date.parse(a[i - 1].at)))) throw new Error('Portfolio historical curves do not match.');
    if (pnl) {pnl.amount_usd = undefined; pnl.roi_ratio = undefined;} if (balance) balance.amount_usd = undefined;
  }
  const positions = array(r.positions).map(p => normalizePortfolioPosition(p));
  if (part === 'positions' && (positions.length > 20 || positions.length > (total as number))) throw new Error('Portfolio pagination was not applied.');
  return {
    meta: {read_id: required(m.read_id), snapshot_id: required(m.snapshot_id), expires_at: expires},
    window: window as PortfolioWindow | undefined, window_context: str(r.window_context), pnl_rules_version: str(r.pnl_rules_version),
    pnl, balance, pnl_point: point(r.pnl_point, 'pnl_usd'), balance_point: point(r.balance_point, 'balance_usd'),
    total_assets_usd: decimal(r.total_assets_usd), total_value_usd: decimal(r.total_value_usd), cash_balance_usd: decimal(r.cash_balance_usd),
    observed_at: timestamp(r.observed_at), cash_observed_at: timestamp(r.cash_observed_at), history_epoch: str(r.history_epoch),
    completeness: str(r.completeness), quantity_completeness: str(r.quantity_completeness), consistency: str(r.consistency), performance_status: str(r.performance_status),
    partial_errors: array(r.partial_errors).map(v => {const e = object(v); return {reason: required(e.reason), chain: str(e.chain), token_address: str(e.token_address), retryable: e.retryable === true};}),
    positions, next_cursor: str(r.next_cursor) ?? '', total_count: total as number | undefined, page_expires_at: pageExpires,
  };
}
export async function getPortfolioPart(identifier: string, part: PartName, request: PartRequest, bearer?: string, signal?: AbortSignal) {
  if (!identifier.trim()) throw new Error('A user identifier is required.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) if (value !== undefined && value !== '') query.set(key, String(value));
  if (part === 'positions') query.set('limit', '20');
  const response = await call<unknown>(`/v1/users/${encodeURIComponent(identifier)}/portfolio/${part}?${query}`, {
    bearer, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), preserveInt64Fields: ['chain_id', 'opened_entry_id'],
  });
  try {return normalizePortfolioPart(response.data, part);} catch (e) {throw new PortfolioDataError(e instanceof Error ? e.message : 'Invalid portfolio part.', response.traceID);}
}
