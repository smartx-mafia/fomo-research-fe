'use client';
import {useState} from 'react';
import type {PortfolioPart} from '@/api/portfolio-parts';
import {pairedPortfolioPoints} from '@/lib/portfolio-parts';
import {formatDecimalExact, marketValueFromBaseUnits, parseExactDecimal} from '@/lib/exact-decimal';
import {formatPnlTime} from '@/lib/portfolio-pnl';

const usd = (v?: string) => v === undefined ? '—' : `$${formatDecimalExact(v, 8)}`;
const roi = (v?: string) => v === undefined ? '—' : `${formatDecimalExact(marketValueFromBaseUnits('100', 0, v), 2)}%`;
export function ProgressivePortfolioChart({history, current, loading}: {history?: PortfolioPart; current?: PortfolioPart; loading: boolean}) {
  const [metric, setMetric] = useState<'pnl_usd' | 'balance_usd'>('pnl_usd');
  const [selected, setSelected] = useState<number>();
  const points = pairedPortfolioPoints(history, current);
  const sample = selected === undefined ? undefined : points[selected];
  const performance = ['complete', 'partial'].includes(current?.performance_status ?? '');
  const amount = sample ? sample[metric] : metric === 'balance_usd' ? current?.total_assets_usd : performance ? current?.pnl?.amount_usd : undefined;
  const ratio = sample ? sample.roi_ratio : performance ? current?.pnl?.roi_ratio : undefined;
  const values = points.map(p => parseExactDecimal(p[metric] ?? '0'));
  const scale = values.reduce((max, v) => Math.max(max, v.scale), 0);
  const numbers = values.map(v => v.coefficient * 10n ** BigInt(scale - v.scale));
  const low = numbers.reduce((a, b) => a < b ? a : b, numbers[0] ?? 0n), high = numbers.reduce((a, b) => a > b ? a : b, numbers[0] ?? 0n);
  const first = Date.parse(points[0]?.at ?? ''), last = Date.parse(points.at(-1)?.at ?? '');
  const coordinates = points.map((p, i) => ({x: last === first ? 460 : 20 + (Date.parse(p.at) - first) / (last - first) * 880, y: high === low ? 110 : 200 - Number((numbers[i] - low) * 180000n / (high - low)) / 1000}));
  return <section aria-label="Portfolio performance" className="rounded-lg border border-border bg-surface p-4">
    <div className="flex gap-4"><button type="button" aria-pressed={metric === 'pnl_usd'} onClick={() => setMetric('pnl_usd')}>PnL performance</button><button type="button" aria-pressed={metric === 'balance_usd'} onClick={() => setMetric('balance_usd')}>Total assets</button></div>
    <p className="mt-3 font-mono text-2xl">{usd(amount)}</p>
    <p className="text-xs text-muted">ROI {roi(ratio)} · {sample ? formatPnlTime(sample.at) : 'Current snapshot'}</p>
    {history?.pnl?.baseline_as_of ? <p className="text-xs text-muted">Baseline {formatPnlTime(history.pnl.baseline_as_of)}</p> : null}
    {loading ? <p role="status">Loading history…</p> : null}
    {points.length ? <>
      <svg viewBox="0 0 920 220" role="img" aria-label="Portfolio historical samples" className="mt-4 w-full text-accent" onPointerLeave={() => setSelected(undefined)} onPointerMove={e => {
        const rect = e.currentTarget.getBoundingClientRect(); if (!rect.width) return;
        const x = (e.clientX - rect.left) / rect.width * 920;
        let nearest = 0; coordinates.forEach((p, i) => {if (Math.abs(p.x - x) < Math.abs(coordinates[nearest].x - x)) nearest = i;}); setSelected(nearest);
      }}>
        {/* Connect the returned observations without generating intermediate samples. */}
        <polyline points={coordinates.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {coordinates.map((p, i) => <circle key={points[i].at} cx={p.x} cy={p.y} r={selected === i ? 5 : 3} fill="currentColor" />)}
      </svg>
      <input aria-label="Explore portfolio history" className="w-full" type="range" min={0} max={points.length - 1} value={selected ?? points.length - 1} onChange={e => setSelected(Number(e.target.value))} onBlur={() => setSelected(undefined)} onPointerUp={() => setSelected(undefined)} onKeyUp={() => setSelected(undefined)} />
      <div className="flex justify-between text-xs text-muted"><span>{formatPnlTime(points[0].at)}</span><span>{formatPnlTime(points.at(-1)!.at)}</span></div>
    </> : !loading ? <p className="py-10 text-sm text-muted">Historical samples are unavailable.</p> : null}
    {history?.pnl?.simulated || history?.balance?.simulated ? <p role="status">Includes simulated data.</p> : null}
  </section>;
}
