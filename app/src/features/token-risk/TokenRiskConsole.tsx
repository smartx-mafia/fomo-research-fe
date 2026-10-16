'use client';

import {FormEvent, useEffect, useMemo, useState} from 'react';
import {Activity, AlertTriangle, Check, ChevronDown, ChevronRight, CircleDot, Clock3, Database, RefreshCw, Search, ShieldCheck, ShieldQuestion} from 'lucide-react';
import {ApiError} from '@/api/envelope';
import {getTokenRisk, type GetRiskReply} from '@/api/token-risk';
import {BUSINESS_API_BASE, sameBusinessEnvironment} from '@/config';
import {riskItemCopy, riskSource, type RiskAssessment, type RiskSourceStatus} from '@/lib/risk-assessment';

const DEFAULT_CHAIN = 'solana';
const DEFAULT_ADDRESS = 'So11111111111111111111111111111111111111112';
const SMARTX_TEST_API_BASE = 'https://sm-test-api.smartx.io';

const providerNames: Record<string, string> = {codex: 'Codex', goplus: 'GoPlus', rugcheck: 'RugCheck'};
const providerDescriptions: Record<string, string> = {
  codex: '市场与流动性风险', goplus: '合约与交易安全', rugcheck: 'Solana 权限与流动性',
};

