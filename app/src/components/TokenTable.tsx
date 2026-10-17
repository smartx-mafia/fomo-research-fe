"use client";

import { useEffect, useState } from "react";
import type { BoardName, Chain, TokenMarket } from "@/lib/types";
import { BOARDS, CHAINS } from "@/lib/types";
import { useBoardStream } from "@/lib/ws";
import { fmtPrice, fmtCompact, fmtInt, fmtAge, chainLabel } from "@/lib/format";
import { Card, ChainBadge, PctBadge, Skeleton, EmptyState } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { StarButton, useFavorites } from "@/components/FavoritesProvider";
import { useSession } from "@/session/storage";
import {RiskDetails, RiskDialog} from "@/components/TokenRisk";
import {riskHeading} from "@/lib/risk-assessment";
import {DiscoveryReasons, DiscoveryStatus, DiscoveryWeights} from "./DiscoveryReasons";
import {DiscoveryResearch} from "./DiscoveryResearch";
import WatchlistPanel from "@/components/WatchlistPanel";

/** most_held 是候选池最多 Account 主体持有榜；Gainers 按正 1h 涨幅排名。 */
const BOARD_LABELS: Record<BoardName, string> = {
  trending: "Trending",
  gainers: "Gainers",
  discovery_lab: "机会榜 · 测试",
  bonding: "Bonding",
  graduated: "Graduated",
  crypto: "Crypto",
  most_held: "Most Held",
};

function DiscoveryRisk({token}: {token: TokenMarket}) {
  const [open, setOpen] = useState(false);
  const assessment = token.risk.assessment;
  const verified = assessment?.verification?.eligible && !assessment.verification.suspended;
  const clear = assessment?.grade === 1 && assessment.checksComplete && assessment.items.length === 0;
  if (verified || clear) {
    return <details className="max-w-[240px] text-xs">
      <summary className="cursor-pointer">{verified ? "平台已验证" : "未报告风险项"}</summary>
      <p className="mt-2 text-muted">{verified ? "平台验证资格不代表无风险或已完成全部检查。交易前仍以最新风控为准。" : "最近一次评估未列出风险项，不代表安全保证。交易前仍以最新风控为准。"}</p>
      {!!assessment?.items.length && <RiskDetails risk={assessment} />}
    </details>;
  }
  return <><button type="button" className="text-xs underline" onClick={() => setOpen(true)}>{riskHeading(assessment)}</button><RiskDialog risk={assessment} open={open} onClose={() => setOpen(false)} /></>;
}

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
            {board === "discovery_lab" && <th className="px-3 py-2 font-medium">入选理由</th>}
            <th className="px-3 py-2 font-medium">Chain</th>
            <th className="px-3 py-2 font-medium">Age</th>
            <th className="px-3 py-2 font-medium text-right">Price</th>
            <th className="px-3 py-2 font-medium text-right">{board === "discovery_lab" ? "5m" : "1h"}</th>
            {board !== "gainers" && <th className="px-3 py-2 font-medium text-right">24h</th>}
            <th className="px-3 py-2 font-medium text-right">{board === "discovery_lab" ? "FDV" : "Market Cap"}</th>
            <th className="px-3 py-2 font-medium text-right">Liquidity</th>
            <th className="px-3 py-2 font-medium text-right">{board === "discovery_lab" ? "Vol 5m" : "Vol 24h"}</th>
            {board === "discovery_lab" && <th className="px-3 py-2 font-medium">Risk</th>}
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
                {/* 路径式详情页在静态导出下无客户端路由，走整页加载经 _redirects 重写 */}
                <a href={`/token/${tok.chain}/${tok.address}`} className="flex items-center gap-2">
                  <TokenLogo logo={tok.logo} symbol={tok.symbol ?? "?"} />
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium text-foreground">{tok.symbol ?? "?"}</span>
                    <span className="max-w-[160px] truncate text-xs text-muted">{tok.name ?? tok.symbol}</span>
                  </div>
                </a>
              </td>
              {board === "discovery_lab" && <td className="px-3 py-2"><DiscoveryReasons discovery={tok.discovery} /></td>}
              <td className="px-3 py-2">
                <ChainBadge chainId={tok.chain} />
              </td>
              <td className="px-3 py-2 tabular text-muted">{fmtAge(tok.created_at)}</td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.price}>{fmtPrice(tok.price)}</Flash>
              </td>
              <td className="px-3 py-2 text-right">
                <Flash value={board === "discovery_lab" ? tok.price_change_5min : tok.price_change_1h}>
                  <PctBadge value={board === "discovery_lab" ? tok.price_change_5min : tok.price_change_1h} />
                </Flash>
              </td>
              {board !== "gainers" && <td className="px-3 py-2 text-right">
                <Flash value={tok.price_change_24h}>
                  <PctBadge value={tok.price_change_24h} />
                </Flash>
              </td>}
              <td className="px-3 py-2 tabular text-right">
                <Flash value={board === "discovery_lab" ? tok.market_cap_diluted : tok.market_cap}>{fmtCompact(board === "discovery_lab" ? tok.market_cap_diluted : tok.market_cap)}</Flash>
              </td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={tok.liquidity}>{fmtCompact(tok.liquidity)}</Flash>
              </td>
              <td className="px-3 py-2 tabular text-right">
                <Flash value={board === "discovery_lab" ? tok.discovery?.volume_5m : tok.volume_24h}>{fmtCompact(board === "discovery_lab" ? tok.discovery?.volume_5m : tok.volume_24h)}</Flash>
              </td>
              {board === "discovery_lab" && <td className="px-3 py-2"><DiscoveryRisk token={tok} /></td>}
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
 * Gainers 支持多链合并；成员与排序由服务端决定，测试榜独立订阅。
 */
