"use client";

import { useEffect, useState } from "react";
import {
  getSmartMoneyHoldings,
  getSmartMoneyTrades,
  type SmartMoneyHoldings,
  type SmartMoneyTrade,
  type SmartMoneyTrades,
} from "@/api/smartmoney";
import { chainLabel, fmtCompact, shortAddr } from "@/lib/format";

export function SmartMoneyProfile({ chain, address }: { chain: string; address: string }) {
  const [holdings, setHoldings] = useState<SmartMoneyHoldings | null>(null);
  const [trades, setTrades] = useState<SmartMoneyTrades | null>(null);
  const [holdingsFailed, setHoldingsFailed] = useState(false);
  const [tradesFailed, setTradesFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setHoldingsFailed(false);
    setTradesFailed(false);
    Promise.allSettled([getSmartMoneyHoldings(chain, address), getSmartMoneyTrades(chain, address)])
      .then(([holdingsResult, tradesResult]) => {
        if (!active) return;
        if (holdingsResult.status === "fulfilled") setHoldings(holdingsResult.value.data);
        else setHoldingsFailed(true);
        if (tradesResult.status === "fulfilled") setTrades(tradesResult.value.data);
        else setTradesFailed(true);
      });
    return () => {
      active = false;
    };
  }, [address, chain]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">Smart Money</span>
          <span className="text-xs text-muted">{chainLabel(chain)}</span>
        </div>
        <h1 className="mt-2 font-mono text-lg font-semibold text-foreground">{shortAddr(address, 10, 8)}</h1>
        <p className="break-all text-xs text-muted">{address}</p>
        <div className="mt-3 text-sm text-muted">
          Total PnL <span className="ml-1 font-medium text-foreground">{formatMoney(holdings?.total_profit)}</span>
          {holdings?.total_profit_ratio !== undefined && (
            <span className="ml-2">({formatRatio(holdings.total_profit_ratio)})</span>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Open holdings</h2>
        {holdingsFailed ? (
          <p className="p-4 text-sm text-muted">Holdings are temporarily unavailable.</p>
        ) : holdings === null ? (
          <p className="p-4 text-sm text-muted">Loading holdings…</p>
        ) : (holdings.open?.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-muted">No open holdings.</p>
        ) : (
          holdings.open?.map((item, index) => (
            <div key={`${item.token_address ?? "unknown"}:${index}`} className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{item.symbol ?? item.name ?? shortAddr(item.token_address ?? "", 6, 4)}</div>
                <div className="truncate text-xs text-muted">{item.is_honeypot ? "Risk flagged · " : ""}{item.name ?? item.token_address ?? "Unknown token"}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-muted">
                <div className="text-sm text-foreground">{formatMoney(item.usd_value)}</div>
                <div>PnL {formatMoney(item.total_profit)}</div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Closed holdings</h2>
        {holdingsFailed ? (
          <p className="p-4 text-sm text-muted">Holdings are temporarily unavailable.</p>
        ) : holdings === null ? (
          <p className="p-4 text-sm text-muted">Loading holdings…</p>
        ) : (holdings.closed?.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-muted">No closed holdings.</p>
        ) : (
          holdings.closed?.map((item, index) => (
            <div key={`${item.token_address ?? "unknown"}:${index}`} className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{item.symbol ?? item.name ?? shortAddr(item.token_address ?? "", 6, 4)}</div>
                <div className="truncate text-xs text-muted">{item.name ?? item.token_address ?? "Unknown token"}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-muted">
                <div className="text-sm text-foreground">Realized {formatMoney(item.realized_profit)}</div>
                <div>{formatTime(item.end_holding_at)}</div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Recent activity</h2>
        {tradesFailed ? (
          <p className="p-4 text-sm text-muted">Recent activity is temporarily unavailable.</p>
        ) : trades === null ? (
          <p className="p-4 text-sm text-muted">Loading activity…</p>
        ) : !trades.fetched_at ? (
          <p className="p-4 text-sm text-muted">Activity data has not been fetched yet.</p>
        ) : (trades.list?.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-muted">No recent activity in the latest snapshot.</p>
        ) : (
          trades.list?.map((trade: SmartMoneyTrade, index: number) => (
            <div key={`${trade.tx_hash ?? "unknown"}:${index}`} className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium capitalize text-foreground">{trade.event_type ?? "Unknown event"}</div>
                <div className="truncate text-xs text-muted">{trade.token_symbol ?? shortAddr(trade.token_address ?? "", 6, 4)}</div>
              </div>
              <div className="shrink-0 text-right text-xs text-muted">
                <div className="text-sm text-foreground">{formatMoney(trade.cost_usd)}</div>
                <div>{formatTime(trade.occurred_at)}</div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function formatMoney(raw?: string) {
  if (raw === undefined || raw === "") return "—";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}$${fmtCompact(Math.abs(value))}`;
}

function formatRatio(raw: string) {
  const value = Number(raw);
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—";
}

function formatTime(unixSeconds?: number) {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString();
}
