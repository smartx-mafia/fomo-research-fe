"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BoardName, TokenMarket } from "@/lib/types";
import { BOARDS } from "@/lib/types";
import { useBoardStream } from "@/lib/ws";
import { fmtPrice, fmtCompact, fmtInt, fmtAge } from "@/lib/format";
import { Card, ChainBadge, PctBadge, Skeleton, EmptyState } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { StarButton, useFavorites } from "@/components/FavoritesProvider";
import { useSession } from "@/session/storage";
import WatchlistPanel from "@/components/WatchlistPanel";

/** 2026-09 起五榜：most_held 是候选池最多 Account 主体持有榜。 */
const BOARD_LABELS: Record<BoardName, string> = {
  trending: "Trending",
  bonding: "Bonding",
  graduated: "Graduated",
  crypto: "Crypto",
  most_held: "Most Held",
};

function TokenLogo({ logo, symbol }: { logo?: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted">
        {symbol.slice(0, 1).toUpperCase() || "?"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={symbol}
      className="h-6 w-6 shrink-0 rounded-full bg-surface-2 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function BondingBar({ pct, bonded }: { pct?: number; bonded?: boolean }) {
  if (bonded) {
    return (
      <span className="rounded border border-up/30 bg-up/10 px-1.5 py-0.5 text-[10px] font-medium text-up">
        Graduated
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
      </div>
      <span className="tabular text-[11px] text-muted">{clamped.toFixed(0)}%</span>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function TokenRows({ tokens, board }: { tokens: TokenMarket[]; board: BoardName }) {
  // 榜单/搜索回包没有收藏字段：登录时批量查一次星标（favorites.md §4）
  const {ensureStatus} = useFavorites();
  const session = useSession();
  useEffect(() => {
    if (!session) return;
    ensureStatus(tokens.map((t) => ({chain: t.chain, address: t.address})));
  }, [session, tokens, ensureStatus]);

  if (tokens.length === 0) {
    return <EmptyState>No tokens match this view right now.</EmptyState>;
  }
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${board === "most_held" ? "min-w-[1120px]" : "min-w-[960px]"}`}>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="w-8 px-2 py-2" />
            <th className="px-3 py-2 font-medium">Token</th>
            <th className="px-3 py-2 font-medium">Chain</th>
            <th className="px-3 py-2 font-medium">Age</th>
            <th className="px-3 py-2 font-medium text-right">Price</th>
            <th className="px-3 py-2 font-medium text-right">1h</th>
            <th className="px-3 py-2 font-medium text-right">24h</th>
            <th className="px-3 py-2 font-medium text-right">Market Cap</th>
            <th className="px-3 py-2 font-medium text-right">Liquidity</th>
            <th className="px-3 py-2 font-medium text-right">Vol 24h</th>
            {board === "most_held" && (
              <>
                <th className="px-3 py-2 font-medium text-right">Held By</th>
                <th className="px-3 py-2 font-medium text-right">Held Value</th>
              </>
            )}
            <th className="px-3 py-2 font-medium text-right">Holders</th>
            <th className="px-3 py-2 font-medium">Bonding</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((tok) => (
            <tr
              key={`${tok.chain}:${tok.address}`}
              className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
            >
              <td className="w-8 px-2 py-2">
                <StarButton chain={tok.chain} address={tok.address} />
              </td>
              <td className="px-3 py-2">
                <Link href={`/token/${tok.chain}/${tok.address}`} className="flex items-center gap-2">
                  <TokenLogo logo={tok.logo} symbol={tok.symbol ?? "?"} />
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium text-foreground">{tok.symbol ?? "?"}</span>
                    <span className="max-w-[160px] truncate text-xs text-muted">{tok.name ?? tok.symbol}</span>
                  </div>
                </Link>
              </td>
              <td className="px-3 py-2">
                <ChainBadge chainId={tok.chain} />
              </td>
              <td className="px-3 py-2 tabular text-muted">{fmtAge(tok.created_at)}</td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.price}>{fmtPrice(tok.price)}</Flash>
              </td>
              <td className="px-3 py-2 text-right">
                <Flash value={tok.price_change_1h}>
                  <PctBadge value={tok.price_change_1h} />
                </Flash>
              </td>
              <td className="px-3 py-2 text-right">
                <Flash value={tok.price_change_24h}>
                  <PctBadge value={tok.price_change_24h} />
                </Flash>
              </td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.market_cap}>{fmtCompact(tok.market_cap)}</Flash>
              </td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.liquidity}>{fmtCompact(tok.liquidity)}</Flash>
              </td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.volume_24h}>{fmtCompact(tok.volume_24h)}</Flash>
              </td>
              {board === "most_held" && (
                <>
                  <td className="px-3 py-2 tabular text-right">
                    <Flash value={tok.held_by_accounts}>{fmtInt(tok.held_by_accounts)}</Flash>
                  </td>
                  <td className="px-3 py-2 tabular text-right">
                    <Flash value={tok.held_value_usd}>
                      {tok.held_value_usd === undefined ? "—" : `$${fmtCompact(tok.held_value_usd)}`}
                    </Flash>
                  </td>
                </>
              )}
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.holders_count}>{fmtInt(tok.holders_count)}</Flash>
              </td>
              <td className="px-3 py-2">
                <BondingBar pct={tok.bonding_percentage} bonded={tok.bonded} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 榜单表。主数据源是 WS（subscribe 即 snapshot，之后增量合并，见 lib/ws.ts）；
 * `initialTrending` 是可选启动快照；当前页面传 null，等待浏览器直连 WS snapshot。
 *
 * 五榜均为跨链聚合榜（2026-09 起），不做链筛选或客户端重排；服务端已经
 * 按各榜规则排序并限制为最多 100 条。
 */
type Tab = BoardName | "watchlist";

export function TokenTable({ initialTrending }: { initialTrending: TokenMarket[] | null }) {
  const [tab, setTab] = useState<Tab>("trending");
  const isBoard = tab !== "watchlist";
  // 启动快照只属于 Trending：切到其它榜时绝不能拿它冒充新榜快照。
  const initial = isBoard && tab === "trending" ? initialTrending ?? undefined : undefined;
  const { items, status } = useBoardStream(isBoard ? tab : "trending", initial);
  const rows = items;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {([...BOARDS, "watchlist"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {t === "watchlist" ? "★ Watchlist" : BOARD_LABELS[t as BoardName]}
            </button>
          ))}
        </div>
        {isBoard && (
          <span
            className={`flex items-center gap-1.5 text-xs ${status === "live" ? "text-up" : "text-muted"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "live" ? "bg-up" : status === "rejected" ? "bg-muted" : "animate-pulse bg-muted"
              }`}
            />
            {status === "live" ? "Live" : status === "rejected" ? "Unavailable" : "Connecting…"}
          </span>
        )}
      </div>

      {tab === "watchlist" ? (
        <WatchlistPanel />
      ) : status === "rejected" ? (
        <EmptyState>This board is not available in the current backend environment.</EmptyState>
      ) : status !== "live" && items.length === 0 ? (
        <TableSkeleton />
      ) : (
        <TokenRows tokens={rows} board={tab} />
      )}
    </Card>
  );
}
