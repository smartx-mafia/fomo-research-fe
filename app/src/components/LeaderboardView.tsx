'use client';

import {Fragment, useState} from 'react';
import useSWR from 'swr';
import {ApiError} from '@/api/envelope';
import {getUnifiedLeaderboard, getUnifiedLeaderboardMeta, type UnifiedLeaderboardEntry, type UnifiedLeaderboardWindow} from '@/api/leaderboard-new';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';
import {normalizeSmartMoneySourceChain} from '@/lib/smartmoney-identity';
import {useSession} from '@/session/storage';

const allWindows: UnifiedLeaderboardWindow[] = ['1d', '7d', '30d', 'all'];
const windowName = (window: UnifiedLeaderboardWindow) => ({'1d': '24H', '7d': '7D', '30d': '30D', all: '全部'}[window]);
const sourceName = (raw: string) => raw === 'mixed' ? '多个来源' : raw === 'wallet' ? '钱包快照' : raw && raw !== 'unknown' ? raw.toUpperCase() : '未知';

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
  if (identity.type === 'external_user') return `/smart-money?subject_id=${encodeURIComponent(identity.id)}`;
  const params = new URLSearchParams({namespace: identity.namespace, wallet_address: identity.address});
  const sourceChain = entry.chains.map((chain) => normalizeSmartMoneySourceChain(chain, identity.namespace)).find(Boolean);
  if (sourceChain) params.set('source_chain', sourceChain);
  return `/smart-money?${params.toString()}`;
}

