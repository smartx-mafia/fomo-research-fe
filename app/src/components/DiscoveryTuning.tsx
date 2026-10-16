"use client";

import {useEffect,useMemo,useRef,useState} from 'react';
import type {DiscoveryResearchData} from '@/lib/discovery';
import {discoveryChannelLabels,discoverySelectionLabels} from '@/lib/discovery';
import {defaultTuningForm,parseTuningForm,simulateDiscovery,TUNING_CHANNELS,TUNING_FILTERS,TUNING_METRICS,readTuningPlans,exportTuningRun,importTuningRun,tuningSummary,type TuningForm,type TuningMetric,type Direction,type SavedTuningPlan} from '@/lib/discovery-tuning';
import {DiscoveryReasons} from './DiscoveryReasons';
import {fmtCompact,fmtPrice} from '@/lib/format';

const STORAGE_KEY='smartx.discovery-tuning.plans.v1';
const control='rounded border border-border bg-surface px-2 py-2 text-sm';
const button='rounded border border-border px-3 py-2 text-sm disabled:opacity-40';
export function DiscoveryTuning({data}:{data:DiscoveryResearchData}) {
 const [snapshot,setSnapshot]=useState(data);
 const importVersion=useRef(0);
 useEffect(()=>()=>{importVersion.current++;},[]);
 const [form,setForm]=useState<TuningForm>(()=>defaultTuningForm(data));
 const [inputSource,setInputSource]=useState<'server'|'import'>('server');
 const [name,setName]=useState('新币机会榜方案');
 const [notes,setNotes]=useState('');
 const [plans,setPlans]=useState<SavedTuningPlan[]>([]);
 const [notice,setNotice]=useState('');
 const [showSummary,setShowSummary]=useState(false);
 useEffect(()=>{try{setPlans(readTuningPlans(localStorage.getItem(STORAGE_KEY)));}catch{setNotice('浏览器存储不可用，仍可导出方案。');}},[]);
 const parsed=useMemo(()=>parseTuningForm(form),[form]);
 const config=parsed.config;
 const result=useMemo(()=>config?simulateDiscovery(snapshot,config):undefined,[snapshot,config]);
 const summary=useMemo(()=>config&&result?`来源：${inputSource==='server'?'后端候选快照':'导入评审文件（本地数据）'}\n${tuningSummary(snapshot,config,name,notes,result)}`:'',[snapshot,config,name,notes,result,inputSource]);
 const total=TUNING_CHANNELS.reduce((sum,k)=>sum+(form.weights[k].trim()&&Number.isFinite(Number(form.weights[k]))?Number(form.weights[k]):0),0);
 const chains=[...new Set([...snapshot.candidates.map(c=>c.chain),...(form.chain?[form.chain]:[])])].sort();
 function savePlan(){if(!config)return;const next=[{id:crypto.randomUUID(),name:name.trim()||'未命名方案',notes,form:structuredClone(form),createdAt:new Date().toISOString()},...plans].slice(0,20);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));setPlans(next);setNotice('方案已保存在当前浏览器。发给产品经理请导出或复制摘要。');}catch{setNotice('保存失败，请使用导出方案。');}}
 async function importFile(file:File|undefined){if(!file)return;const version=++importVersion.current;try{if(file.size>5*1024*1024)throw new Error('文件不能超过 5 MB');const imported=importTuningRun(JSON.parse(await file.text()));if(version!==importVersion.current)return;setSnapshot(imported.snapshot);setForm(imported.form);setName(imported.name);setNotes(imported.notes);setInputSource('import');setNotice('已导入参数和候选快照，排名已在本机重新计算。');}catch(error){if(version!==importVersion.current)return;setNotice(`导入失败：${error instanceof Error?error.message:'文件无效'}`);}}
 function download(){if(!config||!result)return;const blob=new Blob([JSON.stringify(exportTuningRun(snapshot,config,name,notes,result,inputSource),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${(name||'discovery-plan').replace(/[\\/:*?"<>|]/g,'-').slice(0,80)}-${snapshot.generated_at_ms}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已导出参数、完整候选快照和预览结果，可用于复现及评审。');}
 async function copySummary(){setShowSummary(true);try{await navigator.clipboard.writeText(summary);setNotice('评审摘要已复制。');}catch{setNotice('请从下方摘要框手动复制。');}}
 return <section aria-label="榜单权重实验室" className="space-y-5">
  <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm space-y-2">
   <p className="font-medium">前端模拟 · 锁定候选批次后调参</p>
   <p className="text-muted">每次输入合法参数后即时重算。先筛选地址，再按各通道权重交替取币并去重；通道不足时按固定顺序补位。这里不会发布或修改后端榜单。</p>
   <p>来源：{inputSource==='server'?'后端候选快照':'导入评审文件（本地数据）'} · 锁定批次：{new Date(snapshot.generated_at_ms).toLocaleString()} · {snapshot.unique_count} 个地址 · {snapshot.state==='complete'?'来源完整':'来源部分可用或已陈旧'}</p>
   <p className="text-muted">来源通道沿用发现时证据，新币通道仍指创建 24 小时内。降低门槛不会找回上游未返回的地址；数值条件开启时，缺失该指标的候选不通过。</p>
   <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>{importVersion.current++;setSnapshot(data);setInputSource('server');setNotice('已采用当前读取的候选批次，保留你的参数。');}}>采用最新已读取批次</button><button type="button" className={button} onClick={()=>{importVersion.current++;setForm(defaultTuningForm(snapshot));setNotice('已恢复锁定批次的后端配比和默认筛选。');}}>恢复后端配比与默认筛选</button></div>
   <p className="text-xs text-muted">最新读取：{new Date(data.generated_at_ms).toLocaleString()}。后台读取新批次不会自动替换当前实验数据。</p>
  </div>
  <div className="flex flex-wrap items-center gap-3"><h3 className="font-medium">五路权重与通道内排序</h3><span className={total===100?'text-up':'text-down'}>合计 {total}% / 100%</span></div>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Object.keys(discoveryChannelLabels).map(code=>{const k=code as typeof TUNING_CHANNELS[number];return <fieldset key={k} className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">{discoveryChannelLabels[k]}</legend>
   <label className="block text-xs text-muted">权重（整数 %）<input aria-label={`${discoveryChannelLabels[k]}权重`} type="number" min="0" max="100" step="1" value={form.weights[k]} onChange={e=>setForm(f=>({...f,weights:{...f.weights,[k]:e.target.value}}))} className={`${control} mt-1 w-full`} /></label>
   <label className="block text-xs text-muted">通道内排序<select aria-label={`${discoveryChannelLabels[k]}排序`} className={`${control} mt-1 w-full`} value={form.laneSort[k].metric} onChange={e=>{const metric=e.target.value as TuningMetric;setForm(f=>({...f,laneSort:{...f.laneSort,[k]:{metric,direction:metric==='upstream_rank'?'asc':'desc'}}}));}}>{Object.entries(TUNING_METRICS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <select aria-label={`${discoveryChannelLabels[k]}排序方向`} className={`${control} w-full`} value={form.laneSort[k].direction} onChange={e=>setForm(f=>({...f,laneSort:{...f.laneSort,[k]:{...f.laneSort[k],direction:e.target.value as Direction}}}))}><option value="asc">从小到大 / 旧到新</option><option value="desc">从大到小 / 新到旧</option></select>
  </fieldset>;})}</div>
  <fieldset className="space-y-3 rounded-lg border border-border p-4"><legend className="px-1 font-medium">从地址集中筛选</legend>
   <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-muted">候选范围<select aria-label="模拟候选范围" value={form.scope} onChange={e=>setForm(f=>({...f,scope:e.target.value as TuningForm['scope']}))} className={`${control} mt-1 w-full`}><option value="qualified">本批通过后端筛选</option><option value="all">全部候选（含未通过者，仅研究）</option></select></label>
   <label className="text-xs text-muted">链<select aria-label="模拟链" value={form.chain} onChange={e=>setForm(f=>({...f,chain:e.target.value}))} className={`${control} mt-1 w-full`}><option value="">全部链</option>{chains.map(chain=><option key={chain} value={chain}>{chain}</option>)}</select></label>
   <label className="text-xs text-muted">榜单数量<input aria-label="模拟榜单数量" type="number" min="1" max="100" step="1" value={form.limit} onChange={e=>setForm(f=>({...f,limit:e.target.value}))} className={`${control} mt-1 w-full`} /></label></div>
   <div className="grid gap-3 sm:grid-cols-3">{Object.entries(TUNING_FILTERS).map(([key,label])=><label key={key} className="text-xs text-muted">{label}<input aria-label={label} type="number" min="0" step="any" placeholder="不限" value={form.filters[key as keyof typeof TUNING_FILTERS]} onChange={e=>setForm(f=>({...f,filters:{...f.filters,[key]:e.target.value}}))} className={`${control} mt-1 w-full`} /></label>)}</div>
  </fieldset>
  <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-muted">最终展示排序<select aria-label="最终展示排序" className={`${control} ml-2`} value={form.finalSort} onChange={e=>setForm(f=>({...f,finalSort:e.target.value as TuningForm['finalSort']}))}><option value="mixed">按权重混排顺序</option>{Object.entries(TUNING_METRICS).filter(([key])=>key!=='upstream_rank').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <select aria-label="最终排序方向" disabled={form.finalSort==='mixed'} className={control} value={form.finalDirection} onChange={e=>setForm(f=>({...f,finalDirection:e.target.value as Direction}))}><option value="desc">降序 / 新到旧</option><option value="asc">升序 / 旧到新</option></select>
   <p className="text-xs text-muted">先按权重确定入选名单，再按所选指标展示；缺失排序指标的候选放在末尾。</p>
  </div>
  {parsed.errors.length>0 && <div role="alert" className="rounded border border-down/30 p-3 text-sm text-down">{parsed.errors.map((error,i)=><p key={`${i}:${error}`}>{error}</p>)}<p>请修正参数后查看预览；当前不能保存或导出。</p></div>}
  <fieldset className="space-y-3 rounded-lg border border-border p-4"><legend className="px-1 font-medium">保存方案，交给产品经理跟进</legend>
   <div className="flex flex-wrap gap-2"><input aria-label="方案名称" value={name} maxLength={120} onChange={e=>setName(e.target.value)} className={`${control} min-w-[240px] flex-1`} /><select aria-label="已保存方案" className={control} value="" onChange={e=>{const plan=plans.find(p=>p.id===e.target.value);if(plan){importVersion.current++;setForm(structuredClone(plan.form));setName(plan.name);setNotes(plan.notes);setNotice('已加载参数，应用于当前锁定批次；历史结果请查看当时导出的文件。');}}}><option value="">加载本机保存的方案</option>{plans.map(p=><option value={p.id} key={p.id}>{p.name} · {new Date(p.createdAt).toLocaleString()}</option>)}</select></div>
   <textarea aria-label="方案备注" value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)} placeholder="记录调整目的、观察结论和待产品经理确认的问题" rows={2} className={`${control} w-full`} />
   <div className="flex flex-wrap gap-2"><button type="button" disabled={!config} className={button} onClick={savePlan}>保存方案到本机</button><button type="button" disabled={!config} className={button} onClick={download}>导出方案与候选快照</button><button type="button" disabled={!config} className={button} onClick={copySummary}>复制评审摘要</button><label className={`${button} cursor-pointer`}>导入评审文件<input aria-label="导入评审文件" type="file" accept="application/json,.json" className="sr-only" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}} /></label></div>
   <p className="text-xs text-muted">本机最多保留 20 份参数方案；导出文件包含参数、完整候选快照、模拟排序及分配原因，产品经理可在本页导入并复现。不会自动发送给其他人。</p>
   {notice && <p role="status" className="text-sm">{notice}</p>}{showSummary&&summary&&<textarea aria-label="评审摘要" readOnly value={summary} rows={8} className={`${control} w-full`} />}
  </fieldset>
  {result && <>
   <div className="text-sm space-y-1"><h3 className="font-medium">模拟榜单预览</h3><p>{result.sourceCount} 个去重地址 → 范围内 {result.scopeCount} → 筛选后 {result.filteredCount} → 命中启用通道 {result.matchableCount} → 入选 {result.rows.length} / {config!.limit}</p><p className="text-muted">其中 {result.missingMetricCount} 个候选因开启筛选所需的指标缺失而排除。每币只占一个名额，“分配通道”表示本次由哪路取出；同币可以命中多路。</p>{form.scope==='all'&&<p className="text-down">当前包含未通过后端筛选的地址，所有结果仅用于研究。</p>}</div>
   <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label="权重目标与实际分配"><thead className="text-muted"><tr>{['通道','目标权重','满足条件候选','实际分配','实际占比'].map(x=><th key={x} className="p-2 font-medium">{x}</th>)}</tr></thead><tbody>{TUNING_CHANNELS.map(k=><tr key={k} className="border-t border-border"><td className="p-2">{discoveryChannelLabels[k]}</td><td className="p-2">{result.allocation[k].targetPercent}%</td><td className="p-2">{result.allocation[k].available}</td><td className="p-2">{result.allocation[k].selected}</td><td className="p-2">{result.allocation[k].actualPercent.toFixed(1)}%</td></tr>)}</tbody></table></div>
   <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm" aria-label="模拟榜单"><thead className="text-muted"><tr>{['预览名次','代币 / 地址','分配通道 / 原混排名次','来源证据','后端批次状态','快照价格','5m 成交额','流动性','FDV'].map(x=><th key={x} className="p-2 font-medium">{x}</th>)}</tr></thead><tbody>{result.rows.map(r=><tr key={`${r.token.chain}:${r.token.address}`} className="border-t border-border align-top"><td className="p-2">{r.rank}</td><td className="min-w-[230px] max-w-[310px] p-2"><p className="font-medium">{r.token.symbol||'未命名'} · {r.token.chain}</p><p className="select-text break-all font-mono text-xs text-muted">{r.token.address}</p></td><td className="p-2">{discoveryChannelLabels[r.assignedChannel]} · #{r.mixedRank}</td><td className="p-2"><DiscoveryReasons discovery={{channels:r.token.sources.map(s=>s.code),reasons:r.token.sources}} /></td><td className="p-2">{discoverySelectionLabels[r.token.selection_state]??'未知'}</td><td className="p-2">{fmtPrice(r.token.price)}</td><td className="p-2">{fmtCompact(r.token.volume_5m)}</td><td className="p-2">{fmtCompact(r.token.liquidity)}</td><td className="p-2">{fmtCompact(r.token.fdv)}</td></tr>)}</tbody></table>{result.rows.length===0&&<p className="p-3 text-muted">当前条件下没有可分配的候选，请检查筛选条件、通道权重或候选范围。</p>}</div>
  </>}
 </section>;
}