type Tab = BoardName | "watchlist" | "discovery_candidates";

export function TokenTable({ initialTrending, initialBoard = "trending" }: { initialTrending: TokenMarket[] | null; initialBoard?: BoardName | "discovery_candidates" }) {
  const [tab, setTab] = useState<Tab>(initialBoard);
  const [gainersChains, setGainersChains] = useState<Chain[]>([]);
  const isBoard = tab !== "watchlist" && tab !== "discovery_candidates";
  // 启动快照只属于 Trending：切到其它榜时绝不能拿它冒充新榜快照。
  const initial = tab === "trending" ? initialTrending ?? undefined : undefined;
  const scope = tab === "gainers" ? gainersChains.join(",") : undefined;
  const { items, status, discovery } = useBoardStream(isBoard ? tab : null, initial, scope);
  const rows = items;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {([...BOARDS, "discovery_candidates", "watchlist"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {t === "watchlist" ? "★ Watchlist" : t === "discovery_candidates" ? "候选全量 · 研究" : BOARD_LABELS[t as BoardName]}
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
            {status === "live" ? "Live" : status === "fallback" ? "Polling" : status === "rejected" || status === "error" ? "Unavailable" : "Connecting…"}
          </span>
        )}
      </div>

      {tab === "discovery_lab" && <div className="space-y-1 border-b border-border px-4 py-3 text-sm" role="note">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">机会榜 · 临时测试</p><a href="/discovery-tuning" className="rounded border border-border px-3 py-1.5 text-sm">打开权重实验室</a></div>
        <p className="text-muted">跨链发现 · 流动性 ≥ $20K · 5 分钟成交额 ≥ $1K · 5 分钟独立买家 ≥ 10 · 不设 FDV 上限。</p>
        <p className="text-muted">短期热门、突然放量、新币起势、上涨异动、持续热门五路发现，约每 30 秒筛选并执行风险准入。展开“入选理由”可查看发现时的指标；理由与当前行情可能不同。FDV 为完全稀释估值。</p>
        <DiscoveryWeights coverage={discovery} />
        <DiscoveryStatus coverage={discovery} />
      </div>}

      {tab === "gainers" && <fieldset className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <legend className="sr-only">Gainers chains</legend>
        <span className="text-xs text-muted">Chain · {gainersChains.length ? "Selected chains" : "All chains"}</span>
        {CHAINS.map((chain) => <label key={chain} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={gainersChains.includes(chain)} onChange={() => setGainersChains((current) => current.includes(chain) ? current.filter((value) => value !== chain) : [...current, chain])} />
          {chainLabel(chain)}
        </label>)}
        {!!gainersChains.length && <button type="button" className="text-sm underline" onClick={() => setGainersChains([])}>清除筛选</button>}
        <p className="w-full text-xs text-muted">指定发射台代币 · 按近 1h 正涨幅排名</p>
      </fieldset>}

      {tab === "discovery_candidates" ? <DiscoveryResearch /> : tab === "watchlist" ? (
        <WatchlistPanel />
      ) : status === "rejected" ? (
        <EmptyState>This board is not available in the current backend environment.</EmptyState>
      ) : status === "error" ? (
        <><p role="status" className="px-4 py-3 text-sm text-muted">榜单暂时无法更新，正在重试。{rows.length > 0 ? "以下为最近一次结果。" : ""}</p>{rows.length > 0 && <TokenRows tokens={rows} board={tab} />}</>
      ) : status === "connecting" && items.length === 0 ? (
        <TableSkeleton />
      ) : tab === "gainers" && rows.length === 0 ? (
        <EmptyState>{gainersChains.length ? "所选链近 1h 暂无符合条件的代币" : "近 1h 暂无符合条件的代币"}</EmptyState>
      ) : (
        <TokenRows tokens={rows} board={tab} />
      )}
    </Card>
  );
}