export function leaderboardRankLabel(entry: Pick<UnifiedLeaderboardEntry, 'rank' | 'ranking_eligible' | 'cohort_rank'>): string {
  if (entry.ranking_eligible === false) return entry.cohort_rank && entry.cohort_rank > 0 ? `组内 ${entry.cohort_rank}` : '—';
  return entry.rank > 0 ? String(entry.rank) : '—';
}
function groupLabel(basis: string): string {
  if (basis === 'fomo_profile_v1:source_snapshot') return 'FOMO 个人页起点快照';
  if (basis === 'fomo_profile_v1:accounting_replay') return 'FOMO 起点＋本代增量';
  if (basis.includes('snapshot')) return '平台账本';
  return '其他来源';
}
function LeaderboardRow({entry}: {entry: UnifiedLeaderboardEntry}) {
  const sign = decimalSign(entry.total_profit_usd) ?? 0;
  const display = entry.profile.display_name?.trim() || entry.profile.username?.trim() ||
    (entry.identity.type === 'external_user' ? entry.identity.id : entry.identity.address);
  const lastObserved = timestamp(entry.snapshot_at);
  return <tr className="border-t border-border transition hover:bg-surface-2/60">
    <td className="px-4 py-3"><span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-xs font-bold ${entry.ranking_eligible !== false && entry.rank > 0 && entry.rank <= 3 ? 'bg-accent/15 text-accent' : 'text-muted'}`}>{leaderboardRankLabel(entry)}</span></td>
    <td className="px-3 py-3"><a href={rowHref(entry)} className="font-medium text-foreground hover:text-accent">{display}</a>
      {entry.identity.type === 'external_user' ? <p className="mt-1 font-mono text-[10px] text-muted">{entry.identity.id}</p> : <p className="mt-1 break-all font-mono text-[10px] text-muted">{entry.identity.address}</p>}
      {entry.profile.x_handle ? <a className="mt-1 inline-block text-xs text-accent hover:underline" href={`https://x.com/${encodeURIComponent(entry.profile.x_handle)}`} target="_blank" rel="noreferrer">@{entry.profile.x_handle}</a> : null}
    </td>
    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{entry.platforms.map((platform) => <span key={platform} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">{platform}</span>)}{entry.platforms.length === 0 ? <span className="text-xs text-muted">未标注</span> : null}</div><p className="mt-1 text-[10px] text-muted">{entry.chains.length ? entry.chains.join(' · ') : '链范围未知'}</p></td>
    <td className={`px-4 py-3 text-right font-mono text-sm font-semibold ${sign > 0 ? 'text-up' : sign < 0 ? 'text-down' : 'text-muted'}`}>{money(entry.total_profit_usd)}</td>
    <td className="px-3 py-3 text-right text-xs text-muted">{lastObserved ? new Date(lastObserved * 1000).toLocaleString() : '—'}</td>
  </tr>;
}

export function LeaderboardView() {
  const session = useSession();
  const [window, setWindow] = useState<UnifiedLeaderboardWindow>('7d');
  const meta = useSWR('leaderboard-new-meta-v1', () => getUnifiedLeaderboardMeta(), {shouldRetryOnError: false});
  const board = useSWR(['leaderboard-source-v2', window, session?.jwt ?? 'anonymous'],
    ([, selectedWindow]) => getUnifiedLeaderboard(selectedWindow as UnifiedLeaderboardWindow, session?.jwt),
    {shouldRetryOnError: false, revalidateOnFocus: true});
  const apiError = board.error instanceof ApiError ? board.error : meta.error instanceof ApiError ? meta.error : undefined;
  const supportedWindows = allWindows.filter((candidate) => !meta.data || meta.data.windows.includes(candidate));

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">聪明钱榜单</h1><p className="mt-1 text-sm text-muted">展示外部聪明钱主体与钱包，按同一口径分组展示收益与名次。</p></div>
      <div className="flex items-center gap-3 text-xs text-muted">{board.data?.updated_at ? <span>榜单 {age(board.data.updated_at)} 更新</span> : null}<button type="button" disabled={board.isValidating} onClick={() => void board.mutate()} className="rounded-md border border-border px-3 py-2 text-accent disabled:opacity-50">{board.isValidating ? '刷新中…' : '刷新'}</button></div></header>
    <div role="note" className="rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-xs leading-5 text-muted">
      <p>当前是外部聪明钱的供应商快照榜单，未经链上账本核验。表内时间为各行参与收益的最旧观测时间；各组展示服务端发布的候选，组间不比较名次；不代表全部聪明钱。</p>
      {board.data ? <p className="mt-1">身份来源：{sourceName(board.data.meta.source)} · 数据提供方：{sourceName(board.data.meta.data_provider)} · 观测时间：{board.data.meta.as_of || '未知'} · 覆盖状态：仅榜单筛选范围</p> : null}
      {board.data?.stale ? <strong className="mt-1 block text-down">榜单构建已延迟，请谨慎参考。</strong> : null}
    </div>
    {meta.error && !meta.data ? <ErrorPanel error={meta.error} retry={() => void meta.mutate()} /> : null}
    {meta.isLoading ? <div className="h-10 animate-pulse rounded-xl bg-surface" /> : null}
    {meta.data ? <section aria-label="Leaderboard filters" className="flex flex-wrap items-center gap-5"><div className="flex items-center gap-2"><span className="text-xs text-muted">时间窗</span><div className="flex rounded-lg border border-border bg-surface p-1">{supportedWindows.map((candidate) => <button key={candidate} type="button" onClick={() => setWindow(candidate)} aria-pressed={window === candidate} className={`rounded-md px-3 py-1 text-sm ${window === candidate ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{windowName(candidate)}</button>)}</div></div><span className="text-xs text-muted">外部聪明钱</span></section> : null}
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      {board.error ? <ErrorPanel error={board.error} retry={() => void board.mutate()} /> : null}
      {board.isLoading && !board.data ? <p className="p-10 text-center text-sm text-muted">正在加载榜单…</p> : null}
      {board.data && board.data.list.length === 0 ? <p className="p-10 text-center text-sm text-muted">该时间窗暂无可展示的外部聪明钱数据。</p> : null}
      {board.data?.list.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">#</th><th className="px-3 py-3">聪明钱主体 / 地址</th><th className="px-3 py-3">平台 / 链</th><th className="px-4 py-3 text-right">总收益</th><th className="px-3 py-3 text-right">最旧观测</th></tr></thead><tbody>{board.data.list.map((entry, index) => <Fragment key={`${entry.identity.type}:${entry.identity.id || `${entry.identity.namespace}:${entry.identity.address}`}:${entry.identity_revision}`}>
      {entry.ranking_basis_id && (index === 0 || board.data!.list[index - 1].ranking_basis_id !== entry.ranking_basis_id) ? <tr className="border-t border-border bg-surface-2"><th colSpan={5} className="px-4 py-3 text-xs font-medium text-muted">{groupLabel(entry.ranking_basis_id)} · 本组内排名，组间不比较</th></tr> : null}
      <LeaderboardRow entry={entry} />
    </Fragment>)}</tbody></table></div> : null}
      {board.data?.list.length ? <footer className="flex justify-between border-t border-border px-4 py-3 text-xs text-muted"><span>共 {board.data.count} 个外部对象</span><span>Global · {windowName(board.data.window)} · USD</span></footer> : null}
    </section>
    {apiError?.traceID ? <p className="text-xs text-muted">Trace {apiError.traceID}</p> : null}
  </div>;
}

function ErrorPanel({error, retry}: {error: unknown; retry: () => void}) {
  const api = error instanceof ApiError ? error : undefined;
  const unavailable = api?.code === 500102;
  return <div role="alert" className="m-4 rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">{unavailable ? '外部聪明钱榜单暂不可用，请稍后重试。' : '榜单加载失败。'}{error instanceof Error && !unavailable ? ` ${error.message}` : ''}{api ? ` · code ${api.code} · trace ${api.traceID ?? 'unavailable'}` : ''}<button type="button" onClick={retry} className="ml-3 underline">重试</button></div>;
}
