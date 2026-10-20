/** 已记录交易的独立统计口径；绝不补成正式持仓收益或轮次指标。 */
export type PositionObservationMetric = {status: 'available' | 'unavailable' | 'no_trades' | 'truncated'; value?: string; reason?: string};
export type SquarePositionObservation = {
  status?: string;
  boughtQuantity?: string; boughtUSD?: string; soldQuantity?: string; soldUSD?: string;
  coverage?: string; metrics?: Record<string, PositionObservationMetric>;
  buyCount?: number; sellCount?: number; firstObservedAt?: string | number; lastObservedAt?: string | number;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' && v !== '' ? v : undefined;
const decimal = (v: unknown, signed = false) => typeof v === 'string' && v.length <= 256 && (signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(v) ? v : undefined;
const time = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 || typeof v === 'string' && /^\d{1,19}$/.test(v) && BigInt(v) > 0n ? v as string | number : undefined;
export function readPositionObservation(value: unknown): SquarePositionObservation | undefined {
  const raw = record(value);
  if (!text(raw.status)) return undefined;
  const out: SquarePositionObservation = {status: text(raw.status), boughtQuantity: decimal(raw.bought_amount), boughtUSD: decimal(raw.bought_usd), soldQuantity: decimal(raw.sold_amount), soldUSD: decimal(raw.sold_usd), coverage: text(raw.coverage)};
  if (raw.metrics != null) {
    out.metrics = {};
    const metrics = record(raw.metrics);
    for (const key of ['bought_amount', 'bought_usd', 'sold_amount', 'sold_usd', 'avg_bought_price', 'avg_sold_price', 'cash_flow_difference']) {
      const m = record(metrics[key]), value = decimal(m.value, key === 'cash_flow_difference');
      const status = m.status === 'available' && value !== undefined ? 'available' : m.status === 'no_trades' || m.status === 'truncated' ? m.status : 'unavailable';
      out.metrics[key] = {status, value: status === 'available' ? value : undefined, reason: text(m.reason)};
    }
  }
  for (const [source, dest] of [['buy_count', 'buyCount'], ['sell_count', 'sellCount']] as const) {
    if (typeof raw[source] === 'number' && Number.isSafeInteger(raw[source]) && raw[source] >= 0) out[dest] = raw[source];
  }
  if (time(raw.first_observed_at) !== undefined) out.firstObservedAt = time(raw.first_observed_at);
  if (time(raw.last_observed_at) !== undefined) out.lastObservedAt = time(raw.last_observed_at);
  return out;
}
