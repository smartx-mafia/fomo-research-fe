'use client';

/**
 * 我的自选（Watchlist）面板 —— GET /v1/tokens/favorites（favorites.md §3）。
 *
 * 契约要点落在 UI 上：
 * - 不分页一次全量（收藏上限 500），30s 轮询 + focus 重验；
 * - market 可能整个缺席（服务端没行情快照）：渲染 "—"，不是价格 0，
 *   顶层 symbol/name 由静态元数据兜底，都空就显示地址缩写；
 * - 四种排序由服务端出（拼错回 100120，不静默回退），按行情排序时无行情条目服务端自动沉底；
 * - 未登录（400000 语义）显示登录引导；500106 是存储不可用，不是"没有收藏"。
 */
import {useEffect, useState} from 'react';
import useSWR from 'swr';
import Link from 'next/link';

import {listFavorites, type FavoriteItem, type FavoriteSort} from '@/api/favorites';
import {ApiError} from '@/api/envelope';
import {useSession} from '@/session/storage';
import {StarButton, useFavorites} from '@/components/FavoritesProvider';
import {TokenAvatarView, useTokenDisplay} from '@/components/TokenAvatar';
import {normalizeTokenMarket} from '@/lib/market';
import {fmtPrice, fmtCompact, fmtAge, shortAddr, DASH} from '@/lib/format';
import {ChainBadge, PctBadge, Skeleton, EmptyState} from '@/components/ui';
import {Flash} from '@/components/Flash';

const SORTS: {value: FavoriteSort; label: string}[] = [
  {value: 'favorited_at_desc', label: 'Recently added'},
  {value: 'market_cap_desc', label: 'Market cap'},
  {value: 'price_change_24h_desc', label: '24h change'},
  {value: 'volume_24h_desc', label: '24h volume'},
];

export default function WatchlistPanel() {
  const session = useSession();
  const [sort, setSort] = useState<FavoriteSort>('favorited_at_desc');

  const {data, error, isLoading} = useSWR(
    session ? ['favorites', session.jwt, sort] : null,
    ([, jwt, s]) => listFavorites(jwt as string, s as FavoriteSort),
    {refreshInterval: 30_000, revalidateOnFocus: true, shouldRetryOnError: false}
  );

  if (!session) {
    return (
      <EmptyState>
        Sign in to use your watchlist — <Link href="/login" className="text-accent hover:underline">Login</Link>
      </EmptyState>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({length: 6}).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    const code = error instanceof ApiError ? error.code : undefined;
    if (code === 500106) {
      return <EmptyState>Watchlist storage is temporarily unavailable — try again later.</EmptyState>;
    }
    return <EmptyState>Failed to load watchlist ({code ?? 'network'}) — try again later.</EmptyState>;
  }

  const items: FavoriteItem[] = data?.data.items ?? [];
  const total = data?.data.total ?? items.length;
  const limit = data?.data.limit;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs text-muted">
          {total} token{total === 1 ? '' : 's'}
          {limit !== undefined && total >= limit && (
            <span className="ml-1 text-down">(full — remove some to add more)</span>
          )}
        </span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as FavoriteSort)}
          className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <EmptyState>No favorites yet — tap ☆ on any token to add it.</EmptyState>
      ) : (
        <WatchlistRows items={items} />
      )}
    </div>
  );
}

/** 行渲染：market 缺席的条目也占一整行（symbol/name 静态兜底），行情位全部 "—" */
function WatchlistRows({items}: {items: FavoriteItem[]}) {
  const {primeFavoriteStatus} = useFavorites();
  useEffect(() => primeFavoriteStatus(items.map((item) => ({chain: item.chain, address: item.address}))), [items, primeFavoriteStatus]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="w-8 px-2 py-2" />
            <th className="px-3 py-2 font-medium">Token</th>
            <th className="px-3 py-2 font-medium">Chain</th>
            <th className="px-3 py-2 font-medium">Added</th>
            <th className="px-3 py-2 font-medium text-right">Price</th>
            <th className="px-3 py-2 font-medium text-right">24h</th>
            <th className="px-3 py-2 font-medium text-right">Market Cap</th>
            <th className="px-3 py-2 font-medium text-right">Liquidity</th>
            <th className="px-3 py-2 font-medium text-right">Vol 24h</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const m = item.market ? normalizeTokenMarket(item.market) : undefined;
            return (
              <tr key={`${item.chain}:${item.address}`} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                <td className="w-8 px-2 py-2">
                  <StarButton chain={item.chain} address={item.address} knownFavorited />
                </td>
                <td className="px-3 py-2">
                  <WatchlistTokenCell item={item} market={m} />
                </td>
                <td className="px-3 py-2">
                  <ChainBadge chainId={item.chain} />
                </td>
                <td className="px-3 py-2 tabular text-muted">{fmtAge(item.favorited_at)}</td>
                <td className="px-3 py-2 tabular text-right">
                  {m ? <Flash value={m.price}>{fmtPrice(m.price)}</Flash> : <span className="text-muted">{DASH}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {m ? <PctBadge value={m.price_change_24h} /> : <span className="text-muted">{DASH}</span>}
                </td>
                <td className="px-3 py-2 tabular text-right">
                  {m ? <Flash value={m.market_cap}>{fmtCompact(m.market_cap)}</Flash> : <span className="text-muted">{DASH}</span>}
                </td>
                <td className="px-3 py-2 tabular text-right">
                  {m ? fmtCompact(m.liquidity) : <span className="text-muted">{DASH}</span>}
                </td>
                <td className="px-3 py-2 tabular text-right">
                  {m ? fmtCompact(m.volume_24h) : <span className="text-muted">{DASH}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-muted">
        Missing quotes render as {DASH} — the server has no fresh snapshot for that token; it refreshes on its own schedule.
      </p>
    </div>
  );
}

function WatchlistTokenCell({item, market}: {item: FavoriteItem; market?: ReturnType<typeof normalizeTokenMarket>}) {
  const {info, isFavorited, personalReady} = useTokenDisplay(item.chain, item.address);
  const symbol = info?.symbol ?? market?.symbol ?? item.symbol;
  const name = info?.name ?? market?.name ?? item.name;
  return (
    // 路径式详情页在静态导出下无客户端路由，走整页加载经 _redirects 重写。
    <a href={`/token/${item.chain}/${item.address}`} className="flex items-center gap-2">
      <TokenAvatarView info={info} isFavorited={isFavorited} personalReady={personalReady} size={24} fallbackLogo={market?.logo}
        fallbackSymbol={market?.symbol ?? item.symbol} fallbackName={market?.name ?? item.name} />
      <div className="flex flex-col leading-tight">
        <span className="font-medium text-foreground">{symbol ?? shortAddr(item.address, 6, 4)}</span>
        <span className="max-w-[160px] truncate text-xs text-muted">{name ?? shortAddr(item.address, 6, 4)}</span>
      </div>
    </a>
  );
}
