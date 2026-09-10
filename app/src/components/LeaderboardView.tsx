'use client';

import {useEffect, useState} from 'react';
import useSWR from 'swr';
import {getLeaderboard, getLeaderboardMeta, type LeaderboardEntry, type LeaderboardQuery} from '@/api/leaderboard';
import {ApiError} from '@/api/envelope';
import {decimalSign, formatDecimalExact, marketValueFromBaseUnits} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';

const chainName = (chain: string) => chain === 'sol' ? 'Solana' : chainLabel(chain);
const windowName = (window: string) => ({'1d': '24H', '7d': '7D', '30d': '30D', all: '全部'}[window] ?? window.toUpperCase());
const metricName = (metric: string) => ({total_profit: '总收益', realized_profit: '已实现收益', roi: 'ROI'}[metric] ?? metric);
function money(value?: string) {
  if (value === undefined || value === '') return '—';
  const text = formatDecimalExact(value, 2);
  return `${decimalSign(value) === -1 ? '-' : ''}$${text.replace(/^-/, '')}`;
}
function percent(value?: string) {
  return value ? `${formatDecimalExact(marketValueFromBaseUnits('100', 0, value), 2)}%` : '—';
}
function tone(value?: string) {return decimalSign(value) === 1 ? 'text-up' : decimalSign(value) === -1 ? 'text-down' : 'text-muted';}
function age(value?: string) {
  const at = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}

function WalletRow({entry, query}: {entry: LeaderboardEntry; query: LeaderboardQuery}) {
  const metric = entry.metric_value;
  return <tr className="border-t border-border transition hover:bg-surface-2/60">
    <td className="px-4 py-3"><span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-xs font-bold ${entry.rank <= 3 ? 'bg-accent/15 text-accent' : 'text-muted'}`}>{entry.rank}</span></td>
    <td className="px-3 py-3"><a href={`/smart-money/${encodeURIComponent(query.chain)}/${encodeURIComponent(entry.address)}`} className="font-mono text-sm text-foreground hover:text-accent">{shortAddr(entry.address, 8, 6)}</a><p className="mt-1 text-[10px] text-muted">{entry.address}</p></td>
    <td className={`px-3 py-3 text-right font-mono text-xs ${tone(entry.total_profit)}`}>{money(entry.total_profit)}</td>
    <td className={`px-3 py-3 text-right font-mono text-xs ${tone(entry.realized_profit)}`}>{money(entry.realized_profit)}</td>
    <td className={`px-3 py-3 text-right font-mono text-xs ${tone(entry.unrealized_profit)}`}>{money(entry.unrealized_profit)}</td>
    <td className="px-3 py-3 text-right font-mono text-xs text-muted">{money(entry.total_cost)}</td>
    <td className="px-3 py-3 text-right font-mono text-xs"><span className="text-up">{entry.buy ?? 0}</span><span className="text-muted"> / </span><span className="text-down">{entry.sell ?? 0}</span></td>
    <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${tone(metric)}`}>{query.metric === 'roi' ? percent(metric) : money(metric)}</td>
  </tr>;
}

