'use client';

import {useState} from 'react';
import useSWR from 'swr';
import {getUnifiedLeaderboard, getUnifiedLeaderboardMeta, leaderboardIdentityKey, type LeaderboardSourceTag, type UnifiedLeaderboardEntry, type UnifiedLeaderboardQuery, type UnifiedLeaderboardReply} from '@/api/leaderboard-new';
import {ApiError} from '@/api/envelope';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {leaderboardDetailHref} from '@/lib/leaderboard-detail';
import {clearSite, readSite, useSession} from '@/session/storage';

const windowName = (value: string) => ({'1d': '24H', '7d': '7D', '30d': '30D', all: '全部时间'}[value] ?? value);
const dimensionName = (value: string) => value === 'ALL' ? '全部' : value;
const basisName = (value: string) => ({snapshot_delta: '窗口内组合盈亏变化', snapshot_cumulative: '全期组合累计盈亏', window_realized_plus_current_unrealized: '窗口内已实现 + 当前未实现'}[value] ?? '盈亏口径暂不可用');
function timestamp(seconds: number) {
  return seconds > 0 ? new Date(seconds * 1000).toLocaleString() : '—';
}
function money(value: string) {
  if (!value) return '—';
  const formatted = formatDecimalExact(value, 2);
  return `${decimalSign(value) === -1 ? '-' : ''}$${formatted.replace(/^-/, '')}`;
}

