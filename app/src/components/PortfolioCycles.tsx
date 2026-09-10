'use client';

import {useEffect, useRef} from 'react';
import useSWRInfinite from 'swr/infinite';
import {ApiError} from '@/api/envelope';
import {getClosedPortfolioPositions, getPortfolioCycleTrades, PortfolioDataError, type PortfolioClosedPage, type PortfolioCycleScope, type PortfolioTradePage} from '@/api/portfolio';
import {TradeRow} from '@/components/PortfolioActivity';
import {formatDecimalExact, decimalSign, marketValueFromBaseUnits} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {clearSite, readSite} from '@/session/storage';
import {PortfolioTokenIdentity} from '@/components/PortfolioTokenIdentity';

async function protectedRead<T>(jwt: string, read: () => Promise<T>): Promise<T> {
  try {return await read();} catch (error) {
    if (error instanceof ApiError && error.code === 400000 && readSite()?.jwt === jwt) clearSite();
    throw error;
  }
}
function unique<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {const id = key(row); if (seen.has(id)) return false; seen.add(id); return true;});
}
function usd(value?: string, digits = 2) {
  if (value === undefined) return '—';
  const formatted = formatDecimalExact(value, digits);
  return `$${formatted === '0' && decimalSign(value) !== 0 ? formatDecimalExact(value, 20) : formatted}`;
}
function ReadError({error, retry, reset}: {error: Error; retry: () => void; reset: () => void}) {
  return <div role="alert" className="m-4 rounded border border-down/40 bg-down/5 p-3 text-sm text-down">
    <p>{error instanceof ApiError && error.code === 430114 ? 'Invitation access required.' : error.message}</p>
    {error instanceof ApiError || error instanceof PortfolioDataError ? <p className="mt-1 text-xs">{error instanceof ApiError ? `Code ${error.code} · ` : ''}Trace {error.traceID ?? 'unavailable'}</p> : null}
    <button type="button" onClick={retry} className="mt-2 mr-4 underline">Retry</button>
    <button type="button" onClick={reset} className="mt-2 underline">Reload from newest</button>
  </div>;
}

