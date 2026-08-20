"use client";

import { useTokenStream, mobulaUrl } from "@/lib/client";
import { Card, CardHeader, Skeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtUsd, fmtAge, shortAddr } from "@/lib/format";
import type { Trade } from "@/lib/types";

/** 交易类型徽标：buy/sell 用涨跌色，其它类型（withdrawal 等）用中性灰 */
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
 * 最近成交流。轮询刷新（PoC 阶段用 SWR 轮询，后续接 WS/SSE 时只需换 useTokenStream 内部实现）。
 */
export default function TradesTab({ chainId, address }: { chainId: string; address: string }) {
  const url = mobulaUrl("token/trades", {
    blockchain: chainId,
    address,
    mode: "asset",
    limit: "30",
    offset: "0",
    sortOrder: "desc",
  });
  const { data: res, error, isLoading } = useTokenStream<{ data: Trade[] }>(url, { intervalMs: 5000 });
  const trades = res?.data ?? [];

  return (
    <Card>
      <CardHeader>Recent Trades</CardHeader>
      {isLoading && !res ? (
        <TradesTableSkeleton />
      ) : error ? (
        <ErrorState message={error instanceof Error ? error.message : String(error)} />
      ) : trades.length === 0 ? (
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
              {trades.map((tr, i) => (
                <tr key={tr.id ?? tr.transactionHash ?? i} className="border-t border-border">
                  <td className="px-3 py-2">
                    <TypeBadge type={tr.type} />
                  </td>
                  <td className="tabular px-3 py-2 text-right text-foreground">{fmtUsd(tr.baseTokenAmountUSD)}</td>
                  <td className="tabular px-3 py-2 text-right text-foreground">{fmtUsd(tr.baseTokenPriceUSD)}</td>
                  <td className="px-3 py-2 font-mono text-muted" title={tr.swapSenderAddress}>
                    {shortAddr(tr.swapSenderAddress)}
                  </td>
                  <td className="px-3 py-2 text-muted">{tr.platform?.name ?? "—"}</td>
                  <td className="tabular px-3 py-2 text-right text-muted" title={tr.transactionHash}>
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
