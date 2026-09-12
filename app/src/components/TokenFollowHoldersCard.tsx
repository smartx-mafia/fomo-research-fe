'use client';

/**
 * 代币详情页的「关注的人持有」块（social.md §5.3 + social-follow-holders.md）。
 *
 * - 登录才存在：端点回答「我」的关注集合，**没有匿名语义**（§0）—— 未登录
 *   不渲染、不发请求；
 * - chain 必须是小写链 slug（§2）；代币详情页传来的链标识可能带别名或大小写，
 *   归一失败就不渲染；
 * - 空 items / 叠加场景静默码（§1/§5/§6：400000 / 420000 / 430114 / 500097 /
 *   500098）一律静默不渲染，不打断代币详情页；其余错误走 ErrorPanel；
 * - shares 是标的最小单位的十进制串，人类可读量 = shares / 10^decimals，
 *   decimals 取回包 token.decimals；token 缺席（行情面无记录）或 decimals 0
 *   时**绝不拿 0 当精度**（§2），原串缩短展示 + 「精度未知」；
 * - 空串 = 无此值不是 0：pnl_percent / cost_usd 为空显示 «—» / 不显示。
 */
import {useCallback, useEffect, useState} from 'react';

import {getTokenFollowHolders, socialDisplayName, type FollowHolderItem, type TokenFollowHoldersReply} from '@/api/social';
import {ApiError} from '@/api/envelope';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Card} from '@/components/ui';
import {decimalSign, formatBaseUnitsExact, formatDecimalExact} from '@/lib/exact-decimal';

const PAGE_LIMIT = 20;

/** social-follow-holders.md §2：服务端认识的链 slug（全小写）。 */
const KNOWN_CHAIN_SLUGS = new Set(['bsc', 'solana', 'base', 'robinhood', 'ethereum']);

/**
 * 代币详情面的链标识 → 社交面的链 slug（social-follow-holders.md §2：
 * `chain` 是 bsc/solana/base/robinhood/ethereum 小写，**不是**聪明钱面的 `sol`，
 * 传错回 100119）。eth→ethereum、sol→solana 之外小写透传；
 * 归一不出已知 slug 返回 null，调用方整块不渲染。
 */
export function normalizeChainSlug(chain: string): string | null {
  const lowered = chain.trim().toLowerCase();
  if (lowered === 'eth') return 'ethereum';
  if (lowered === 'sol') return 'solana';
  return KNOWN_CHAIN_SLUGS.has(lowered) ? lowered : null;
}

/** 这些 code = 「这次没有这块」（social-follow-holders.md §1/§5/§6）：静默不渲染。 */
const SILENT_CODES = new Set([400000, 420000, 430114, 500097, 500098]);

/** token 缺席 / decimals 0 时不换算（§2），原串只做缩短展示。 */
function shortenRawShares(raw: string): string {
  const digits = /^0+$/.test(raw) ? '0' : raw.replace(/^0+(?=\d)/, '');
  if (digits.length <= 12) return digits;
  return `${digits[0]}.${digits.slice(1, 4)}e+${digits.length - 1}`;
}