export function ClosedPortfolioPositions({bearer, onOpenCycle}: {bearer: string; onOpenCycle: (scope: PortfolioCycleScope) => void}) {
  const getKey = (index: number, previous: PortfolioClosedPage | null) => index > 0 && !previous?.next_cursor ? null : ['portfolio-closed-cycles', bearer, index === 0 ? '' : previous!.next_cursor!] as const;
  const {data, error, isLoading, isValidating, size, setSize, mutate} = useSWRInfinite<PortfolioClosedPage, Error, typeof getKey>(getKey,
    ([, jwt, cursor]) => protectedRead(jwt, () => getClosedPortfolioPositions(jwt, cursor)),
    {persistSize: false, keepPreviousData: false, revalidateOnFocus: true, shouldRetryOnError: false});
  const rows = unique(data?.flatMap((page) => page.items) ?? [], (row) => `${row.asset.chain_id}:${row.asset.kind}:${row.asset.token_address}:${row.opened_entry_id}`);
  const reset = () => {void setSize(1).then(() => mutate());};
  return <section aria-label="Closed positions" className="overflow-hidden rounded-lg border border-border bg-surface">
    <header className="flex items-center justify-between gap-3 border-b border-border p-4"><div><h2 className="font-semibold">Closed positions</h2><p className="mt-1 text-xs text-muted">Each completed holding cycle is listed separately, newest opening first.</p></div><button type="button" disabled={isValidating} onClick={reset} className="text-xs text-accent disabled:opacity-50">Refresh closed</button></header>
    {error ? <ReadError error={error} retry={() => void mutate()} reset={reset} /> : null}
    {isLoading ? <p role="status" className="p-6 text-sm text-muted">Loading closed positions…</p> : !error && rows.length === 0 ? <p className="p-6 text-sm text-muted">No closed holding cycles.</p> : null}
    {rows.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs">
      <thead className="text-muted"><tr>{['Token', 'PnL', 'ROI', 'Total bought', 'Total sold', 'Avg buy / share', 'Avg sell / share', ''].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.asset.chain_id}:${row.asset.kind}:${row.asset.token_address}:${row.opened_entry_id}`} className="border-t border-border align-top">
        <td className="p-3"><PortfolioTokenIdentity chain={row.asset.chain} address={row.asset.token_address} symbol={row.symbol} logo={row.logo} /></td>
        <td className={`p-3 text-right font-mono ${decimalSign(row.realized_pnl_usd) === 1 ? 'text-up' : decimalSign(row.realized_pnl_usd) === -1 ? 'text-down' : 'text-muted'}`}>{usd(row.realized_pnl_usd)}</td>
        <td className={`p-3 text-right font-mono ${decimalSign(row.pnl_ratio) === 1 ? 'text-up' : decimalSign(row.pnl_ratio) === -1 ? 'text-down' : 'text-muted'}`}>{row.pnl_ratio === undefined ? '—' : `${formatDecimalExact(marketValueFromBaseUnits('100', 0, row.pnl_ratio), 4)}%`}</td>
        <td className="p-3 text-right font-mono">{usd(row.buy_value_usd)}</td>
        <td className="p-3 text-right font-mono">{usd(row.sell_value_usd)}</td>
        <td className="p-3 text-right font-mono">{usd(row.avg_buy_price_usd, 12)}</td>
        <td className="p-3 text-right font-mono">{usd(row.avg_sell_price_usd, 12)}</td>
        <td className="p-3"><button type="button" onClick={() => onOpenCycle({chain: row.asset.chain, asset: row.asset.token_address, opened_entry_id: row.opened_entry_id})} className="whitespace-nowrap text-accent underline">Cycle trades</button></td>
      </tr>)}</tbody>
    </table></div> : null}
    {data?.at(-1)?.next_cursor ? <button type="button" disabled={isValidating || !!error} onClick={() => void setSize(size + 1)} className="m-4 rounded border border-border px-3 py-2 text-xs disabled:opacity-50">{isValidating ? 'Loading…' : 'Load more closed'}</button> : null}
  </section>;
}

/** Parent keys this panel by account + chain + asset + cycle to isolate pagination. */
export function PortfolioCycleTrades({bearer, scope, onClose}: {bearer: string; scope: PortfolioCycleScope; onClose: () => void}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {heading.current?.focus({preventScroll: true}); heading.current?.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});}, []);
  const getKey = (index: number, previous: PortfolioTradePage | null) => index > 0 && !previous?.next_cursor ? null : ['portfolio-cycle-trades', bearer, scope.chain, scope.asset, scope.opened_entry_id, index === 0 ? '0' : previous!.next_cursor!] as const;
  const {data, error, isLoading, isValidating, size, setSize, mutate} = useSWRInfinite<PortfolioTradePage, Error, typeof getKey>(getKey,
    ([, jwt, chain, asset, opened_entry_id, cursor]) => protectedRead(jwt, () => getPortfolioCycleTrades(jwt, {chain, asset, opened_entry_id}, cursor)),
    {persistSize: false, keepPreviousData: false, revalidateOnFocus: true, shouldRetryOnError: false});
  const rows = unique(data?.flatMap((page) => page.trades) ?? [], (row) => row.trade_id);
  const reset = () => {void setSize(1).then(() => mutate());};
  return <section aria-label="Holding cycle trades" className="overflow-hidden rounded-lg border border-accent/40 bg-surface">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><h2 ref={heading} tabIndex={-1} className="font-semibold outline-none">Holding cycle trades</h2><p className="mt-1 break-all text-xs text-muted">{chainLabel(scope.chain)} · {scope.asset} · Cycle {scope.opened_entry_id}</p></div><div className="flex gap-4 text-xs"><button type="button" disabled={isValidating} onClick={reset} className="text-accent disabled:opacity-50">Refresh cycle</button><button type="button" onClick={onClose} className="text-muted">Close cycle trades</button></div></header>
    <p className="border-b border-border px-4 py-3 text-xs text-muted">Executed trades for this holding cycle, newest first. Quantity, USD value and price use actual settlement amounts; unavailable legacy values show —.</p>
    {error ? <ReadError error={error} retry={() => void mutate()} reset={reset} /> : null}
    {isLoading ? <p role="status" className="p-6 text-sm text-muted">Loading cycle trades…</p> : !error && rows.length === 0 ? <p className="p-6 text-sm text-muted">No trades returned for this cycle. Its ledger attribution may have changed; refresh positions and select the cycle again.</p> : null}
    {rows.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left"><thead className="text-[11px] uppercase text-muted"><tr><th className="px-3 py-2">Token</th><th className="px-3 py-2">Side</th><th className="px-3 py-2 text-right">Execution price</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2 text-right">Trade value</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Transaction</th></tr></thead><tbody>{rows.map((trade) => <TradeRow key={trade.trade_id} trade={trade} />)}</tbody></table></div> : null}
    {data?.at(-1)?.next_cursor ? <button type="button" disabled={isValidating || !!error} onClick={() => void setSize(size + 1)} className="m-4 rounded border border-border px-3 py-2 text-xs disabled:opacity-50">{isValidating ? 'Loading…' : 'Load more cycle trades'}</button> : null}
  </section>;
}
