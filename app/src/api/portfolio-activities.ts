import type {PortfolioCycleScope} from './portfolio';

export type PortfolioActivityRecord = {
  record_id: string; side: string; cycle_key: string; created_at?: string; chain: string; token: string;
  time_basis: string; token_amount?: string; amount_raw?: string; asset_decimals?: number;
  trade_id?: string; tx_hash?: string; tx_chain?: string; trade_value_usd?: string;
  execution_price_usd?: string; status?: string; lifecycle?: string; confirmed_at?: string;
  valuation_status?: string; symbol?: string; logo?: string; launchpad_logo?: string; name?: string;
};
export type PortfolioActivities = {
  activities?: PortfolioActivityRecord[]; activities_status?: 'complete' | 'unavailable'; next_activity_cursor?: string;
};

export function normalizeActivities(value: Record<string, unknown>, scope: PortfolioCycleScope): PortfolioActivities {
  if (value.activities_status === undefined) return {};
  if (value.activities_status === 'unavailable') return {activities_status: 'unavailable'};
  if (value.activities_status !== 'complete' || !Array.isArray(value.activities)) throw new Error('Invalid activity response.');
  // The previously deployed activity schema lacks side. Do not reinterpret its amount aliases.
  if (value.activities.some(r => r && typeof r === 'object' && r.side === undefined && typeof r.type === 'string')) return {activities_status: 'unavailable'};
  const optional = (v: unknown): string | undefined => {
    if (v == null || v === '') return undefined;
    if (typeof v !== 'string') throw new Error('Invalid activity string.');
    return v;
  };
  const decimal = (v: unknown) => {
    const s = optional(v);
    if (s !== undefined && (s.length > 256 || !/^\d+(?:\.\d+)?$/.test(s))) throw new Error('Invalid activity amount.');
    return s;
  };
  const time = (v: unknown) => {
    const s = optional(v);
    if (s && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s)))) throw new Error('Invalid activity time.');
    return s;
  };
  const activities = value.activities.map((raw): PortfolioActivityRecord => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid activity.');
    const r = raw as Record<string, unknown>;
    const id = optional(r.record_id), side = optional(r.side), chain = optional(r.chain), token = optional(r.token);
    const sameToken = token && (scope.chain === 'solana' ? token === scope.asset : token.toLowerCase() === scope.asset.toLowerCase());
    if (!id || !side || r.cycle_key !== scope.cycle_key || chain !== scope.chain || !sameToken) throw new Error('Invalid or mismatched cycle activity.');
    const tradeID = optional(r.trade_id), status = optional(r.status), lifecycle = optional(r.lifecycle);
    const createdAt = time(r.created_at);
    if ((side === 'buy' || side === 'sell') && (!tradeID || !status || !lifecycle || !createdAt)) throw new Error('Invalid platform activity.');
    const rawAmount = optional(r.amount_raw);
    if (rawAmount && !/^\d+$/.test(rawAmount)) throw new Error('Invalid raw activity amount.');
    const precision = r.asset_decimals;
    if (precision != null && (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 0 || precision > 255)) throw new Error('Invalid activity precision.');
    return {record_id: id, side, cycle_key: scope.cycle_key!, chain, token: token!, created_at: createdAt, time_basis: optional(r.time_basis) ?? '',
      token_amount: decimal(r.token_amount), amount_raw: rawAmount, asset_decimals: precision == null ? undefined : precision as number,
      trade_id: tradeID, status, lifecycle, confirmed_at: time(r.confirmed_at), tx_hash: optional(r.tx_hash), tx_chain: optional(r.tx_chain),
      trade_value_usd: decimal(r.trade_value_usd), execution_price_usd: decimal(r.execution_price_usd),
      valuation_status: optional(r.valuation_status), symbol: optional(r.symbol), logo: optional(r.logo), launchpad_logo: optional(r.launchpad_logo), name: optional(r.name)};
  });
  return {activities_status: 'complete', activities, next_activity_cursor: optional(value.next_activity_cursor)};
}