export function LeaderboardView() {
  const meta = useSWR('leaderboard-meta-v1', () => getLeaderboardMeta(), {shouldRetryOnError: false});
  const [selection, setSelection] = useState<LeaderboardQuery>();
  useEffect(() => {
    if (!meta.data || selection) return;
    const [chain] = meta.data.chains, [window] = meta.data.windows, [metric] = meta.data.metrics;
    if (chain && window && metric) setSelection({chain, window, metric});
  }, [meta.data, selection]);
  const board = useSWR(selection ? ['leaderboard-v1', selection.chain, selection.window, selection.metric] : null,
    ([, chain, window, metric]) => getLeaderboard({chain, window, metric}),
    {shouldRetryOnError: false, revalidateOnFocus: true});
  const patch = (next: Partial<LeaderboardQuery>) => setSelection((current) => current ? {...current, ...next} : current);
  const apiError = (meta.error ?? board.error) instanceof ApiError ? meta.error ?? board.error as ApiError : undefined;

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">聪明钱榜单</h1><p className="mt-1 text-sm text-muted">追踪多链高盈利钱包，按收益排名；点击地址查看持仓与交易。</p></div>
      <div className="flex items-center gap-3 text-xs text-muted">{board.data?.updated_at ? <span>更新于 {age(board.data.updated_at)}</span> : null}<button type="button" disabled={board.isValidating || !selection} onClick={() => void board.mutate()} className="rounded-md border border-border px-3 py-2 text-accent disabled:opacity-50">{board.isValidating ? '刷新中…' : '刷新'}</button></div></header>
    {meta.error && !meta.data ? <ErrorPanel error={meta.error} retry={() => void meta.mutate()} /> : null}
    {meta.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-surface" /> : null}
    {meta.data && selection ? <section aria-label="Leaderboard filters" className="space-y-4">
      <div className="flex flex-wrap gap-2">{meta.data.chains.map((chain) => <button key={chain} type="button" onClick={() => patch({chain})} aria-pressed={selection.chain === chain} className={`rounded-full border px-3.5 py-1.5 text-sm ${selection.chain === chain ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border bg-surface text-muted'}`}>{chainName(chain)}</button>)}</div>
      <div className="flex flex-wrap gap-5"><Filter label="时间窗" values={meta.data.windows} active={selection.window} display={windowName} select={(window) => patch({window})} /><Filter label="排序" values={meta.data.metrics} active={selection.metric} display={metricName} select={(metric) => patch({metric})} /></div>
    </section> : null}
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      {board.error ? <ErrorPanel error={board.error} retry={() => void board.mutate()} /> : null}
      {board.isLoading && !board.data ? <p className="p-10 text-center text-sm text-muted">正在加载榜单…</p> : null}
      {board.data && board.data.list.length === 0 ? <p className="p-10 text-center text-sm text-muted">该筛选组合暂无榜单数据。</p> : null}
      {board.data?.list.length && selection ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">#</th><th className="px-3 py-3">钱包地址</th><th className="px-3 py-3 text-right">总收益</th><th className="px-3 py-3 text-right">已实现</th><th className="px-3 py-3 text-right">未实现</th><th className="px-3 py-3 text-right">成本</th><th className="px-3 py-3 text-right">交易 买/卖</th><th className="px-4 py-3 text-right text-accent">{metricName(board.data.metric)} ↓</th></tr></thead><tbody>{board.data.list.map((entry) => <WalletRow key={entry.address} entry={entry} query={selection} />)}</tbody></table></div> : null}
      {board.data?.list.length ? <footer className="flex justify-between border-t border-border px-4 py-3 text-xs text-muted"><span>共 {board.data.count} 个钱包</span><span>{chainName(board.data.chain)} · {windowName(board.data.window)} · {metricName(board.data.metric)}</span></footer> : null}
    </section>
    {apiError?.traceID ? <p className="text-xs text-muted">Trace {apiError.traceID}</p> : null}
  </div>;
}

function Filter({label, values, active, display, select}: {label: string; values: string[]; active: string; display: (value: string) => string; select: (value: string) => void}) {
  return <div className="flex items-center gap-2"><span className="text-xs text-muted">{label}</span><div className="flex rounded-lg border border-border bg-surface p-1">{values.map((value) => <button key={value} type="button" onClick={() => select(value)} aria-pressed={active === value} className={`rounded-md px-3 py-1 text-sm ${active === value ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{display(value)}</button>)}</div></div>;
}
function ErrorPanel({error, retry}: {error: unknown; retry: () => void}) {
  const api = error instanceof ApiError ? error : undefined;
  return <div role="alert" className="m-4 rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">榜单加载失败。{error instanceof Error ? error.message : ''}{api ? ` · code ${api.code} · trace ${api.traceID ?? 'unavailable'}` : ''}<button type="button" onClick={retry} className="ml-3 underline">重试</button></div>;
}
