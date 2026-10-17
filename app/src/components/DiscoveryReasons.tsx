import type {DiscoverySignal, DiscoveryCoverage} from '@/lib/discovery';
import {discoveryReasonDetail, discoveryChannelLabels} from '@/lib/discovery';

export function DiscoveryReasons({discovery}: {discovery?: DiscoverySignal}) {
  if (!discovery?.reasons.length) return <span className="text-xs text-muted">理由暂缺</span>;
  return <details className="min-w-[180px] max-w-[340px] text-xs">
    <summary className="cursor-pointer leading-6">{discovery.reasons.map(r => <span key={r.code} className="mr-1 inline-block rounded bg-accent/10 px-1.5 text-foreground">{r.label}</span>)}</summary>
    <ul className="mt-2 space-y-3 text-muted">{discovery.reasons.map(r => <li key={r.code}>
      <p className="font-medium text-foreground">{r.label}{r.upstream_rank ? ` · 通道第 ${r.upstream_rank} 名` : ''}</p>
      <p>{discoveryReasonDetail(r)}</p>
      <p>{r.observed_at_ms ? `发现于 ${new Date(r.observed_at_ms).toLocaleString()}` : '发现时间暂缺'}</p>
    </li>)}</ul>
  </details>;
}
const modes: Record<string,string> = {ws:'行情实时更新',fallback:'行情备用刷新',polling:'行情定时刷新',idle:'等待行情',budget_exhausted:'本期查询额度已用完'};
const states: Record<string,string> = {complete:'发现数据完整',partial:'部分通道暂不可用',stale:'暂用上次发现结果'};
export function DiscoveryStatus({coverage}: {coverage?: DiscoveryCoverage}) {
  if (!coverage) return <p className="text-muted">等待新版发现数据…</p>;
  return <p className="text-muted">{states[coverage.state] ?? '发现状态待确认'} · {modes[coverage.market_mode] ?? '行情状态待确认'}{coverage.discovered_at_ms ? ` · 最近发现 ${new Date(coverage.discovered_at_ms).toLocaleTimeString()}` : ''}</p>;
}

export function DiscoveryWeights({coverage}:{coverage?:DiscoveryCoverage}) {
 if(!coverage?.weights || Object.keys(coverage.weights).length===0)return null;
 return <p className="text-muted">混排目标配比：{Object.entries(discoveryChannelLabels).map(([key,label])=>`${label} ${coverage.weights?.[key] ?? '—'}%`).join(' · ')}（候选不足时由其他通道补位）</p>;
}
