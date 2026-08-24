"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchHolders } from "@/lib/market";
import { Card, CardHeader, Skeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtUsd, fmtPct, fmtInt, num, shortAddr } from "@/lib/format";
import { HOLDER_LABELS, type HolderItem } from "@/lib/types";

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

/** 持仓列表。手动分页（Prev/Next）+ 服务端 label 过滤 */
export default function HoldersTab({ chain, address }: { chain: string; address: string }) {
  const [offset, setOffset] = useState(0);
  const [label, setLabel] = useState("");

  const { data: holdersData, error, isLoading } = useSWR<HolderItem[]>(
    ["holders", chain, address, offset, label],
    () => fetchHolders(chain, address, { limit: LIMIT, offset, label: label || undefined })
  );
  const holders = holdersData ?? [];
  const hasNext = holders.length >= LIMIT;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-muted">Holders</span>
        <select
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setOffset(0);
          }}
          className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground"
        >
          <option value="">All labels</option>
          {HOLDER_LABELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {isLoading && !holdersData ? (
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
