"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BoardName, TokenMarket } from "@/lib/types";
import { BOARDS } from "@/lib/types";
import { useBoardStream } from "@/lib/ws";
import { fmtPrice, fmtCompact, fmtInt, fmtAge } from "@/lib/format";
import { Card, ChainBadge, PctBadge, Skeleton, EmptyState } from "@/components/ui";
import { Flash } from "@/components/Flash";

const BOARD_LABELS: Record<BoardName, string> = {
  trending: "Trending",
  new: "New",
  bonding: "Bonding",
  bonded: "Bonded",
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

function TokenRows({ tokens }: { tokens: TokenMarket[] }) {
  if (tokens.length === 0) {
    return <EmptyState>No tokens match this view right now.</EmptyState>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-medium">Token</th>
            <th className="px-3 py-2 font-medium">Chain</th>
            <th className="px-3 py-2 font-medium">Age</th>
            <th className="px-3 py-2 font-medium text-right">Price</th>
            <th className="px-3 py-2 font-medium text-right">1h</th>
            <th className="px-3 py-2 font-medium text-right">24h</th>
            <th className="px-3 py-2 font-medium text-right">Market Cap</th>
            <th className="px-3 py-2 font-medium text-right">Liquidity</th>
            <th className="px-3 py-2 font-medium text-right">Vol 24h</th>
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
 * `initialTrending` 是 SSR 用 HTTP 拉的首屏兜底，snapshot 到达后即被替换。
 * 榜单接口没有链过滤参数，chains 在客户端过滤。
 */
export function TokenTable({
  initialTrending,
  chains,
}: {
  initialTrending: TokenMarket[] | null;
  chains: string[];
}) {
  const [tab, setTab] = useState<BoardName>("trending");
  const { items, status } = useBoardStream(tab, initialTrending ?? undefined);

  const rows = useMemo(
    () => (chains.length > 0 ? items.filter((t) => chains.includes(t.chain)) : items),
    [items, chains]
  );

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          {BOARDS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {BOARD_LABELS[t]}
            </button>
          ))}
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs ${status === "live" ? "text-up" : "text-muted"}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-up" : "animate-pulse bg-muted"}`}
          />
          {status === "live" ? "Live" : "Connecting…"}
        </span>
      </div>

      {status !== "live" && items.length === 0 ? <TableSkeleton /> : <TokenRows tokens={rows} />}
    </Card>
  );
}
