"use client";

import useSWR from "swr";
import { fetchTrades } from "@/lib/market";
import { Card, CardHeader, Skeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtUsd, fmtPrice, fmtAge, shortAddr } from "@/lib/format";
import type { TradeItem } from "@/lib/types";

/** 交易类型徽标：buy/sell 用涨跌色，其它类型（deposit/withdrawal）用中性灰 */
function TypeBadge({ type }: { type?: string }) {
  const t = (type ?? "").toLowerCase();
  if (t === "buy") {
    return <span className="rounded bg-up/10 px-1.5 py-0.5 text-[10px] font-semibold text-up">BUY</span>;
  }
  if (t === "sell") {
    return <span className="rounded bg-down/10 px-1.5 py-0.5 text-[10px] font-semibold text-down">SELL</span>;
  }
  return (
    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
      {t ? t.toUpperCase() : "—"}
    </span>
  );
}

function TradesTableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/**
 * 最近成交流。SWR 轮询（服务端有 5–15s 缓存，5s 间隔正合适；
 * 该数据没有 WS topic，轮询是正解）。
 */
export default function TradesTab({ chain, address }: { chain: string; address: string }) {
  const { data: trades, error, isLoading } = useSWR<TradeItem[]>(
    ["trades", chain, address],
    () => fetchTrades(chain, address, { limit: 30 }),
    { refreshInterval: 5000, revalidateOnFocus: true, dedupingInterval: 2000 }
  );
  const items = trades ?? [];

  return (
    <Card>
      <CardHeader>Recent Trades</CardHeader>
      {isLoading && !trades ? (
        <TradesTableSkeleton />
      ) : error ? (
        <ErrorState message={error instanceof Error ? error.message : String(error)} />
      ) : items.length === 0 ? (
        <EmptyState>No trades found</EmptyState>
      ) : (
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-left font-medium">Wallet</th>
                <th className="px-3 py-2 text-left font-medium">Platform</th>
                <th className="px-3 py-2 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tr, i) => (
                <tr key={tr.tx_hash ? `${tr.tx_hash}-${i}` : i} className="border-t border-border">
                  <td className="px-3 py-2">
                    <TypeBadge type={tr.type} />
                  </td>
                  <td className="tabular px-3 py-2 text-right text-foreground">{fmtUsd(tr.base_token_amount_usd)}</td>
                  <td className="tabular px-3 py-2 text-right text-foreground">{fmtPrice(tr.price_usd)}</td>
                  <td className="px-3 py-2 font-mono text-muted" title={tr.sender}>
                    {shortAddr(tr.sender)}
                  </td>
                  <td className="px-3 py-2 text-muted">{tr.platform_name ?? "—"}</td>
                  <td className="tabular px-3 py-2 text-right text-muted" title={tr.tx_hash}>
                    {fmtAge(tr.date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
