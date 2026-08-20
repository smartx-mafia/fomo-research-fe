"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { PulseResponse, PulseToken } from "@/lib/types";
import { fmtPrice, fmtCompact, fmtInt, fmtAge, chainToSlug, num } from "@/lib/format";
import { Card, ChainBadge, PctBadge, Skeleton, EmptyState } from "@/components/ui";
import { buildPulseViews, TABS, TAB_LABELS, type TabName } from "@/lib/pulseViews";

/**
 * The real /pulse response does NOT match the flat shape implied by the
 * PulseToken type for identity fields: address/chainId/symbol/name/logo live
 * under `pair.token0` or `pair.token1` (whichever `pair.baseToken` points at),
 * and a few metrics use different casing than declared (`holders_count` not
 * `holdersCount`, `market_cap` not `marketCap`, liquidity only under `pair`).
 * This shape is undocumented in types.ts (pulse isn't in the official OpenAPI
 * spec), so we normalize here rather than touch the shared type file.
 */
interface RawPairToken {
  address?: string;
  chainId?: string;
  symbol?: string;
  name?: string;
  logo?: string;
}
interface RawPair {
  token0?: RawPairToken;
  token1?: RawPairToken;
  baseToken?: "token0" | "token1";
  liquidity?: number;
  blockchain?: string;
}

interface DisplayToken {
  key: string;
  address: string;
  chainId: string;
  symbol: string;
  name: string;
  logo?: string;
  price?: number;
  priceChange1h?: unknown;
  priceChange24h?: unknown;
  marketCap?: number;
  liquidity?: number;
  volume24h?: unknown;
  holdersCount?: number;
  createdAt?: unknown;
  bonded?: boolean;
  bondingPercentage?: number;
}

function deriveDisplayToken(t: PulseToken, idx: number): DisplayToken {
  const pair = (t.pair ?? undefined) as RawPair | undefined;
  const base = pair?.baseToken === "token0" ? pair.token0 : pair?.token1;

  const address = base?.address ?? (typeof t.address === "string" ? t.address : undefined) ?? `unknown-${idx}`;
  const chainId =
    base?.chainId ??
    pair?.blockchain ??
    (typeof t.chainId === "string" ? t.chainId : undefined) ??
    "unknown";
  const rawTokenSymbol = t.tokenSymbol;
  const rawTokenName = t.tokenName;
  const symbol = (typeof rawTokenSymbol === "string" && rawTokenSymbol) || base?.symbol || t.symbol || "?";
  const name = (typeof rawTokenName === "string" && rawTokenName) || base?.name || t.name || symbol;
  const logo = base?.logo ?? t.logo;

  return {
    key: address + chainId,
    address,
    chainId,
    symbol,
    name,
    logo,
    price: num(t.price) ?? num(t.latest_price),
    priceChange1h: t.price_change_1h,
    priceChange24h: t.price_change_24h,
    marketCap: num(t.market_cap) ?? num(t.marketCap),
    liquidity: num(pair?.liquidity) ?? num(t.liquidity),
    volume24h: t.volume_24h,
    holdersCount: num(t.holders_count) ?? num(t.holdersCount),
    createdAt: t.created_at ?? t.createdAt,
    bonded: typeof t.bonded === "boolean" ? t.bonded : undefined,
    bondingPercentage: num(t.bondingPercentage),
  };
}

const postFetcher = (chains: string[]) => async (url: string) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetMode: true, filterQuotes: true, views: buildPulseViews(chains) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<PulseResponse>;
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

function TokenRows({ tokens }: { tokens: DisplayToken[] }) {
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
            <tr key={tok.key} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
              <td className="px-3 py-2">
                <Link href={`/token/${chainToSlug(tok.chainId)}/${tok.address}`} className="flex items-center gap-2">
                  <TokenLogo logo={tok.logo} symbol={tok.symbol} />
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium text-foreground">{tok.symbol}</span>
                    <span className="max-w-[160px] truncate text-xs text-muted">{tok.name}</span>
                  </div>
                </Link>
              </td>
              <td className="px-3 py-2">
                <ChainBadge chainId={tok.chainId} />
              </td>
              <td className="px-3 py-2 tabular text-muted">{fmtAge(tok.createdAt)}</td>
              <td className="px-3 py-2 tabular text-right">{fmtPrice(tok.price)}</td>
              <td className="px-3 py-2 text-right">
                <PctBadge value={tok.priceChange1h} />
              </td>
              <td className="px-3 py-2 text-right">
                <PctBadge value={tok.priceChange24h} />
              </td>
              <td className="px-3 py-2 tabular text-right">{fmtCompact(tok.marketCap)}</td>
              <td className="px-3 py-2 tabular text-right">{fmtCompact(tok.liquidity)}</td>
              <td className="px-3 py-2 tabular text-right">{fmtCompact(tok.volume24h)}</td>
              <td className="px-3 py-2 tabular text-right">{fmtInt(tok.holdersCount)}</td>
              <td className="px-3 py-2">
                <BondingBar pct={tok.bondingPercentage} bonded={tok.bonded} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TokenTable({ initialData, chains }: { initialData: PulseResponse; chains: string[] }) {
  const [tab, setTab] = useState<TabName>("trending");

  // Polling implementation (SWR + fallbackData + refreshInterval), swap-in point for a future
  // WebSocket/SSE stream — same pattern as useTokenStream in lib/client.ts, but POST-based since
  // /api/mobula/pulse takes the 4-view body as a POST, not a GET query string.
  const { data, error, isLoading } = useSWR<PulseResponse>(
    ["/api/mobula/pulse", chains.join(",")],
    () => postFetcher(chains)("/api/mobula/pulse"),
    {
      fallbackData: initialData,
      refreshInterval: 5000,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    }
  );

  const activeData = data ?? initialData;

  const rows = useMemo(() => {
    const list = activeData[tab]?.data ?? [];
    return list.map((t, i) => deriveDisplayToken(t, i));
  }, [activeData, tab]);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {error && <span className="text-xs text-down">Live updates paused: {error.message}</span>}
      </div>

      {isLoading && !activeData[tab] ? <TableSkeleton /> : <TokenRows tokens={rows} />}
    </Card>
  );
}