function PlatformBadge({platform, tag}: {platform: string; tag?: LeaderboardSourceTag}) {
  const [failed, setFailed] = useState(false);
  const logo = !failed && tag && /^https?:\/\//i.test(tag.logo_url) ? tag.logo_url : undefined;
  return <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
    {logo ? <img src={logo} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" onError={() => setFailed(true)} /> : null}
    {platform}
  </span>;
}

function IdentityCell({entry}: {entry: UnifiedLeaderboardEntry}) {
  const {identity, profile} = entry;
  const [failedLogo, setFailedLogo] = useState<string>();
  const name = profile.display_name || profile.username || (identity.type === 'wallet' ? identity.address : identity.id);
  const label = identity.type === 'wallet' && name === identity.address ? shortAddr(name, 8, 6) : name;
  const avatar = /^https?:\/\//i.test(profile.avatar_url) && failedLogo !== profile.avatar_url ? profile.avatar_url : undefined;
  const href = leaderboardDetailHref(entry);
  const avatarContent = avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" onError={() => setFailedLogo(avatar)} /> : label.slice(0, 1).toUpperCase() || '?';
  return <div className="flex items-center gap-3">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-semibold text-muted">
      {href ? <a href={href} aria-label={`查看 ${label} 的持仓`} className="flex h-full w-full items-center justify-center">{avatarContent}</a> : avatarContent}
    </div>
    <div className="min-w-0"><p className="max-w-[280px] truncate font-medium text-foreground" title={name}>{href ? <a href={href} className="hover:text-accent">{label}</a> : label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
        <span>{entry.dimension}</span>{entry.platforms.map((platform) => <PlatformBadge key={platform} platform={platform} tag={entry.source_tags?.find((tag) => tag.code.toLowerCase() === platform.toLowerCase())} />)}
        {identity.type === 'external_user' && profile.x_handle ? <a className="text-accent hover:underline" href={`https://x.com/${encodeURIComponent(profile.x_handle)}`} target="_blank" rel="noopener noreferrer">@{profile.x_handle}</a> : null}
      </div>
    </div>
  </div>;
}

function LoadError({error, retry, hasData = false}: {error: unknown; retry: () => void; hasData?: boolean}) {
  const api = error instanceof ApiError ? error : undefined;
  const messages: Record<number, string> = {100109: '筛选项已变更，请重新加载筛选项。', 500102: '榜单暂不可用，请稍后重试。', 400000: '登录凭据已失效，请重新登录。', 420000: '请求过于频繁，请稍后重试。'};
  return <div role="alert" className="rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">
    {hasData ? '刷新失败，当前保留上次加载的数据。' : ''}{api ? messages[api.code] ?? '榜单加载失败，请重试。' : '网络请求失败，请重试。'}
    <button type="button" onClick={retry} className="ml-2 underline">{api?.code === 100109 ? '重新加载筛选项' : '重试'}</button>
    {api?.traceID ? <p className="mt-1 break-all text-xs text-muted">Trace {api.traceID}</p> : null}
  </div>;
}

function ViewerSummary({reply}: {reply: UnifiedLeaderboardReply}) {
  const rank = reply.viewer_rank ?? 0;
  const participants = reply.participant_count ?? 0;
  if (rank <= 0 && participants <= 0) return null;
  const pnl = reply.viewer_profit_usd ?? '';
  return <p role="status" className="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted">
    {rank > 0 ? <>我的排名 <span className="font-mono font-semibold text-foreground">#{rank}</span>{pnl ? <> · 我的盈亏 <span className={`font-mono font-semibold ${decimalSign(pnl) === 1 ? 'text-up' : decimalSign(pnl) === -1 ? 'text-down' : 'text-muted'}`}>{money(pnl)}</span></> : null}{participants > 0 ? ' · ' : ''}</> : null}
    {participants > 0 ? <>共 {participants} 位用户参与本期排名</> : null}
  </p>;
}

export function UnifiedLeaderboardView() {
  const meta = useSWR('leaderboard-new-meta', getUnifiedLeaderboardMeta, {shouldRetryOnError: false});
  const [selection, setSelection] = useState<Partial<UnifiedLeaderboardQuery>>({});
  const windows = meta.data?.windows ?? [];
  const dimensions = meta.data?.dimensions ?? [];
  const window = selection.window && windows.includes(selection.window) ? selection.window : windows.includes('7d') ? '7d' : windows[0];
  const dimension = selection.dimension && dimensions.includes(selection.dimension) ? selection.dimension : dimensions.includes('ALL') ? 'ALL' : dimensions[0];
  const session = useSession();
  const bearer = session?.jwt;
  const board = useSWR(window && dimension ? ['leaderboard-new', window, dimension, bearer ?? ''] : null,
    async ([, window, dimension, jwt]) => {
      try {
        return await getUnifiedLeaderboard({window, dimension}, jwt || undefined);
      } catch (error) {
        // Optional 档：过期 token 会拿到 400000；清掉失效会话，让会话变化触发匿名重拉，而不是把整榜当失败。
        if (jwt && error instanceof ApiError && error.code === 400000 && readSite()?.jwt === jwt) clearSite();
        throw error;
      }
    },
    {shouldRetryOnError: false, refreshInterval: 60_000, revalidateOnFocus: true});
  const retry = () => {
    if (board.error instanceof ApiError && board.error.code === 100109) {
      void meta.mutate();
    } else {
      void board.mutate();
    }
  };

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">统一榜单</h1><p className="mt-1 text-sm text-muted">汇集 SmartX 用户、FOMO / PUMP 用户与 GMGN 钱包，按美元盈亏排名。</p></div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {board.data?.updated_at ? <span>构榜时间 {timestamp(board.data.updated_at)}</span> : null}
        <button type="button" disabled={board.isValidating || !window || !dimension} onClick={retry} className="rounded-md border border-border px-3 py-2 text-accent disabled:opacity-50">{board.isValidating ? '刷新中…' : '刷新'}</button>
      </div>
    </header>
    {meta.error ? <LoadError error={meta.error} retry={() => void meta.mutate()} /> : null}
    {meta.isLoading ? <p className="p-4 text-sm text-muted">正在加载筛选项…</p> : null}
    {meta.data ? <section aria-label="统一榜单筛选" className="flex flex-wrap gap-5">
      <Filter label="范围" values={dimensions} active={dimension} display={dimensionName} select={(dimension) => setSelection((value) => ({...value, dimension}))} />
      <Filter label="时间窗" values={windows} active={window} display={windowName} select={(window) => setSelection((value) => ({...value, window}))} />
      {!windows.length || !dimensions.length ? <p className="text-sm text-muted">暂无可用筛选项。</p> : null}
    </section> : null}
    <p className="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted">SmartX 统计本站组合盈亏；Global 统计关联钱包的窗口内已实现收益与当前浮盈。全部榜单混合展示两种口径，统计范围及公式不同。</p>
    {board.data?.stale ? <p role="status" className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm text-accent">后台更新延迟，当前展示最近一次可用榜单。</p> : null}
    {board.data ? <ViewerSummary reply={board.data} /> : null}
    {board.error ? <LoadError error={board.error} retry={retry} hasData={!!board.data} /> : null}
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      {board.isLoading ? <p role="status" className="p-10 text-center text-sm text-muted">正在加载统一榜单…</p> : null}
      {board.data && !board.data.list.length ? <p className="p-10 text-center text-sm text-muted">该筛选组合暂无符合条件的用户或钱包。</p> : null}
      {board.data && board.data.list.length > 0 ? <>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="px-4 py-3">排名</th><th className="px-3 py-3">用户 / 钱包</th><th className="px-3 py-3">覆盖链</th><th className="px-3 py-3 text-right">总盈亏（USD） ↓</th><th className="px-4 py-3 text-right">数据观测时间</th></tr></thead>
          <tbody>{board.data.list.map((entry) => <tr key={leaderboardIdentityKey(entry.identity)} className="border-t border-border hover:bg-surface-2/60">
            <td className="px-4 py-4"><span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-xs font-bold ${entry.rank <= 3 ? 'bg-accent/15 text-accent' : 'text-muted'}`}>{entry.rank}</span></td>
            <td className="px-3 py-4"><IdentityCell entry={entry} /></td>
            <td className="px-3 py-4"><div className="flex max-w-[200px] flex-wrap gap-1 text-xs text-muted">{entry.chains.length ? entry.chains.map((chain) => <span key={chain} className="rounded border border-border px-1.5 py-0.5">{chain === 'sol' ? 'Solana' : chainLabel(chain)}</span>) : entry.identity.type === 'smartx_user' ? '本站组合' : '—'}</div></td>
            <td className="px-3 py-4 text-right"><p className={`whitespace-nowrap font-mono font-semibold ${decimalSign(entry.total_profit_usd) === 1 ? 'text-up' : decimalSign(entry.total_profit_usd) === -1 ? 'text-down' : 'text-muted'}`}>{money(entry.total_profit_usd)}</p><p className="mt-1 text-[10px] text-muted">{basisName(entry.pnl_basis)}</p></td>
            <td className="px-4 py-4 text-right text-xs text-muted" title="参与该成绩的数据中最旧的观测时间">{timestamp(entry.snapshot_at)}</td>
          </tr>)}</tbody>
        </table></div>
        <footer className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted"><span>共 {board.data.count} 个用户 / 钱包 · 最多 100 名</span><span>{dimensionName(board.data.dimension)} · {windowName(board.data.window)}</span></footer>
      </> : null}
    </section>
  </div>;
}

function Filter({label, values, active, display, select}: {label: string; values: string[]; active?: string; display: (value: string) => string; select: (value: string) => void}) {
  return <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted">{label}</span><div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">{values.map((value) => <button key={value} type="button" aria-pressed={active === value} onClick={() => select(value)} className={`rounded-md px-3 py-1.5 text-sm ${active === value ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{display(value)}</button>)}</div></div>;
}
