"use client";

import { useState } from "react";
import useSWR from "swr";
import { mobulaUrl, swrFetcher } from "@/lib/client";
import { Card, CardHeader, Skeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtUsd, fmtPct, fmtInt, num, shortAddr } from "@/lib/format";
import type { HolderPosition } from "@/lib/types";

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
 * 持仓列表。手动分页（Prev/Next），非自动刷新场景，直接用 useSWR，
 * 后续接 WS/SSE 时按需要换成 useTokenStream。
 */
export default function HoldersTab({ chainId, address }: { chainId: string; address: string }) {
  const [offset, setOffset] = useState(0);
  const url = mobulaUrl("token/holder-positions", {
    blockchain: chainId,
    address,
    limit: String(LIMIT),
    offset: String(offset),
  });
  const { data: res, error, isLoading } = useSWR<{ data: HolderPosition[] }>(url, swrFetcher);
  const holders = res?.data ?? [];
  const hasNext = holders.length >= LIMIT;

  return (
    <Card>
      <CardHeader>Holders</CardHeader>
      {isLoading && !res ? (
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
                  <th className="px-3 py-2 text-right font-medium">Realized PnL</th>
                  <th className="px-3 py-2 text-right font-medium">Unrealized PnL</th>
                  <th className="px-3 py-2 text-right font-medium">Buys/Sells</th>
                  <th className="px-3 py-2 text-left font-medium">Labels</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((h, i) => (
                  <tr key={h.walletAddress ?? i} className="border-t border-border">
                    <td className="tabular px-3 py-2 text-muted">{offset + i + 1}</td>
                    <td className="px-3 py-2 font-mono text-foreground" title={h.walletAddress}>
                      {shortAddr(h.walletAddress)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-foreground">
                      {fmtUsd(h.tokenAmountUSD)}{" "}
                      <span className="text-muted">({fmtPct(h.percentageOfTotalSupply, { sign: false })})</span>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-muted">{fmtUsd(h.avgBuyPriceUSD)}</td>
                    <td className={`tabular px-3 py-2 text-right ${pnlColor(h.realizedPnlUSD)}`}>
                      {fmtUsd(h.realizedPnlUSD)}
                    </td>
                    <td className={`tabular px-3 py-2 text-right ${pnlColor(h.unrealizedPnlUSD)}`}>
                      {fmtUsd(h.unrealizedPnlUSD)}
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
