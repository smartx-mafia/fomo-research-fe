"use client";

import {useEffect, useRef, useState} from 'react';
import {fetchDiscoveryResearch, MarketApiError} from '@/lib/market';
import type {DiscoveryResearchData} from '@/lib/discovery';
import {discoveryChannelLabels, discoverySelectionLabels} from '@/lib/discovery';
import {DiscoveryReasons, DiscoveryWeights} from './DiscoveryReasons';
import {DiscoveryTuning} from './DiscoveryTuning';
import {fmtCompact, fmtPrice} from '@/lib/format';

export function DiscoveryResearch({initialMode='research'}:{initialMode?:'research'|'tuning'}) {
  const [mode,setMode]=useState(initialMode);
  const [openedTuning,setOpenedTuning]=useState(initialMode==='tuning');
  const [data,setData]=useState<DiscoveryResearchData>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [automatic,setAutomatic]=useState(true);
  const automaticRef=useRef(true);
  const [refresh,setRefresh]=useState(0);
  const [search,setSearch]=useState('');
  const [channel,setChannel]=useState('');
  const [selection,setSelection]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let retry:ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    fetchDiscoveryResearch(controller.signal).then(value=>{if(!controller.signal.aborted){setData(value);setError('');}}).catch(err=>{
      if(controller.signal.aborted)return;
      setError(err instanceof MarketApiError && err.code===500304 ? '正在生成首个候选批次，请稍候。' : `读取失败：${err instanceof Error ? err.message : '请稍后重试'}`);
      if(err instanceof MarketApiError && err.code===500304 && automaticRef.current) retry=setTimeout(()=>{if(automaticRef.current)setRefresh(v=>v+1);},5000);
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>{controller.abort();if(retry)clearTimeout(retry);};
  },[refresh]);
  useEffect(()=>{if(!automatic)return;const timer=setInterval(()=>setRefresh(v=>v+1),60000);return ()=>clearInterval(timer);},[automatic]);
  const query=search.trim().toLowerCase();
  const rows=(data?.candidates ?? []).filter(c=>(!query || `${c.chain} ${c.address} ${c.symbol} ${c.name}`.toLowerCase().includes(query)) && (!channel || c.sources.some(s=>s.code===channel)) && (!selection || c.selection_state===selection));
  return <section className="space-y-4 p-4" aria-label="候选全量研究">
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={mode==='research'} className="rounded border border-border px-3 py-2" onClick={()=>setMode('research')}>候选全量</button><button type="button" aria-pressed={mode==='tuning'} className="rounded border border-border px-3 py-2" onClick={()=>{setOpenedTuning(true);setMode('tuning');}}>权重调参与预览</button></div>
      <h2 className="font-medium">{mode==='research'?'候选全量 · 研究视图':'榜单权重实验室'}</h2>
      <p className="text-muted">展示五路查询返回并识别的全部地址，按链和地址去重，不截取前 100。包含未通过筛选的候选；通道命中不等于最终入选。</p>
      <p className="text-muted">价格为发现批次快照，不订阅实时价格。默认每分钟读取一次；可暂停刷新对照研究。范围限于各路本次查询上限，不代表全市场所有代币。</p>
      <DiscoveryWeights coverage={data?.discovery} />
      {data && mode==='research' && <p>原始记录 {data.source_row_count} · 去重地址 {data.unique_count} · 通过筛选 {data.qualified_count} · 混排选中 {data.selected_count} · 当前显示 {rows.length}</p>}
      {data && <p className="text-muted">批次时间：{new Date(data.generated_at_ms).toLocaleString()} · {data.state==='complete'?'五路数据完整':data.state==='stale'?'历史批次，已过期':'部分数据或检查暂不可用'} · 以上状态为发现批次结果，实时榜单还会按最新风险和展示信息复核</p>}
      {data?.discovery && <p className="text-muted">{data.discovery.channels.map(c=>`${discoveryChannelLabels[c.name] ?? c.name}：${c.candidate_count ?? '—'} 条${c.state==='fresh'?'':c.state==='stale'?'（沿用上次）':'（不可用）'}`).join(' · ')}</p>}
      {error && <p role="alert" className="text-down">{error}{data?' 当前保留上次批次，请留意时间。':''}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input hidden={mode!=='research'} aria-label="搜索候选" placeholder="搜索名称、完整地址或链" value={search} onChange={e=>setSearch(e.target.value)} className="min-w-[250px] rounded border border-border bg-surface px-3 py-2" />
      <select hidden={mode!=='research'} aria-label="候选来源" value={channel} onChange={e=>setChannel(e.target.value)} className="rounded border border-border bg-surface px-2 py-2"><option value="">全部通道</option>{Object.entries(discoveryChannelLabels).map(([code,label])=><option value={code} key={code}>{label}</option>)}</select>
      <select hidden={mode!=='research'} aria-label="筛选状态" value={selection} onChange={e=>setSelection(e.target.value)} className="rounded border border-border bg-surface px-2 py-2"><option value="">全部状态</option>{Object.entries(discoverySelectionLabels).map(([code,label])=><option value={code} key={code}>{label}</option>)}</select>
      <button type="button" onClick={()=>{automaticRef.current=!automatic;setAutomatic(!automatic);}} className="rounded border border-border px-3 py-2">{automatic?'暂停自动刷新':'恢复自动刷新'}</button>
      <button type="button" disabled={loading} onClick={()=>setRefresh(v=>v+1)} className="rounded border border-border px-3 py-2 disabled:opacity-50">{loading?'读取中…':'刷新批次'}</button>
    </div>
    {data && openedTuning && <div hidden={mode!=='tuning'}><DiscoveryTuning data={data} /></div>}
    {!data ? <p className="text-muted">等待候选数据…</p> : <div hidden={mode!=='research'} className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-sm">
      <thead className="text-xs text-muted"><tr>{['代币 / 完整地址','通道来源与证据','本批筛选状态','混排名次','快照价格','流动性','5m 成交额','5m 买家','FDV'].map(label=><th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
      <tbody>{rows.map(c=><tr key={`${c.chain}:${c.address}`} className="border-t border-border align-top">
        <td className="min-w-[280px] max-w-[340px] px-3 py-3"><a className="font-medium" href={`/token/${encodeURIComponent(c.chain)}/${encodeURIComponent(c.address)}`}>{c.symbol || '未命名'} · {c.chain}</a><p className="text-xs text-muted">{c.name}</p><p className="mt-1 select-text break-all font-mono text-xs">{c.address}</p></td>
        <td className="px-3 py-3"><DiscoveryReasons discovery={{channels:c.sources.map(s=>s.code),reasons:c.sources}} /></td>
        <td className="min-w-[180px] px-3 py-3"><p>{discoverySelectionLabels[c.selection_state] ?? '状态未知'}</p>{c.exclusion_reason && <p className="mt-1 text-xs text-muted">{c.exclusion_reason}</p>}</td>
        <td className="px-3 py-3 tabular">{c.selected_rank || '—'}</td>
        <td className="px-3 py-3 tabular">{fmtPrice(c.price)}</td><td className="px-3 py-3 tabular">{fmtCompact(c.liquidity)}</td><td className="px-3 py-3 tabular">{fmtCompact(c.volume_5m)}</td><td className="px-3 py-3 tabular">{c.buyers_5m ?? '—'}</td><td className="px-3 py-3 tabular">{fmtCompact(c.fdv)}</td>
      </tr>)}</tbody>
    </table>{rows.length===0 && <p className="p-4 text-muted">当前筛选条件下没有候选。</p>}</div>}
  </section>;
}
