"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchHolders, MarketApiError } from "@/lib/market";
import { Card, CardHeader, Skeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtUsd, fmtPct, fmtInt, num, shortAddr } from "@/lib/format";
import type { HolderItem } from "@/lib/types";

const LIMIT = 20;

function pnlColor(v: unknown): string {
  const n = num(v);
  if (n === undefined) return "text-muted";
  return n >= 0 ? "text-up" : "text-down";
}

function HoldersTableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/**
 * 持仓列表（2026-09 口径）。手动分页（Prev/Next），按需翻页、不预取。
 * - 500097 = 上游档位未开通：整个 tab 显示"暂不可用"，不重试、不渲染成空列表；
 * - label 过滤已暂停（非空值回 100307），筛选器整体移除；
 * - PnL / buys / sells 均为近 1 年窗口；列表只含经 DEX 建仓的钱包（口径说明见表头）；
 * - 数据每 6 小时更新（服务端缓存 300s），不做任何轮询。
 */
export default function HoldersTab({ chain, address }: { chain: string; address: string }) {
  const [offset, setOffset] = useState(0);

  const { data: holdersData, error, isLoading } = useSWR<HolderItem[]>(
    ["holders", chain, address, offset],
    () => fetchHolders(chain, address, { limit: LIMIT, offset }),
    { shouldRetryOnError: false, revalidateOnFocus: false, refreshInterval: 0 }
  );
  const holders = holdersData ?? [];
  const hasNext = holders.length >= LIMIT;
  const unavailable = error instanceof MarketApiError && error.code === 500097;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-muted">Holders</span>
        <span className="text-[11px] text-muted">DEX-acquired wallets · updated every 6h · PnL window: 1y</span>
      </div>
      {unavailable ? (
        <EmptyState>Holder data is temporarily unavailable.</EmptyState>
      ) : isLoading && !holdersData ? (
        <HoldersTableSkeleton />
      ) : error ? (
        <ErrorState message={error instanceof Error ? error.message : String(error)} />
      ) : holders.length === 0 ? (
        <EmptyState>No holders found</EmptyState>
      ) : (
        <>
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Wallet</th>
                  <th className="px-3 py-2 text-right font-medium">Holding</th>
                  <th className="px-3 py-2 text-right font-medium">Avg Buy</th>
                  <th className="px-3 py-2 text-right font-medium">Realized PnL (1y)</th>
                  <th className="px-3 py-2 text-right font-medium">Unrealized PnL</th>
                  <th className="px-3 py-2 text-right font-medium">Buys/Sells (1y)</th>
                  <th className="px-3 py-2 text-left font-medium">Labels</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((h, i) => (
                  <tr key={h.wallet_address ?? i} className="border-t border-border">
                    <td className="tabular px-3 py-2 text-muted">{offset + i + 1}</td>
                    <td className="px-3 py-2 font-mono text-foreground" title={h.wallet_address}>
                      {shortAddr(h.wallet_address)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-foreground">
                      {fmtUsd(h.token_amount_usd)}{" "}
                      <span className="text-muted">({fmtPct(h.percentage_of_total_supply, { sign: false })})</span>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-muted">{fmtUsd(h.avg_buy_price_usd)}</td>
                    <td className={`tabular px-3 py-2 text-right ${pnlColor(h.realized_pnl_usd)}`}>
                      {fmtUsd(h.realized_pnl_usd)}
                    </td>
                    <td className={`tabular px-3 py-2 text-right ${pnlColor(h.unrealized_pnl_usd)}`}>
                      {fmtUsd(h.unrealized_pnl_usd)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-muted">
                      <span className="text-up">{fmtInt(h.buys)}</span>
                      {" / "}
                      <span className="text-down">{fmtInt(h.sells)}</span>
                    </td>
                    <td className="px-3 py-2">
                      {h.labels && h.labels.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {h.labels.map((l) => (
                            <span
                              key={l}
                              className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              disabled={offset === 0}
              className="rounded border border-border px-2.5 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-[11px] text-muted">
              {offset + 1}–{offset + holders.length}
            </span>
            <button
              type="button"
              onClick={() => setOffset((o) => o + LIMIT)}
              disabled={!hasNext}
              className="rounded border border-border px-2.5 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
