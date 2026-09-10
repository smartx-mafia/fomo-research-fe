'use client';

import {useEffect, useId, useMemo, useState} from 'react';
import useSWR from 'swr';
import {getPortfolioBalanceCurve, PortfolioDataError, type PortfolioBalanceCurve, type PortfolioPnl, type ProtoTimestamp, type WindowPnl} from '@/api/portfolio';
import {ApiError} from '@/api/envelope';
import {clearSite, readSite} from '@/session/storage';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';
import {PNL_PERIODS, pnlGeometry, pnlWindow, formatPnlTime, pnlTimeParts, balanceForPnlTick, type PnlPeriod} from '@/lib/portfolio-pnl';

function usd(value?: string) {
  if (value === undefined) return '—';
  const formatted = formatDecimalExact(value, 8);
  return `$${formatted === '0' && decimalSign(value) !== 0 ? formatDecimalExact(value, 20) : formatted}`;
}
function tick(value?: string) {
  const formatted = usd(value);
  return value !== undefined && formatted.length > 16 ? `$${Number(value).toExponential(2)}` : formatted;
}

function PnlPlot({window, period, nowMs, balance, balanceLoading, balanceError}: {window?: WindowPnl; period: PnlPeriod; nowMs: number; balance?: PortfolioBalanceCurve; balanceLoading: boolean; balanceError?: Error}) {
  const geometry = useMemo(() => pnlGeometry(window?.curve, period, nowMs, window?.amount_usd), [window?.curve, window?.amount_usd, period, nowMs]);
  const [selected, setSelected] = useState<number>();
  const id = useId();
  const point = geometry.ticks[selected ?? geometry.ticks.length - 1] ?? geometry.ticks.at(-1);
  if (!point) return <div role="status" className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted">
    {window?.amount_usd === undefined ? 'PnL history is unavailable for this period. A baseline or complete valuation may not be available yet.' : 'No historical samples available for this period yet.'}
  </div>;
  const color = decimalSign(window?.amount_usd ?? geometry.points.at(-1)?.pnl_usd) === -1 ? 'text-down' : 'text-up';
  const assets = balanceError ? undefined : balanceForPnlTick(point, balance);
  // Keep every tick and data point; space text labels so dense All views fit.
  const labelEvery = Math.max(1, Math.ceil(geometry.ticks.length / 10));
  return <>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted" aria-live="polite">
      {point.sampleAt && point.sampleAt !== point.at ? <span>Sample recorded {formatPnlTime(point.sampleAt)}</span> : null}
      <time dateTime={point.at}>{formatPnlTime(point.at)}</time>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>PnL <span className="font-mono text-foreground" data-testid="pnl-sample">{usd(point.pnl_usd)}</span></span>
        <span>Total assets <span className="font-mono text-foreground" data-testid="pnl-assets">{balanceLoading ? 'Loading…' : usd(assets?.amount)}</span></span>
      </div>
      {point.label === 'NOW' && assets?.at ? <span className="w-full">Assets snapshot: {formatPnlTime(assets.at)}</span> : null}
      {balanceError ? <span role="alert" className="w-full break-words text-accent">
        Total assets could not be loaded: {balanceError.message}
        {balanceError instanceof ApiError ? ` · code ${balanceError.code}` : ''}
        {balanceError instanceof ApiError || balanceError instanceof PortfolioDataError ? ` · trace ${balanceError.traceID ?? 'unavailable'}` : ''}. Refresh to retry.
      </span> : !balanceLoading && !assets ? <span className="w-full">{point.label === 'NOW'
        ? 'The total-assets response has no current value. Cash or position valuation may be unavailable.'
        : balance?.points.length === 0 ? 'The total-assets response contains no historical snapshots.'
          : `No total-assets snapshot matches ${formatPnlTime(point.sampleAt ?? point.at)}.`}</span> : null}
      {balance?.simulated ? <span className="w-full text-accent">Total assets include simulated data.</span> : null}
    </div>
    <div className="mt-2 min-w-0 w-full" role="region" aria-label="PnL samples chart">
    <svg role="img" aria-labelledby={id} viewBox={`0 0 ${geometry.width} 300`} className={`block h-[300px] w-full max-w-full ${color}`}
      onPointerLeave={() => setSelected(undefined)}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const scale = Math.min(rect.width / geometry.width, rect.height / 300);
        if (scale <= 0) return;
        const x = (event.clientX - rect.left - (rect.width - geometry.width * scale) / 2) / scale;
        let nearest = 0;
        geometry.ticks.forEach((candidate, index) => {if (Math.abs(candidate.x - x) < Math.abs(geometry.ticks[nearest].x - x)) nearest = index;});
        setSelected(nearest);
      }}>
      <title id={id}>{`${period} PnL in USD. All samples fit the chart from oldest on the left to NOW on the right. Available samples connect continuously.`}</title>
      {[26, 130, 236].map((y) => <line key={y} x1="20" x2={geometry.right} y1={y} y2={y} stroke="currentColor" className="text-border" strokeDasharray="3 5" />)}
      {geometry.zeroY !== undefined ? <line x1="20" x2={geometry.right} y1={geometry.zeroY} y2={geometry.zeroY} stroke="currentColor" className="text-muted" strokeDasharray="5 5" /> : null}
      <text x={geometry.right + 20} y="30" fontSize="11" fill="currentColor" className="text-muted">{tick(geometry.max)}</text>
      {geometry.min !== geometry.max ? <text x={geometry.right + 20} y="240" fontSize="11" fill="currentColor" className="text-muted">{tick(geometry.min)}</text> : null}
      {geometry.segments.map((segment, index) => <polyline key={index} data-testid="pnl-segment" points={segment.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      {geometry.ticks.map((p, index) => <g key={index} data-testid="pnl-tick">
        {p.y !== undefined ? <circle cx={p.x} cy={p.y} r="3" fill="currentColor" /> : null}
        <line x1={p.x} x2={p.x} y1="242" y2="248" stroke="currentColor" className="text-muted" />
        {(index === 0 || index === geometry.ticks.length - 1 || (index % labelEvery === 0 && index < geometry.ticks.length - labelEvery)) ? <text x={p.x} y="266" fontSize="11" fill="currentColor" className="text-muted" textAnchor={index === 0 ? 'start' : index === geometry.ticks.length - 1 ? 'end' : 'middle'}>
          <tspan x={p.x}>{p.label ?? pnlTimeParts(p.atMs).date.slice(5)}</tspan><tspan x={p.x} dy="15">{p.pnl_usd === undefined ? "—" : pnlTimeParts(p.atMs).time}</tspan>
        </text> : null}
      </g>)}
      <line x1={point.x} x2={point.x} y1="20" y2="242" stroke="currentColor" opacity="0.3" />
      {point.y !== undefined ? <circle cx={point.x} cy={point.y} r="4" fill="currentColor" /> : null}
    </svg>
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted"><span>{formatPnlTime(geometry.ticks[0].at)}</span><span>{formatPnlTime(geometry.ticks.at(-1)!.at)}</span></div>
    <label className="mt-4 flex items-center gap-3 text-xs text-muted">Explore samples
      <input aria-label="PnL sample" type="range" min="0" max={geometry.ticks.length - 1} step="1" value={selected ?? geometry.ticks.length - 1}
        onChange={(event) => setSelected(Number(event.target.value))} aria-valuetext={`${formatPnlTime(point.at)}: ${usd(point.pnl_usd)}`} className="min-w-0 flex-1 accent-[var(--color-accent)]" />
    </label>
    <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">View PnL data</summary>
      <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left"><thead><tr><th className="py-2">Time (UTC+08:00)</th><th className="py-2 text-right">PnL (USD)</th></tr></thead><tbody>{geometry.ticks.map((p, index) => <tr key={index} className="border-t border-border"><td className="py-2">{formatPnlTime(p.at)}</td><td className="py-2 text-right font-mono">{p.pnl_usd ?? '—'}</td></tr>)}</tbody></table></div>
    </details>
  </>;
}

export function PortfolioPnlChart({pnl, loading, refreshing, stale, observedAt, onRefresh, bearer}: {
  pnl?: PortfolioPnl; loading: boolean; refreshing: boolean; stale: boolean; observedAt?: ProtoTimestamp; onRefresh: () => void; bearer?: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [period, setPeriod] = useState<PnlPeriod>('24H');
  const balanceWindow = period === '24H' ? '1d' : period === '7D' ? '7d' : period === '30D' ? '30d' : 'all';
  const balance = useSWR(bearer ? ['portfolio-pnl-assets', bearer, balanceWindow, String(observedAt?.seconds ?? ''), observedAt?.nanos ?? 0] as const : null,
    async ([, jwt, window]) => {
      try {return await getPortfolioBalanceCurve(jwt, window);} catch (error) {
        if (error instanceof ApiError && error.code === 400000 && readSite()?.jwt === jwt) clearSite();
        throw error;
      }
    }, {keepPreviousData: false, revalidateOnFocus: true, shouldRetryOnError: false});
  const {window, amount} = pnlWindow(pnl, period);
  return <section aria-label="Portfolio PnL" className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-foreground">PnL performance</h2>
      <div className="flex items-center gap-3"><div role="group" aria-label="PnL period" className="flex rounded-lg bg-background p-1">{PNL_PERIODS.map((value) => <button key={value} type="button" aria-pressed={value === period} onClick={() => setPeriod(value)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${value === period ? 'bg-accent/15 text-accent' : 'text-muted hover:text-foreground'}`}>{value}</button>)}</div>
        <button type="button" onClick={() => {onRefresh(); if (bearer) void balance.mutate();}} disabled={refreshing || loading || balance.isValidating} className="text-xs text-accent disabled:opacity-50">{refreshing ? 'Refreshing…' : 'Refresh PnL'}</button>
      </div>
    </header>
    <p className={`mt-4 font-mono text-2xl font-semibold ${decimalSign(amount) === -1 ? 'text-down' : decimalSign(amount) === 1 ? 'text-up' : 'text-foreground'}`} data-testid="pnl-total">{loading ? 'Loading…' : usd(amount)}</p>
    <p className="mt-1 text-xs text-muted">{period === 'All' ? 'Cumulative trading PnL · excludes cash' : `Trading PnL since ${formatPnlTime(window?.baseline_as_of)} · excludes cash`}</p>
    {observedAt ? <p className="mt-1 text-xs text-muted">PnL snapshot: {formatPnlTime(new Date(Number(observedAt.seconds) * 1000).toISOString())}</p> : null}
    {window?.simulated ? <p className="mt-2 text-xs text-accent">Includes simulated data</p> : null}
    {stale ? <p role="status" className="mt-2 text-xs text-accent">Refresh failed. Showing the last available PnL snapshot.</p> : null}
    {loading ? <div role="status" className="flex min-h-64 items-center justify-center text-sm text-muted">Loading PnL history…</div> :
      <PnlPlot key={`${period}:${observedAt?.seconds ?? ''}:${observedAt?.nanos ?? 0}`} period={period} window={window} nowMs={nowMs} balance={balance.data} balanceLoading={balance.isLoading} balanceError={balance.error} />}
    <p className="mt-3 text-[11px] text-muted">Oldest to newest, with NOW at the right. UTC+08:00. 24H = 24 hourly snapshots + NOW, 7D = 42 four-hour snapshots + NOW, 30D = 30 daily snapshots + NOW; All includes every daily sample. All points fit the chart; dense labels are spaced for readability. Missing values show —.</p>
  </section>;
}
