"use client";

import { useState } from "react";
import type { TokenMarket } from "@/lib/types";
import { fmtPrice, shortAddr, chainLabel } from "@/lib/format";
import { PctBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { StarButton, useFavorites } from "@/components/FavoritesProvider";
import { useSession } from "@/session/storage";
import { useEffect } from "react";

/** 详情页头部。纯展示组件，实时数据由 TokenLive 通过 props 灌入 */
export default function TokenHeader({
  data,
  chain,
  address,
  live,
}: {
  data: TokenMarket;
  chain: string;
  address: string;
  live?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // 详情页行情端点没有 personal 字段：星标初始态用批量 status 端点查（favorites.md §4）
  const {ensureStatus} = useFavorites();
  const session = useSession();
  useEffect(() => {
    if (session) ensureStatus([{chain, address}]);
  }, [session, chain, address, ensureStatus]);

  function handleCopy() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {data.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logo} alt={data.symbol ?? "token"} className="h-11 w-11 rounded-full bg-surface-2 object-cover" />
        ) : (
          <div className="h-11 w-11 rounded-full bg-surface-2" />
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">{data.name ?? data.symbol ?? "Unknown"}</span>
            {data.symbol && <span className="text-sm text-muted">{data.symbol}</span>}
            <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {chainLabel(chain)}
            </span>
            {data.bonded !== undefined && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  data.bonded ? "bg-up/10 text-up" : "bg-accent/10 text-accent"
                }`}
              >
                {data.bonded ? "Graduated" : "Bonding"}
              </span>
            )}
            {/* 详情页行情端点不含 personal 字段，星标状态走批量 status 端点（favorites.md §4） */}
            <StarButton chain={chain} address={address} size="md" />
            <span className={`flex items-center gap-1 text-[10px] ${live ? "text-up" : "text-muted"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-up" : "animate-pulse bg-muted"}`} />
              {live ? "Live" : "Connecting"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <button
              type="button"
              onClick={handleCopy}
              className="font-mono hover:text-foreground"
              title="Copy address"
            >
              {shortAddr(address)}
            </button>
            {copied && <span className="text-accent">Copied</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span className="tabular text-xl font-semibold text-foreground">
          <Flash value={data.price}>{fmtPrice(data.price)}</Flash>
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-muted">5m</span>
            <Flash value={data.price_change_5min}>
              <PctBadge value={data.price_change_5min} />
            </Flash>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-muted">1h</span>
            <Flash value={data.price_change_1h}>
              <PctBadge value={data.price_change_1h} />
            </Flash>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-muted">24h</span>
            <Flash value={data.price_change_24h}>
              <PctBadge value={data.price_change_24h} />
            </Flash>
          </span>
        </div>
      </div>
    </div>
  );
}
