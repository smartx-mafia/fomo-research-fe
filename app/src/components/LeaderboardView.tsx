'use client';

import {rankingBasisLabel} from '@/api/smartmoney-accounting';

import {memo, useState} from 'react';
import {ApiError} from '@/api/envelope';
import type {UnifiedLeaderboardEntry, UnifiedLeaderboardWindow, UnifiedLeaderboardDimension} from '@/api/leaderboard-new';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';
import {normalizeSmartMoneySourceChain} from '@/lib/smartmoney-identity';
import {useLeaderboard, useLeaderboardScope} from '@/lib/use-leaderboard';

const allWindows: UnifiedLeaderboardWindow[] = ['1d', '7d', '30d', 'all'];
const windowName = (window: UnifiedLeaderboardWindow) => ({'1d': '24H', '7d': '7D', '30d': '30D', all: '全部'}[window]);
const dimensionName = {ALL: '全部', SmartX: 'SmartX', Global: 'Global'};

function money(value: string | undefined) {
  if (value === undefined || value === '') return '—';
  const formatted = formatDecimalExact(value, 2);
  return `${decimalSign(value) === -1 ? '-' : ''}$${formatted.replace(/^-/, '')}`;
}

function timestamp(value?: number | string) {
  if (value === undefined || value === '') return undefined;
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function age(value?: number | string) {
  const seconds = timestamp(value);
  if (!seconds) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - seconds * 1000) / 60_000));
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}

function rowHref(entry: UnifiedLeaderboardEntry): string {
  const identity = entry.identity;
  if (identity.type === 'smartx_user') return `/user?identifier=${encodeURIComponent(identity.id)}`;
  if (identity.type === 'external_user') return `/smart-money?subject_id=${encodeURIComponent(identity.id)}`;
  const params = new URLSearchParams({namespace: identity.namespace, wallet_address: identity.address});
  const sourceChain = entry.chains.map((chain) => normalizeSmartMoneySourceChain(chain, identity.namespace)).find(Boolean);
  if (sourceChain) params.set('source_chain', sourceChain);
  return `/smart-money?${params.toString()}`;
}

function LeaderboardAvatar({url, name}: {url?: string; name: string}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img src={url} alt="" width={36} height={36} loading="lazy" decoding="async"
      onError={() => setFailed(true)} className="size-9 shrink-0 rounded-full bg-surface-2 object-cover" />;
  }
  return <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
    {Array.from(name.trim())[0]?.toUpperCase() || '?'}
  </span>;
}

const LeaderboardRow = memo(function LeaderboardRow({entry}: {entry: UnifiedLeaderboardEntry}) {
  const sign = decimalSign(entry.total_profit_usd) ?? 0;
  const display = entry.profile.display_name?.trim() || entry.profile.username?.trim() ||
    (entry.identity.type !== 'wallet' ? entry.identity.id : entry.identity.address);
  const lastObserved = timestamp(entry.snapshot_at);
  return <tr className="border-t border-border transition hover:bg-surface-2/60">
    <td className="px-4 py-3"><span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-xs font-bold ${entry.rank >= 1 && entry.rank <= 3 ? 'bg-accent/15 text-accent' : 'text-muted'}`}>{entry.rank > 0 ? entry.rank : entry.cohort_rank && entry.cohort_rank > 0 ? `组内 ${entry.cohort_rank}` : '—'}</span></td>
    <td className="px-3 py-3"><div className="flex items-start gap-3">
      <LeaderboardAvatar key={entry.profile.avatar_url} url={entry.profile.avatar_url?.trim()} name={display} />
      <div className="min-w-0"><a href={rowHref(entry)} className="font-medium text-foreground hover:text-accent">{display}</a>
      {entry.identity.type !== 'wallet' ? <p className="mt-1 font-mono text-[10px] text-muted">{entry.identity.id}</p> : <p className="mt-1 break-all font-mono text-[10px] text-muted">{entry.identity.address}</p>}
      {entry.viewer?.state === 'available' && entry.viewer.remark ? <p className="mt-1 text-xs text-muted">备注：{entry.viewer.remark}</p> : null}
      {entry.rank === 0 ? <p className="mt-1 text-xs text-muted">{rankingBasisLabel(entry.ranking_basis_id || entry.accounting?.ranking_basis_id || entry.pnl_basis)}</p> : null}
      {entry.profile.x_handle ? <a className="mt-1 inline-block text-xs text-accent hover:underline" href={`https://x.com/${encodeURIComponent(entry.profile.x_handle)}`} target="_blank" rel="noreferrer">@{entry.profile.x_handle}</a> : null}
      </div></div></td>
    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{entry.identity.type === 'smartx_user' ? <span className="text-xs text-muted">SmartX</span> : null}{entry.platforms.map((platform) => <span key={platform} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{platform}</span>)}</div><p className="mt-1 text-[10px] text-muted">{entry.chains.length ? entry.chains.join(' · ') : entry.identity.type === 'smartx_user' ? '本站组合' : '链范围未知'}</p></td>
    <td className={`px-4 py-3 text-right font-mono text-sm font-semibold ${sign > 0 ? 'text-up' : sign < 0 ? 'text-down' : 'text-muted'}`}>{money(entry.total_profit_usd)}</td>
    <td className="px-3 py-3 text-right text-xs text-muted">{lastObserved ? new Date(lastObserved * 1000).toLocaleString() : '—'}</td>
  </tr>;
});

