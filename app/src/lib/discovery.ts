/** Server-owned discovery evidence; never infer membership from live prices. */
export interface DiscoveryReason {
  code: string; label: string; upstream_rank?: number; observed_at_ms?: number;
  metric: string; value?: number; unit: string; threshold?: number;
}
export interface DiscoverySignal {
  channels: string[]; reasons: DiscoveryReason[];
  discovered_at_ms?: number; market_updated_at_ms?: number;
  volume_change_5m?: number; volume_5m?: number;
}
export interface DiscoveryCoverage {
  policy_version: string; state: string; market_mode: string; discovered_at_ms?: number;
  channels: {name: string; state: string; observed_at_ms?: number; candidate_count?: number}[];
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === 'string' ? v : '';
const number = (v: unknown) => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : undefined;
export function normalizeDiscovery(raw: unknown): DiscoverySignal | undefined {
  const r = record(raw);
  if (!Array.isArray(r.reasons) || !r.reasons.length) return undefined;
  const reasons = r.reasons.map(v => {
    const r = record(v);
    return {code:str(r.code), label:str(r.label), metric:str(r.metric), unit:str(r.unit), value:number(r.value), threshold:number(r.threshold), upstream_rank:number(r.upstream_rank), observed_at_ms:number(r.observed_at_ms)};
  }).filter(r => r.code && r.label);
  if (!reasons.length) return undefined;
  return {reasons, channels:Array.isArray(r.channels) ? r.channels.filter((v):v is string => typeof v === 'string') : [], discovered_at_ms:number(r.discovered_at_ms), market_updated_at_ms:number(r.market_updated_at_ms), volume_5m:number(r.volume_5m), volume_change_5m:number(r.volume_change_5m)};
}
export function normalizeDiscoveryCoverage(raw: unknown): DiscoveryCoverage | undefined {
  const r = record(raw);
  if (!str(r.policy_version)) return undefined;
  return {policy_version:str(r.policy_version), state:str(r.state), market_mode:str(r.market_mode), discovered_at_ms:number(r.discovered_at_ms), channels:Array.isArray(r.channels) ? r.channels.map(v => {const c=record(v);return {name:str(c.name),state:str(c.state),observed_at_ms:number(c.observed_at_ms),candidate_count:number(c.candidate_count)};}) : []};
}
export function discoveryReasonDetail(r: DiscoveryReason): string {
  if (r.value === undefined) return '指标暂缺';
  if (r.metric === 'volume_change_5m') return `5 分钟成交额增幅 ${r.value.toFixed(1)}%${r.threshold === undefined ? '' : `，门槛 ≥ ${r.threshold}%`}`;
  if (r.metric === 'price_change_5m') return `5 分钟涨幅 ${r.value.toFixed(1)}%${r.threshold === undefined ? '' : `，门槛 ≥ ${r.threshold}%`}`;
  if (r.metric === 'token_created_at') return `创建于 ${new Date(r.value).toLocaleString()}（发现时 24 小时内）`;
  if (r.metric === 'upstream_rank') return `该通道上游第 ${r.value} 名${r.threshold === undefined ? '' : `，取前 ${r.threshold} 名候选`}`;
  return `${r.metric}: ${r.value} ${r.unit}`;
}
