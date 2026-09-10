'use client';

import {ArrowDownLeft, ArrowUpRight, LoaderCircle, RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useState} from 'react';
import useSWRInfinite from 'swr/infinite';

import {ApiError} from '@/api/envelope';
import {getGlobalPortfolioTrades, type PortfolioTrade, type PortfolioTradePage, type ProtoTimestamp} from '@/api/portfolio';
import {listTransfers, type TransferEntry, type TransferPage} from '@/api/transfers';
import {formatBaseUnitsExact} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {clearSite, readSite} from '@/session/storage';
import {PortfolioTokenIdentity} from '@/components/PortfolioTokenIdentity';

type ActivityTab = 'trades' | 'transfers';

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isoTime(value: string | undefined) {
  if (!value) return '—';
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toLocaleString() : '—';
}

function protoTime(value: ProtoTimestamp) {
  const seconds = Number(value.seconds);
  if (!Number.isFinite(seconds)) return '—';
  return new Date(seconds * 1000 + (value.nanos ?? 0) / 1_000_000).toLocaleString();
}

function recordError(cause: unknown, bearer: string): never {
  if (cause instanceof ApiError && cause.code === 400000 && readSite()?.jwt === bearer) clearSite();
  throw cause;
}

function ErrorNotice({error, onReset}: {error: unknown; onReset: () => void}) {
  const apiError = error instanceof ApiError ? error : undefined;
  return (
    <div role="alert" className="m-4 rounded border border-down/40 bg-down/5 p-3 text-sm text-down">
      <p>{apiError?.code === 430114 ? 'Invitation access is required before private activity can be loaded.' : 'Activity history could not be loaded. Cached rows, if present, may be stale.'}</p>
      {apiError ? <p className="mt-1 font-mono text-xs">{apiError.reason ?? `code ${apiError.code}`} · trace {apiError.traceID ?? 'unavailable'}</p> : null}
      {apiError?.code === 100103 ? <button type="button" onClick={onReset} className="mt-2 rounded border border-down/40 px-2 py-1 text-xs">Discard cursor and reload newest</button> : null}
    </div>
  );
}

export function TradeRow({trade}: {trade: PortfolioTrade}) {
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3"><PortfolioTokenIdentity chain={trade.chain} address={trade.token} symbol={trade.symbol} name={trade.name} logo={trade.logo} /></td>
      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${trade.side === 'buy' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>{trade.side}</span></td>
      <td className="px-3 py-3 text-right font-mono text-xs">{trade.execution_price_usd === undefined ? '—' : `$${trade.execution_price_usd}`}</td>
      <td className="px-3 py-3 text-right font-mono text-xs"><p>{trade.token_amount ?? '—'} {trade.symbol ?? 'token'}</p>{trade.asset_decimals !== undefined ? <p className="mt-1 text-[10px] text-muted">{trade.asset_decimals} decimals</p> : null}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{trade.trade_value_usd === undefined ? '—' : `$${trade.trade_value_usd}`}</td>
      <td className="px-3 py-3 text-xs text-muted"><p>{isoTime(trade.created_at)}</p>{trade.confirmed_at ? <p className="mt-1 text-[10px]">Confirmed {isoTime(trade.confirmed_at)}</p> : null}</td>
      <td className="px-3 py-3"><p className="text-foreground">{trade.status}</p><p className="mt-1 text-[10px] text-muted">{trade.lifecycle}</p>{trade.fee_app ? <p className="mt-1 font-mono text-[10px] text-muted">Fee {trade.fee_app} raw · {shortAddr(trade.fee_currency)}</p> : null}</td>
      <td className="px-3 py-3 font-mono text-xs text-muted"><p>{trade.tx_chain ? chainLabel(trade.tx_chain) : '—'}</p><p className="mt-1" title={trade.tx_hash}>{shortAddr(trade.tx_hash, 8, 6)}</p><p className="mt-1" title={trade.trade_id}>Trade {shortAddr(trade.trade_id, 8, 6)}</p></td>
    </tr>
  );
}