function FollowHolderRow({item, decimals}: {item: FollowHolderItem; decimals?: number}) {
  const {primary, isRemark} = socialDisplayName({
    remark: item.remark,
    nickname: item.user.nickname,
    username: item.user.username,
    identifier: item.user.identifier,
  });
  const initial = (item.user.nickname || item.user.username || item.user.identifier || '?').trim().charAt(0).toUpperCase() || '?';
  // socialDisplayName 已按 remark 优先取名；isRemark 时名字用 accent 样式 + 「备注」
  // 徽标区分（social.md §5：备注是「我起的」，要与 nickname/username 样式不同），
  // 并在次要行保留真实身份（@username / nickname），避免只剩备注认不出人。
  // 无备注时 primary 已含 @username（回退链），次要行不再重复。
  const secondary = isRemark
    ? item.user.username ? `@${item.user.username}` : item.user.nickname || null
    : item.user.username && primary !== `@${item.user.username}` ? `@${item.user.username}` : null;
  const precisionUnknown = !decimals; // undefined / 0 都不当精度（§2）
  const sharesText = precisionUnknown ? shortenRawShares(item.shares) : formatDecimalExact(formatBaseUnitsExact(item.shares, decimals), 6);
  const pnl = item.pnl_percent ?? '';
  const pnlSign = decimalSign(pnl || undefined);
  const cost = item.cost_usd ?? '';
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <a href={`/user/${encodeURIComponent(item.user.identifier)}`} className="flex min-w-0 flex-1 items-center gap-2.5 hover:opacity-80">
        {item.user.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- 头像 URL 由后端下发，next/image 优化域名不可枚举（同 SearchBox）。
          <img src={item.user.avatar_url} alt="" className="size-8 shrink-0 rounded-full bg-surface-2 object-cover" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-muted">{initial}</span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <span className={`truncate text-sm font-medium ${isRemark ? 'text-accent' : 'text-foreground'}`}>{primary}</span>
            {isRemark ? <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">备注</span> : null}
          </p>
          {secondary ? <p className="truncate text-xs text-muted">{secondary}</p> : null}
        </div>
      </a>
      <div className="shrink-0 text-right font-mono text-xs">
        <p className="text-foreground">
          {sharesText}
          {precisionUnknown ? <span className="ml-1 font-sans text-[10px] text-muted">精度未知</span> : null}
        </p>
        <p className="text-muted">
          {/* 空串 = 行情不可得 / 成本为 0，显示 «—»，与 «"0"»（真的是零）严格两回事（§2）。 */}
          {pnl === '' ? '—' : <span className={pnlSign === -1 ? 'text-down' : pnlSign === 1 ? 'text-up' : 'text-muted'}>{`${pnlSign === 1 ? '+' : ''}${formatDecimalExact(pnl, 2)}%`}</span>}
          {cost === '' ? null : <span className="ml-2">${formatDecimalExact(cost, 2)}</span>}
        </p>
      </div>
    </li>
  );
}

export function TokenFollowHoldersCard({bearer, chain, address}: {bearer?: string | null; chain: string; address: string}) {
  const slug = normalizeChainSlug(chain);
  const [reply, setReply] = useState<TokenFollowHoldersReply | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const loadFirstPage = useCallback(async () => {
    if (!bearer || !slug) return;
    setInitialLoading(true);
    setError(null);
    try {
      const res = await getTokenFollowHolders(bearer, slug, address, {limit: PAGE_LIMIT});
      setReply(res.data);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setInitialLoading(false);
    }
  }, [bearer, slug, address]);

  useEffect(() => {
    setReply(null);
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    const cursor = reply?.next_cursor;
    if (!bearer || !slug || !cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await getTokenFollowHolders(bearer, slug, address, {cursor, limit: PAGE_LIMIT});
      setReply((previous) => previous
        ? {
          ...res.data,
          token: res.data.token ?? previous.token,
          items: [...(previous.items ?? []), ...(res.data.items ?? [])],
          total: res.data.total ?? previous.total,
        }
        : res.data);
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === 100103) {
        // cursor 损坏 → 丢弃 cursor 重拉首屏（social-follow-holders.md §6）。
        setReply(null);
        await loadFirstPage();
        return;
      }
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!bearer || !slug) return null;
  // 首屏未知前不占位：这个块只在「关注的人真的持有」时存在（§0/§3）。
  if (initialLoading) return null;
  if (error && SILENT_CODES.has(error.code)) return null;
  const items = reply?.items ?? [];
  if (!error && items.length === 0) return null;

  const total = reply?.total ?? items.length;
  const decimals = reply?.token?.decimals;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-muted">关注的人持有</span>
        <span className="text-[11px] text-muted">{`你关注的人中 ${total} 人持有`}</span>
      </div>
      {error ? (
        <div className="border-b border-border p-4">
          <ErrorPanel err={error} />
          <button type="button" onClick={() => void loadFirstPage()} className="mt-2 text-xs text-accent hover:underline">
            重试
          </button>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-border">
          {items.map((item) => <FollowHolderRow key={item.user.identifier} item={item} decimals={decimals} />)}
        </ul>
      ) : null}
      {reply?.next_cursor ? (
        <div className="border-t border-border px-4 py-2 text-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="text-xs text-accent disabled:opacity-50">
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