function providerName(source: string) { return providerNames[source] ?? riskSource(source); }
function dateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'medium'}).format(date);
}
function relative(value: string | null) {
  if (!value) return '暂无时间';
  const delta = Number(value) - Date.now();
  if (!Number.isFinite(delta)) return '暂无时间';
  const minutes = Math.round(Math.abs(delta) / 60_000);
  if (minutes < 1) return delta >= 0 ? '不到 1 分钟后' : '刚刚';
  if (minutes < 60) return delta >= 0 ? `${minutes} 分钟后` : `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return delta >= 0 ? `${hours} 小时后` : `${hours} 小时前`;
}
function tone(status: string) {
  if (status === 'ok') return {label: '可用', classes: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-300'};
  if (status === 'partial') return {label: '部分可用', classes: 'border-amber-300/25 bg-amber-300/10 text-amber-200', dot: 'bg-amber-300'};
  if (status === 'pending') return {label: '等待中', classes: 'border-sky-300/25 bg-sky-300/10 text-sky-200', dot: 'bg-sky-300'};
  return {label: status === 'error' ? '异常' : '不可用', classes: 'border-rose-300/25 bg-rose-300/10 text-rose-200', dot: 'bg-rose-300'};
}
function gradeMeta(grade = 0) {
  if (grade >= 5) return {label: '极高风险', color: 'text-rose-300', ring: 'border-rose-400/30 bg-rose-400/10'};
  if (grade >= 4) return {label: '高风险', color: 'text-orange-300', ring: 'border-orange-400/30 bg-orange-400/10'};
  if (grade >= 2) return {label: '需关注', color: 'text-amber-200', ring: 'border-amber-300/30 bg-amber-300/10'};
  if (grade === 1) return {label: '低风险', color: 'text-emerald-300', ring: 'border-emerald-400/30 bg-emerald-400/10'};
  return {label: '未判定', color: 'text-slate-300', ring: 'border-white/10 bg-white/[.03]'};
}
function itemGradeMeta(grade: number) {
  if (grade === 5) return {label: 'R5', title: 'R5 · 严重风险', classes: 'border-rose-400/25 bg-rose-400/10 text-rose-200'};
  if (grade === 4) return {label: 'R4', title: 'R4 · 高风险', classes: 'border-orange-400/25 bg-orange-400/10 text-orange-200'};
  if (grade === 3) return {label: 'R3', title: 'R3 · 风险警告', classes: 'border-amber-300/25 bg-amber-300/10 text-amber-100'};
  if (grade === 2) return {label: 'R2', title: 'R2 · 风险提示', classes: 'border-sky-300/25 bg-sky-300/10 text-sky-100'};
  return {label: 'R?', title: '风险等级未判定', classes: 'border-white/10 bg-white/[.04] text-white/45'};
}

const volumeRiskRules = [
  {name: '买卖成交额严重失衡', grade: 3, basis: '5m / 1h / 24h 方向成交额'},
  {name: '少量地址贡献大部分成交量', grade: 4, basis: '成交贡献与独立地址覆盖'},
  {name: '疑似刷量或循环交易', grade: 4, basis: '地址关系、金额与时间序列'},
  {name: '成交量 / 流动性异常', grade: 3, basis: '主池成交额与流动性比率'},
  {name: '短时成交量突增', grade: 3, basis: '5m 相对 1h / 24h 基线'},
  {name: '价格与成交量背离', grade: 3, basis: '价格变化与成交量联合判断'},
] as const;

export function VolumeRiskMatrix() {
  return <section aria-labelledby="volume-risk-title" className="mt-8 overflow-hidden rounded-2xl border border-white/[.08] bg-[#101513]">
    <div className="flex flex-col gap-3 border-b border-white/[.07] p-5 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-sky-300/80"/><h2 id="volume-risk-title" className="font-semibold text-white">成交量候选规则</h2></div><p className="mt-1.5 text-xs leading-5 text-white/55">以下是尚未接入后端的规则建议，不是当前代币的检测结果，也不影响本次综合结论。</p></div>
      <div className="flex flex-wrap gap-2 sm:justify-end"><span className="rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[11px] text-white/55">映射草案 · 2026-10-13</span><span className="rounded-full border border-sky-300/15 bg-sky-300/[.06] px-2.5 py-1 text-[11px] text-sky-200/80">参考口径：厂家主交易对</span></div>
    </div>
    <div className="grid lg:grid-cols-2">
      {volumeRiskRules.map((rule, index) => {
        return <div key={rule.name} className={`flex items-center gap-3 border-white/[.06] px-5 py-3.5 ${index > 0 ? 'border-t lg:border-t-0' : ''} ${index >= 2 ? 'lg:border-t' : ''} ${index % 2 === 1 ? 'lg:border-l' : ''}`}>
          <span aria-label={`候选等级 R${rule.grade}`} className="shrink-0 rounded-md border border-white/10 bg-white/[.04] px-2 py-1 font-mono text-[10px] font-semibold text-white/55">候选 R{rule.grade}</span>
          <div className="min-w-0 flex-1"><p className="text-sm text-white/80">{rule.name}</p><p className="mt-0.5 break-words text-[11px] leading-4 text-white/55">{rule.basis}</p></div>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[.03] px-2 py-0.5 text-[10px] text-white/55">未接入</span>
        </div>;
      })}
    </div>
    <p className="border-t border-white/[.06] px-5 py-3 text-[11px] leading-5 text-white/55">本草案尚未形成后端策略版本。若后端后续接入，成交量按厂家选定主交易对计算，并非全池或全链聚合；数据缺失不得当作零成交。最终等级仍以后端返回为准。</p>
  </section>;
}

export function ProviderCard({source, risk}: {source: RiskSourceStatus; risk: RiskAssessment}) {
  const [expanded, setExpanded] = useState(false);
  const state = tone(source.status);
  const items = risk.items.filter((item) => item.displaySource === source.source);
  const visibleItems = expanded ? items : items.slice(0, 4);
  return <article className="group overflow-hidden rounded-2xl border border-white/[.08] bg-[#101513] shadow-[0_18px_50px_rgba(0,0,0,.18)] transition hover:border-emerald-300/20">
    <div className="border-b border-white/[.07] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[.04] font-mono text-sm font-bold text-emerald-200">{providerName(source.source).slice(0, 2).toUpperCase()}</div>
          <div><h2 className="font-semibold tracking-tight text-white">{providerName(source.source)}</h2><p className="mt-0.5 text-xs text-white/40">{providerDescriptions[source.source] ?? '第三方风险数据'}</p></div>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${state.classes}`}><i className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />{state.label}</span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-xs">
        <div><dt className="text-white/35">最近观测</dt><dd className="mt-1 font-medium text-white/75" title={dateTime(source.observedAtMs)}>{relative(source.observedAtMs)}</dd></div>
        <div><dt className="text-white/35">检查覆盖</dt><dd className="mt-1 font-medium text-white/75">{source.checksComplete ? '完整' : '不完整'}</dd></div>
      </dl>
    </div>
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-[.16em] text-white/35">风险发现</span><span className="font-mono text-xs text-white/35">{items.length}</span></div>
      {items.length ? <ul className="space-y-2">{visibleItems.map((item) => {
        const [title, detail] = riskItemCopy(item);
        const mappedGrade = itemGradeMeta(item.grade);
        return <li key={item.code} className="rounded-xl border border-white/[.06] bg-black/15 p-3"><div className="flex gap-2"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${item.grade >= 4 ? 'text-orange-300' : 'text-amber-200'}`} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-white/85">{title}</p><span title={mappedGrade.title} aria-label={mappedGrade.title} className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${mappedGrade.classes}`}>{mappedGrade.label}</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{detail}</p></div></div></li>;
      })}</ul> : <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/10 text-center"><Check className="h-5 w-5 text-emerald-300/70"/><p className="mt-2 text-sm text-white/55">未报告风险项</p><p className="mt-1 text-xs text-white/30">不代表安全认证</p></div>}
      {items.length > 4 ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-white/50 transition hover:border-emerald-300/20 hover:bg-emerald-300/[.05] hover:text-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
        {expanded ? '收起风险项' : `展开其余 ${items.length - 4} 项`}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button> : null}
    </div>
    <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-white/[.06] bg-black/10 px-5 py-3 text-[11px] text-white/30"><span className="truncate font-mono" title={source.reportHash}>{source.reportHash ? `报告 ${source.reportHash.slice(0, 12)}…` : '未提供报告哈希'}</span><span title={dateTime(source.validUntilMs)}>有效期 {relative(source.validUntilMs)}</span></div>
  </article>;
}