function TransferRow({transfer}: {transfer: TransferEntry}) {
  const received = transfer.direction === 1;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${received ? 'bg-up/10 text-up' : 'bg-accent/10 text-accent'}`}>{received ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}{received ? 'Received' : 'Sent'}</span></td>
      <td className="px-3 py-3 font-mono text-xs text-foreground">{formatBaseUnitsExact(transfer.amount_raw, transfer.asset_decimals)} {transfer.asset_symbol}</td>
      <td className="px-3 py-3"><p className="text-xs text-foreground">{chainLabel(transfer.chain)}</p><p className="mt-1 font-mono text-[10px] text-muted" title={transfer.asset_address}>{shortAddr(transfer.asset_address, 7, 6)}</p></td>
      <td className="px-3 py-3 font-mono text-xs text-muted" title={transfer.counterparty}>{shortAddr(transfer.counterparty, 8, 6)}</td>
      <td className="px-3 py-3 font-mono text-xs text-muted" title={transfer.tx_hash}>{shortAddr(transfer.tx_hash, 8, 6)}</td>
      <td className="px-3 py-3 text-xs text-muted">{protoTime(transfer.occurred_at)}</td>
    </tr>
  );
}

export function PortfolioActivity({bearer}: {bearer: string}) {
  const [tab, setTab] = useState<ActivityTab>('trades');
  const getTradeKey = (index: number, previous: PortfolioTradePage | null): readonly ['portfolio-activity-trades', string, string] | null => {
      if (tab !== 'trades' || (index > 0 && !previous?.next_cursor)) return null;
      return ['portfolio-activity-trades', bearer, previous?.next_cursor ?? '0'] as const;
  };
  const trades = useSWRInfinite<PortfolioTradePage, Error, typeof getTradeKey>(
    getTradeKey,
    async ([, jwt, cursor]) => {
      try {return await getGlobalPortfolioTrades(jwt, cursor, 50);} catch (cause) {return recordError(cause, jwt);}
    },
    {persistSize: false, revalidateOnFocus: true, shouldRetryOnError: false},
  );
  const getTransferKey = (index: number, previous: TransferPage | null): readonly ['portfolio-activity-transfers', string, string] | null => {
      if (tab !== 'transfers' || (index > 0 && !previous?.next_cursor)) return null;
      return ['portfolio-activity-transfers', bearer, previous?.next_cursor ?? ''] as const;
  };
  const transfers = useSWRInfinite<TransferPage, Error, typeof getTransferKey>(
    getTransferKey,
    async ([, jwt, cursor]) => {
      try {return await listTransfers(jwt, cursor);} catch (cause) {return recordError(cause, jwt);}
    },
    {persistSize: false, revalidateOnFocus: true, shouldRetryOnError: false},
  );

  const tradeRows = uniqueBy(trades.data?.flatMap((page) => page.trades) ?? [], (item) => item.trade_id);
  const transferRows = uniqueBy(transfers.data?.flatMap((page) => page.transfers) ?? [], (item) => item.tx_hash);
  const active = tab === 'trades' ? trades : transfers;
  const activeRows = tab === 'trades' ? tradeRows : transferRows;
  const nextCursor = active.data?.at(-1)?.next_cursor;
  const reset = () => {void active.setSize(1).then(() => active.mutate());};

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div><h2 className="font-semibold text-foreground">Activity</h2><p className="text-xs text-muted">Real executed trades and finalized direct Solana USDC movements for your canonical wallets.</p></div>
        <button type="button" onClick={() => void active.mutate()} disabled={active.isValidating} className="inline-flex items-center gap-1.5 text-xs text-accent disabled:opacity-50">{active.isValidating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh</button>
      </div>
      <div role="tablist" aria-label="Portfolio activity" className="flex gap-1 border-b border-border px-4 pt-3">
        {([['trades', 'Trades'], ['transfers', 'USDC in / out']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-t-md border border-b-0 px-3 py-2 text-xs ${tab === value ? 'border-border bg-background text-foreground' : 'border-transparent text-muted hover:text-foreground'}`}>{label}</button>)}
      </div>
      {tab === 'transfers' ? <p className="border-b border-border bg-accent/5 px-4 py-3 text-xs text-muted">Received/Sent describes a mechanically proven direct USDC movement, not a SmartX Deposit or Withdrawal business status. Known order recovery remains on the <Link href="/deposit" className="text-accent hover:underline">Deposit page</Link>.</p> : <p className="border-b border-border px-4 py-3 text-xs text-muted">Quantity, USD value and execution price come from actual settlement amounts. Older or incomplete trades show — instead of an inferred value.</p>}
      {active.error ? <ErrorNotice error={active.error} onReset={reset} /> : null}
      {active.isLoading ? <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Loading {tab === 'trades' ? 'trades' : 'USDC movements'}…</p> : null}
      {!active.isLoading && !active.error && activeRows.length === 0 ? <p className="p-6 text-sm text-muted">No {tab === 'trades' ? 'executed trades' : 'direct USDC movements'} were returned.</p> : null}
      {tab === 'trades' && tradeRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left"><thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Token</th><th className="px-3 py-2">Side</th><th className="px-3 py-2 text-right">Execution price</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2 text-right">Trade value</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Transaction</th></tr></thead><tbody>{tradeRows.map((trade) => <TradeRow key={trade.trade_id} trade={trade} />)}</tbody></table></div> : null}
      {tab === 'transfers' && transferRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Direction</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Counterparty</th><th className="px-3 py-2">Transaction</th><th className="px-3 py-2">Time</th></tr></thead><tbody>{transferRows.map((transfer) => <TransferRow key={transfer.tx_hash} transfer={transfer} />)}</tbody></table></div> : null}
      {nextCursor ? <button type="button" onClick={() => void active.setSize(active.size + 1)} disabled={active.isValidating} className="m-4 rounded-md border border-border px-3 py-2 text-xs text-muted disabled:opacity-50">Load more</button> : null}
    </section>
  );
}
