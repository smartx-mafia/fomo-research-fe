'use client';
import {Fragment, useState, type ReactNode} from 'react';
import Link from 'next/link';
import {ApiError} from '@/api/envelope';
import {PortfolioDataError, type PortfolioCycleScope, type PortfolioPosition} from '@/api/portfolio';
import {useProgressivePortfolio, type PartState} from '@/hooks/useProgressivePortfolio';
import {ProgressivePortfolioChart} from './ProgressivePortfolioChart';
import {PortfolioCycleTrades} from './PortfolioCycles';
import {PortfolioTokenIdentity} from './PortfolioTokenIdentity';
import {formatDecimalExact, formatBaseUnitsExact, marketValueFromBaseUnits} from '@/lib/exact-decimal';
import type {PartName, PositionFilters} from '@/api/portfolio-parts';

const usd = (v?: string) => v === undefined ? '—' : `$${formatDecimalExact(v, 8)}`;
type OpenCycle = (scope: PortfolioCycleScope) => void;
export function ProgressivePortfolio({identifier, bearer, renderPosition, renderHistory}: {
  identifier: string; bearer?: string;
  renderPosition?: (position: PortfolioPosition, open: OpenCycle) => ReactNode;
  renderHistory?: (open: OpenCycle, epoch?: string) => ReactNode;
}) {
  const portfolio = useProgressivePortfolio(identifier, bearer);
  const {parts, window, filters} = portfolio;
  const [cycle, setCycle] = useState<{scope: PortfolioCycleScope; read: string}>();
  const current = parts.current.data, history = parts['history-curves'].data, positions = parts.positions.data;
  const read = positions?.meta.read_id ?? '';
  const incompletePositions = !!positions && (!!positions.quantity_completeness && positions.quantity_completeness !== 'complete' || !!positions.completeness && positions.completeness !== 'complete');
  const open: OpenCycle = scope => setCycle({scope, read});
  const cash = current && !parts.current.stale ? current.cash_balance_usd : parts.cash.data?.cash_balance_usd;
  const fatal = Object.values(parts).find(p => p.error instanceof ApiError && [400000, 200102].includes(p.error.code))?.error;
  function status(name: PartName, label: string) {
    const part: PartState = parts[name];
    return <>
      {part.stale && part.data ? <p role="status" className="text-xs text-muted">{label}: showing the previous snapshot while refreshing.</p> : null}
      {part.loading ? <p role="status" className="text-sm text-muted">Loading {label}…</p> : null}
      {part.error ? <div role="alert" className="my-2 rounded border border-down/40 p-3 text-sm">
        {label}: {part.error.message}
        {part.error instanceof ApiError || part.error instanceof PortfolioDataError ? <span className="block text-xs">{part.error instanceof ApiError ? `Code ${part.error.code} · ` : ''}Trace {part.error.traceID ?? 'unavailable'}</span> : null}
        {!(part.error instanceof ApiError && [400000, 200102, 430139].includes(part.error.code)) ? <button type="button" className="ml-3 underline" onClick={() => portfolio.retry(name)}>Retry {label}</button> : null}
      </div> : null}
      {part.data?.partial_errors.length ? <p role="status" className="text-xs text-accent">Partial portfolio · {part.data.partial_errors.map(e => e.reason).join(', ')}</p> : null}
    </>;
  }
  if (fatal) return <div role="alert">{fatal instanceof ApiError && fatal.code === 200102 ? 'User unavailable.' : <Link href="/login">Session expired. Please sign in again.</Link>}{fatal instanceof ApiError ? <p className="text-xs">Code {fatal.code} · Trace {fatal.traceID ?? 'unavailable'}</p> : null}</div>;
  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h2 className="text-xl font-semibold">Portfolio</h2>
      <button type="button" onClick={portfolio.refresh} className="rounded border border-border px-3 py-2">Refresh</button>
    </header>
    <div role="group" aria-label="Portfolio period" className="flex gap-3">{(['1d', '7d', '30d', 'all'] as const).map(w => <button type="button" key={w} aria-pressed={window === w} className={window === w ? 'text-accent' : 'text-muted'} onClick={() => portfolio.selectWindow(w)}>{w === '1d' ? '24H' : w === 'all' ? 'All' : w.toUpperCase()}</button>)}</div>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ['Total assets', current?.total_assets_usd], ['USDC cash', cash], ['Positions value', current?.total_value_usd],
      [`${window.toUpperCase()} PnL`, ['complete', 'partial'].includes(current?.performance_status ?? '') ? current?.pnl?.amount_usd : undefined],
    ].map(([label, value]) => <div key={label} className="rounded border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 font-mono text-xl">{usd(value)}</p></div>)}</section>
    {status('cash', 'cash')}{status('current', 'current assets')}
    {current?.consistency === 'updating' ? <p role="status">Account valuation is updating. Unavailable amounts are shown as —.</p> : null}
    {current?.performance_status && current.performance_status !== 'complete' ? <p role="status">Period performance is {current.performance_status}.</p> : null}
    {status('history-curves', 'history')}
    <ProgressivePortfolioChart key={`${window}:${history?.meta.read_id ?? ''}`} history={history} current={parts.current.stale ? undefined : current} loading={parts['history-curves'].loading} />
    <section aria-label="Open positions" className="overflow-hidden rounded border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-4 border-b border-border p-4"><h3>Current positions</h3>
        <span className="text-xs text-muted">{positions ? `${positions.positions.length} / ${positions.total_count}` : '—'} assets</span>
        <select aria-label="Position sorting" value={filters.sort} onChange={e => portfolio.selectFilters({...filters, sort: e.target.value as PositionFilters['sort']})}><option value="value_desc">Position value</option><option value="last_trade_desc">Last trade</option><option value="">Default order</option></select>
        <label className="text-xs"><input type="checkbox" checked={!filters.hide_small_value} onChange={e => portfolio.selectFilters({...filters, hide_small_value: !e.target.checked})} /> Show small positions</label>
      </div>
      <div className="px-4">{status('positions', 'positions')}</div>
      {incompletePositions ? <p role="status" className="p-4">Position inputs are incomplete.</p> : null}
      {positions?.positions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-xs"><thead className="text-muted"><tr>{(renderPosition ? ['Token', 'Shares', 'Market price', 'Position value', 'ROI', 'Total bought', 'Avg buy / share', 'Actions'] : ['Token', 'Shares', 'Position value', 'PnL', 'ROI', 'Activity']).map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>
        {positions.positions.map(p => <Fragment key={`${p.asset.chain_id}:${p.asset.kind}:${p.asset.token_address}:${p.cycle_key ?? p.opened_entry_id}`}>
          {renderPosition ? renderPosition(p, open) : <tr className="border-t border-border">
            <td className="p-3"><PortfolioTokenIdentity chain={p.asset.chain} address={p.asset.token_address} symbol={p.symbol} logo={p.logo} /></td>
            <td className="p-3">{formatBaseUnitsExact(p.shares_raw, p.decimals)}</td><td className="p-3">{usd(p.market_value_usd)}</td><td className="p-3">{usd(p.total_pnl_usd)}</td>
            <td className="p-3">{p.pnl_ratio === undefined ? '—' : `${formatDecimalExact(marketValueFromBaseUnits('100', 0, p.pnl_ratio), 2)}%`}</td>
            <td className="p-3"><button type="button" disabled={!p.cycle_key} onClick={() => open({chain: p.asset.chain, asset: p.asset.token_address, cycle_key: p.cycle_key})}>查看活动历史</button></td>
          </tr>}
        </Fragment>)}
      </tbody></table></div> : positions && !parts.positions.error && !parts.positions.loading ? <p className="p-8">{incompletePositions ? 'Holdings cannot be confirmed yet.' : 'No open positions match this filter.'}</p> : null}
      {positions?.next_cursor ? <button type="button" disabled={portfolio.moreLoading} onClick={() => void portfolio.more()} className="m-4 rounded border border-border px-3 py-2">{portfolio.moreLoading ? 'Loading…' : 'Load more positions'}</button> : null}
    </section>
    <p className="text-xs text-muted">Shares are recorded holdings, not the amount available to sell. Cash is canonical Solana USDC.</p>
    {cycle?.read === read ? <PortfolioCycleTrades key={`${identifier}:${bearer}:${JSON.stringify(cycle.scope)}`} userIdentifier={identifier} bearer={bearer} scope={cycle.scope} refreshKey={positions?.history_epoch} onClose={() => setCycle(undefined)} /> : null}
    {renderHistory?.(open, positions?.history_epoch ?? current?.history_epoch)}
  </div>;
}