function ErrorNotice({error}: {error: unknown}) {
  const api = error instanceof ApiError ? error : null;
  return <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/[.07] p-5 text-sm text-rose-100"><p className="font-semibold">查询失败</p><p className="mt-1 text-rose-100/65">{error instanceof Error ? error.message : '无法读取风控结果'}</p>{api?.traceID || api?.sentRequestID ? <p className="mt-3 font-mono text-xs text-rose-100/40">trace: {api.traceID ?? api.sentRequestID}</p> : null}</div>;
}

export default function TokenRiskConsole() {
  const [chain, setChain] = useState(DEFAULT_CHAIN);
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [query, setQuery] = useState({chain: DEFAULT_CHAIN, address: DEFAULT_ADDRESS});
  const [reply, setReply] = useState<GetRiskReply>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined); setReply(undefined);
    if (!sameBusinessEnvironment(BUSINESS_API_BASE, SMARTX_TEST_API_BASE)) {
      setError(new Error(`环境配置错误：代币风控台只允许连接 smartx-test，当前为 ${BUSINESS_API_BASE}`));
      setLoading(false);
      return () => controller.abort();
    }
    getTokenRisk(query.chain, query.address, undefined, controller.signal).then(setReply).catch((reason) => {
      if (!controller.signal.aborted) setError(reason);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, refreshKey]);
  const risk = reply?.risk.assessment;
  const grade = gradeMeta(risk?.grade);
  const flagged = risk?.items.filter((item) => item.grade >= 2).length ?? 0;
  const ready = risk?.sources.filter((source) => source.status === 'ok').length ?? 0;
  const sourceOrder = useMemo(() => [...(risk?.sources ?? [])].sort((a, b) => ['codex', 'goplus', 'rugcheck'].indexOf(a.source) - ['codex', 'goplus', 'rugcheck'].indexOf(b.source)), [risk]);
  function submit(event: FormEvent) { event.preventDefault(); setQuery({chain: chain.trim().toLowerCase(), address: address.trim()}); }

  return <main className="min-h-screen bg-[#080b0a] text-slate-100 [background-image:radial-gradient(circle_at_15%_0%,rgba(52,211,153,.09),transparent_28%),radial-gradient(circle_at_90%_10%,rgba(56,189,248,.06),transparent_24%)]">
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 lg:px-10">
      <header className="flex flex-col gap-5 border-b border-white/[.07] pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[.2em] text-emerald-300/70"><ShieldCheck className="h-4 w-4"/>Risk intelligence</div><h1 className="text-3xl font-semibold tracking-[-.04em] text-white sm:text-4xl">代币风控汇总</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/40">对照各数据厂家的最新检查状态、风险发现和数据时效。结论来自 SmartX 后端统一决策。</p></div>
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-3 py-1.5 text-xs text-emerald-200/70"><CircleDot className="h-3.5 w-3.5"/><span>smartx-test</span><span className="text-emerald-200/25">·</span><span className="max-w-48 truncate font-mono text-[10px]">{BUSINESS_API_BASE}</span></div>
      </header>

      <form onSubmit={submit} className="mt-6 grid gap-3 rounded-2xl border border-white/[.08] bg-[#101513]/90 p-3 shadow-2xl shadow-black/15 md:grid-cols-[150px_1fr_auto]">
        <label className="rounded-xl border border-white/[.07] bg-black/20 px-3 py-2"><span className="block text-[10px] uppercase tracking-wider text-white/30">网络</span><select value={chain} onChange={(e) => setChain(e.target.value)} className="mt-1 w-full bg-transparent text-sm text-white outline-none"><option className="bg-[#101513]" value="solana">Solana</option><option className="bg-[#101513]" value="base">Base</option><option className="bg-[#101513]" value="bsc">BSC</option><option className="bg-[#101513]" value="ethereum">Ethereum</option><option className="bg-[#101513]" value="robinhood">Robinhood</option></select></label>
        <label className="rounded-xl border border-white/[.07] bg-black/20 px-3 py-2 focus-within:border-emerald-300/30"><span className="block text-[10px] uppercase tracking-wider text-white/30">Token address</span><input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} className="mt-1 w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/20" placeholder="输入代币合约地址" /></label>
        <button disabled={!address.trim() || loading} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 text-sm font-semibold text-[#06110d] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"><Search className="h-4 w-4"/>查询风控</button>
      </form>

      {error ? <div className="mt-6"><ErrorNotice error={error}/></div> : null}
      <section aria-busy={loading} className={`transition-opacity ${loading ? 'opacity-45' : 'opacity-100'}`}>
        {reply && risk ? <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className={`rounded-2xl border p-5 ${grade.ring}`}><div className="flex items-center justify-between"><span className="text-xs text-white/40">SmartX 综合结论</span><ShieldQuestion className={`h-5 w-5 ${grade.color}`}/></div><p className={`mt-5 text-2xl font-semibold ${grade.color}`}>{grade.label}</p><p className="mt-1 font-mono text-xs text-white/30">Risk grade R{risk.grade || '—'}</p></div>
            <div className="rounded-2xl border border-white/[.08] bg-[#101513] p-5"><div className="flex items-center justify-between"><span className="text-xs text-white/40">厂家可用性</span><Database className="h-5 w-5 text-sky-300/70"/></div><p className="mt-5 text-2xl font-semibold text-white">{ready}<span className="text-base font-normal text-white/25"> / {risk.sources.length}</span></p><p className="mt-1 text-xs text-white/30">状态正常的数据源</p></div>
            <div className="rounded-2xl border border-white/[.08] bg-[#101513] p-5"><div className="flex items-center justify-between"><span className="text-xs text-white/40">需关注项目</span><AlertTriangle className="h-5 w-5 text-amber-200/70"/></div><p className="mt-5 text-2xl font-semibold text-white">{flagged}</p><p className="mt-1 text-xs text-white/30">R2 及以上风险发现</p></div>
            <div className="rounded-2xl border border-white/[.08] bg-[#101513] p-5"><div className="flex items-center justify-between"><span className="text-xs text-white/40">交易建议</span><ChevronRight className="h-5 w-5 text-white/35"/></div><p className="mt-5 text-2xl font-semibold capitalize text-white">{risk.buyAction === 'allow' ? '允许' : risk.buyAction === 'confirm' ? '需确认' : risk.buyAction === 'block' ? '阻止买入' : '不可用'}</p><p className="mt-1 font-mono text-xs text-white/30">{risk.mode || 'unknown'} mode</p></div>
          </div>
          <div className="mt-8 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">厂家检查明细</h2><p className="mt-1 text-xs text-white/35">厂家原始结果由后端归一化；页面不基于原始字段自行改写风险等级。</p></div><button onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 hover:bg-white/[.04] disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}/>刷新</button></div>
          {sourceOrder.length ? <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{sourceOrder.map((source) => <ProviderCard key={source.source} source={source} risk={risk}/>)}</div> : <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">后端尚未返回厂家状态。这不代表代币安全。</div>}
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[.06] py-5 text-[11px] text-white/30"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5"/>策略 {risk.policyVersion || '—'}</span><span className="font-mono">decision {risk.decisionVersion || '—'}</span><span className="font-mono">{reply.chain}:{reply.address}</span></div>
        </> : !loading && !error ? <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-white/40">暂无风控数据</div> : null}
      </section>
      <VolumeRiskMatrix />
    </div>
  </main>;
}
