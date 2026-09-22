'use client';

import {useState} from 'react';
import useSWR from 'swr';
import {ApiError} from '@/api/envelope';
import {getFollowingNew, type FollowingNewEntry} from '@/api/following-new';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';
import {leaderboardDetailHref} from '@/lib/leaderboard-detail';
import {shortAddr} from '@/lib/format';
import {useSession} from '@/session/storage';

function money(value: string) {
  if (!value) return '—';
  const formatted = formatDecimalExact(value, 2);
  return `${decimalSign(value) === -1 ? '-' : ''}$${formatted.replace(/^-/, '')}`;
}

function nameOf(entry: FollowingNewEntry) {
  return entry.profile.display_name || entry.profile.username || (entry.identity.type === 'wallet' ? entry.identity.address : entry.identity.id) || 'Unknown';
}

function EntryName({entry}: {entry: FollowingNewEntry}) {
  const name = nameOf(entry);
  const label = entry.identity.type === 'wallet' && name === entry.identity.address ? shortAddr(name, 8, 6) : name;
  const href = leaderboardDetailHref(entry);
  return <div className="flex items-center gap-3">
    {entry.profile.avatar_url ? <img src={entry.profile.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-muted">{label.slice(0, 1).toUpperCase()}</span>}
    <div className="min-w-0"><p className="truncate font-medium">{href ? <a href={href} className="hover:text-accent">{label}</a> : label}</p><p className="text-xs text-muted">{entry.platforms.join(' · ') || entry.dimension}</p></div>
  </div>;
}

export function FollowingNewView() {
  const bearer = useSession()?.jwt;
  const [windowValue, setWindowValue] = useState('7d');
  const [dimension, setDimension] = useState('ALL');
  const board = useSWR(bearer ? ['following-new', bearer, windowValue, dimension] : null, ([, jwt, window, selectedDimension]) => getFollowingNew(jwt, {window, dimension: selectedDimension, limit: 20}), {shouldRetryOnError: false, revalidateOnFocus: true});
  const error = board.error instanceof ApiError ? board.error : undefined;
  if (!bearer) return <div className="rounded-xl border border-border bg-surface p-8 text-center"><h1 className="text-2xl font-semibold">People</h1><p className="mt-2 text-sm text-muted">登录后查看你关注的 People。</p></div>;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">People</h1><p className="mt-1 text-sm text-muted">按盈亏查看你关注的 People。</p></div><button type="button" disabled={board.isValidating} onClick={() => void board.mutate()} className="rounded-md border border-border px-3 py-2 text-sm text-accent disabled:opacity-50">{board.isValidating ? '刷新中…' : '刷新'}</button></header>
    <div className="flex flex-wrap gap-5"><Filter label="时间窗" values={['1d', '7d', '30d', 'all']} active={windowValue} select={setWindowValue} /><Filter label="范围" values={['ALL', 'SmartX', 'Global']} active={dimension} select={setDimension} /></div>
    {error ? <div role="alert" className="rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">People 加载失败，请稍后重试。<button type="button" onClick={() => void board.mutate()} className="ml-2 underline">重试</button></div> : null}
    <section className="overflow-hidden rounded-xl border border-border bg-surface">{board.isLoading ? <p className="p-10 text-center text-sm text-muted">正在加载 People…</p> : null}{board.data && !board.data.list.length ? <p className="p-10 text-center text-sm text-muted">暂无关注的 People。</p> : null}{board.data?.list.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs text-muted"><tr><th className="px-4 py-3">排名</th><th className="px-3 py-3">People</th><th className="px-3 py-3">覆盖链</th><th className="px-3 py-3 text-right">总盈亏（USD）</th><th className="px-4 py-3 text-right">关注时间</th></tr></thead><tbody>{board.data.list.map((entry) => <tr key={JSON.stringify(entry.identity)} className="border-t border-border"><td className="px-4 py-4 font-mono">{entry.rank}</td><td className="px-3 py-4"><EntryName entry={entry} />{entry.remark ? <p className="mt-1 text-xs text-accent">{entry.remark}</p> : null}</td><td className="px-3 py-4 text-xs text-muted">{entry.chains.join(', ') || '—'}</td><td className={`px-3 py-4 text-right font-mono ${decimalSign(entry.total_profit_usd) === 1 ? 'text-up' : decimalSign(entry.total_profit_usd) === -1 ? 'text-down' : 'text-muted'}`}>{money(entry.total_profit_usd)}</td><td className="px-4 py-4 text-right text-xs text-muted">{entry.followed_at?.seconds ? new Date(entry.followed_at.seconds * 1000).toLocaleDateString() : '—'}</td></tr>)}</tbody></table></div> : null}{board.data ? <footer className="border-t border-border px-4 py-3 text-xs text-muted">共 {board.data.total} 个 People</footer> : null}</section>
  </div>;
}

function Filter({label, values, active, select}: {label: string; values: string[]; active: string; select: (value: string) => void}) { return <div className="flex items-center gap-2"><span className="text-xs text-muted">{label}</span><div className="flex rounded-lg border border-border bg-surface p-1">{values.map((value) => <button key={value} type="button" onClick={() => select(value)} aria-pressed={active === value} className={`rounded-md px-3 py-1 text-sm ${active === value ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{value}</button>)}</div></div>; }