export function LeaderboardView() {
  const [selectedWindow, setWindow] = useState<UnifiedLeaderboardWindow>('7d');
  const [selectedDimension, setDimension] = useState<UnifiedLeaderboardDimension>('ALL');
  const scope = useLeaderboardScope();
  return <LeaderboardContent key={scope} selectedWindow={selectedWindow} selectedDimension={selectedDimension}
    setWindow={setWindow} setDimension={setDimension} />;
}

function LeaderboardContent({selectedWindow, selectedDimension, setWindow, setDimension}: {
  selectedWindow: UnifiedLeaderboardWindow;
  selectedDimension: UnifiedLeaderboardDimension;
  setWindow(value: UnifiedLeaderboardWindow): void;
  setDimension(value: UnifiedLeaderboardDimension): void;
}) {
  const {meta, board, refresh, window, dimension, authenticated} = useLeaderboard({window: selectedWindow, dimension: selectedDimension});
  const apiError = board.error instanceof ApiError ? board.error : meta.error instanceof ApiError ? meta.error : undefined;
  const mixedCohorts = board.data?.list.some((entry) => entry.rank === 0) ?? false;
  const supportedWindows = allWindows.filter((candidate) => !meta.data || meta.data.windows.includes(candidate));
  const previousFilter = !!board.data && (board.data.window !== window || board.data.dimension !== dimension);

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">收益榜单</h1><p className="mt-1 text-sm text-muted">{mixedCohorts ? '按收益口径分别排名；组间名次和总额不直接比较。' : '按所选周期的美元总收益排序，最多展示 100 名。'}</p></div>
      <div className="flex items-center gap-3 text-xs text-muted">{board.data?.updated_at ? <span>榜单 {age(board.data.updated_at)} 更新</span> : null}<button type="button" disabled={!meta.data} onClick={refresh} className="rounded-md border border-border px-3 py-2 text-accent disabled:opacity-50">{board.isValidating ? '刷新中…' : '刷新'}</button></div></header>
    <div role="note" className="rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-xs leading-5 text-muted">
      <p>{dimension === 'ALL' ? '全部榜单混合展示 SmartX 与外部用户收益，不同来源的覆盖范围和计算口径不同。' : dimension === 'SmartX' ? 'SmartX 收益来自本站账本的已发布成绩，详情页实时金额可能领先榜单。' : 'Global 展示外部用户的已发布收益，平台标签表示收录关系，不代表收益来源。'} 表内时间为各行成绩的数据时间。</p>
      {board.data?.stale ? <strong className="mt-1 block text-down">榜单构建已延迟，请谨慎参考。</strong> : null}
    </div>
    {meta.error && !meta.data ? <ErrorPanel error={meta.error} retry={() => void meta.mutate()} /> : null}
    {meta.isLoading ? <div className="h-10 animate-pulse rounded-xl bg-surface" /> : null}
    {meta.data ? <section aria-label="Leaderboard filters" className="flex flex-wrap items-center gap-5"><div className="flex items-center gap-2"><span className="text-xs text-muted">时间窗</span><div className="flex rounded-lg border border-border bg-surface p-1">{supportedWindows.map((candidate) => <button key={candidate} type="button" onClick={() => setWindow(candidate)} aria-pressed={window === candidate} className={`rounded-md px-3 py-1 text-sm ${window === candidate ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{windowName(candidate)}</button>)}</div></div><div aria-label="榜单维度" className="flex rounded-lg border border-border bg-surface p-1">{meta.data.dimensions.map((candidate) => <button key={candidate} type="button" onClick={() => setDimension(candidate)} aria-pressed={dimension === candidate} className={`rounded-md px-3 py-1 text-sm ${dimension === candidate ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{dimensionName[candidate]}</button>)}</div></section> : null}
    {previousFilter && board.data ? <p role="status" className="text-xs text-muted">{board.error ? '更新失败，' : '正在更新，'}暂时显示 {windowName(board.data.window)} / {dimensionName[board.data.dimension]} 的上次数据。</p> : null}
    {!previousFilter && board.isValidating && board.data ? <p role="status" className="text-xs text-muted">正在更新，当前显示该筛选的缓存数据…</p> : null}
    {!previousFilter && board.error && board.data ? <p role="status" className="text-xs text-down">更新失败，当前显示上次成功获取的数据。</p> : null}
    {!previousFilter && dimension === 'SmartX' && board.data ? <div className="flex gap-6 rounded-lg border border-border p-4 text-sm"><span>参与人数：{board.data.participant_count ?? '—'}</span>{authenticated ? <><span>我的排名：{board.data.viewer_rank ? `#${board.data.viewer_rank}` : '暂无排名'}</span><span>我的收益：{money(board.data.viewer_profit_usd)}</span></> : null}</div> : null}
    <section aria-busy={board.isValidating} className="overflow-hidden rounded-xl border border-border bg-surface">
      {board.error ? <ErrorPanel error={board.error} retry={apiError?.code === 100109 ? () => {void meta.mutate().catch(() => {});} : refresh} /> : null}
      {!board.data && !board.error && !meta.error ? <p className="p-10 text-center text-sm text-muted">正在加载榜单…</p> : null}
      {board.data && board.data.list.length === 0 ? <p className="p-10 text-center text-sm text-muted">该筛选暂无可展示的收益数据。</p> : null}
      {board.data?.list.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">#</th><th className="px-3 py-3">用户 / 主体</th><th className="px-3 py-3">平台 / 链</th><th className="px-4 py-3 text-right">总收益</th><th className="px-3 py-3 text-right">数据时间</th></tr></thead><tbody>{board.data.list.map((entry) => <LeaderboardRow key={`${entry.identity.type}:${entry.identity.id || `${entry.identity.namespace}:${entry.identity.address}`}:${entry.identity_revision}`} entry={entry} />)}</tbody></table></div> : null}
      {board.data?.list.length ? <footer className="flex justify-between border-t border-border px-4 py-3 text-xs text-muted"><span>本次返回 {board.data.count} 名</span><span>{board.data.dimension} · {windowName(board.data.window)} · USD</span></footer> : null}
    </section>
    {apiError?.traceID ? <p className="text-xs text-muted">Trace {apiError.traceID}</p> : null}
  </div>;
}

function ErrorPanel({error, retry}: {error: unknown; retry: () => void}) {
  const api = error instanceof ApiError ? error : undefined;
  const unavailable = api?.code === 500102;
  const unauthenticated = api?.code === 400000;
  const timeout = error instanceof Error && error.name === 'TimeoutError';
  const message = timeout ? '请求超时，请重试。' : unavailable ? '榜单暂不可用，请稍后重试。' : unauthenticated ? '登录状态已失效，请重新登录。' : api?.code === 100109 ? '筛选已不可用，请刷新筛选选项。' : api?.code === 420000 ? '请求过于频繁，请稍后重试。' : '榜单加载失败。';
  return <div role="alert" className="m-4 rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">{message}{api?.traceID ? ` · Trace ${api.traceID}` : ''}{unauthenticated ? <a href="/login" className="ml-3 underline">重新登录</a> : <button type="button" onClick={retry} className="ml-3 underline">重试</button>}</div>;
}
