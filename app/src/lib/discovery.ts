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
  weights?: Record<string, number>;
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
  const weights=Object.fromEntries(Object.entries(record(r.weights)).map(([k,v])=>[k,number(v)]).filter((entry): entry is [string,number] => entry[1] !== undefined));
  return {weights,policy_version:str(r.policy_version), state:str(r.state), market_mode:str(r.market_mode), discovered_at_ms:number(r.discovered_at_ms), channels:Array.isArray(r.channels) ? r.channels.map(v => {const c=record(v);return {name:str(c.name),state:str(c.state),observed_at_ms:number(c.observed_at_ms),candidate_count:number(c.candidate_count)};}) : []};
}
export function discoveryReasonDetail(r: DiscoveryReason): string {
  if (r.value === undefined) return '指标暂缺';
  if (r.metric === 'volume_change_5m') return `5 分钟成交额增幅 ${r.value.toFixed(1)}%${r.threshold === undefined ? '' : `，门槛 ≥ ${r.threshold}%`}`;
  if (r.metric === 'price_change_5m') return `5 分钟涨幅 ${r.value.toFixed(1)}%${r.threshold === undefined ? '' : `，门槛 ≥ ${r.threshold}%`}`;
  if (r.metric === 'token_created_at') return `创建于 ${new Date(r.value).toLocaleString()}（发现时 24 小时内）`;
  if (r.metric === 'upstream_rank') return `该通道上游第 ${r.value} 名${r.threshold === undefined ? '' : `，取前 ${r.threshold} 名候选`}`;
  return `${r.metric}: ${r.value} ${r.unit}`;
}

export const discoveryChannelLabels: Record<string,string> = {new_tokens:'新币起势',hot_5m:'短期热门',volume_spike:'突然放量',price_up:'上涨异动',hot_24h:'持续热门'};
export const discoverySelectionLabels: Record<string,string> = {selected:'已入榜',qualified_not_selected:'通过筛选，未入榜',local_excluded:'本地筛选未通过',risk_excluded:'风险准入未通过',risk_unavailable:'风险检查暂不可用'};
export interface DiscoveryCandidate {
 chain:string;address:string;symbol:string;name:string;sources:DiscoveryReason[];
 selection_state:string;exclusion_reason:string;selected_rank?:number;observed_at_ms?:number;
 price?:number;liquidity?:number;volume_5m?:number;buyers_5m?:number;fdv?:number;token_created_at_ms?:number;
}
export interface DiscoveryResearchData {
 generated_at_ms:number;state:string;discovery?:DiscoveryCoverage;candidates:DiscoveryCandidate[];
 source_row_count:number;unique_count:number;qualified_count:number;selected_count:number;
}
export function normalizeDiscoveryResearch(raw:unknown):DiscoveryResearchData {
 const r=record(record(raw).research);
 if(!Array.isArray(r.candidates) || !number(r.generated_at_ms))throw new Error('候选全量数据尚未提供');
 const candidates=r.candidates.map(v=>{const c=record(v);if(!str(c.chain)||!str(c.address))throw new Error('候选地址数据不完整');return {chain:str(c.chain),address:str(c.address),symbol:str(c.symbol),name:str(c.name),sources:normalizeDiscovery({reasons:c.sources})?.reasons ?? [],selection_state:str(c.selection_state),exclusion_reason:str(c.exclusion_reason),selected_rank:number(c.selected_rank),observed_at_ms:number(c.observed_at_ms),price:number(c.price),liquidity:number(c.liquidity),volume_5m:number(c.volume_5m),buyers_5m:number(c.buyers_5m),fdv:number(c.fdv),token_created_at_ms:number(c.token_created_at_ms)};});
 const counts=[r.source_row_count,r.unique_count,r.qualified_count,r.selected_count].map(number);
 if(counts.some(v=>v===undefined)||counts[1]!==candidates.length)throw new Error('候选全集数量不一致');
 return {generated_at_ms:number(r.generated_at_ms)!,state:str(r.state),discovery:normalizeDiscoveryCoverage(r.discovery),candidates,source_row_count:counts[0]!,unique_count:counts[1]!,qualified_count:counts[2]!,selected_count:counts[3]!};
}
