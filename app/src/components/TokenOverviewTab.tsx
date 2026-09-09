'use client';

import {useState} from 'react';
import {Check, Copy, ExternalLink, Globe, RefreshCw} from 'lucide-react';
import {useTokenOverview} from '@/hooks/useTokenOverview';
import {DASH, chainLabel, fmtInt, fmtPct, fmtUsd, shortAddr} from '@/lib/format';
import {MarketApiError} from '@/lib/market';
import {overviewStatus, type OverviewStatus, type TokenOverview} from '@/lib/token-overview';

function SnapshotBadge({status, loading}: {status: OverviewStatus; loading: boolean}) {
  const label = loading ? 'Loading' : status === 'fresh' ? 'Recent snapshot' : status === 'stale' ? 'Older snapshot' : 'Not available';
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${status === 'stale' ? 'bg-amber-500/10 text-amber-500' : 'bg-surface-2 text-muted'}`}>{label}</span>;
}

function Metric({label, value, note, color = 'text-foreground', className = ''}: {label: string; value: string; note: string; color?: string; className?: string}) {
  return (
    <div className={`min-w-0 rounded-lg border border-border bg-surface-2/50 p-4 ${className}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular mt-2 break-words text-xl font-semibold tracking-tight ${value === DASH ? 'text-muted' : color}`}>{value}</dd>
      <p className="mt-1 text-[11px] text-muted">{note}</p>
    </div>
  );
}

/** Pure data presentation, also rendered with the real React serializer in regression tests. */
export function TokenOverviewContent({
  chain, address, data, now, loading = false, error, refreshing = false, onRetry,
}: {
  chain: string;
  address: string;
  data?: TokenOverview;
  now: number;
  loading?: boolean;
  error?: unknown;
  refreshing?: boolean;
  onRetry?: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const profileState = overviewStatus(data?.profile.quality, now);
  const activityState = overviewStatus(data?.activity.quality, now);
  const holderState = overviewStatus(data?.holder_summary.quality, now, true);
  const website = profileState === 'unavailable' ? null : data?.profile.website;
  const twitter = profileState === 'unavailable' ? null : data?.profile.twitter;
  const activity = activityState === 'unavailable' ? undefined : data?.activity;
  const top10 = holderState === 'unavailable' ? null : data?.holder_summary.top10_percent;
  const route = data?.trading_route_display;
  const routeLabel = route?.status === 'configured' && route.kind === 'display_only' ? route.label : null;
  const needsSignIn = error instanceof MarketApiError && error.needsSignIn;
  const unsupported = error instanceof MarketApiError && error.code === 500098;
  const linkClass = 'inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent';

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return (
    <div className="space-y-6" aria-busy={loading}>
      {error ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          <span>{needsSignIn ? 'Please sign in again to load Overview.' : unsupported ? 'Overview is not supported by this server yet.' : data ? 'Refresh failed. Only unexpired cached values are shown.' : 'Overview is temporarily unavailable.'}</span>
          {onRetry && !needsSignIn && !unsupported ? <button type="button" onClick={onRetry} disabled={refreshing} className="inline-flex items-center gap-1.5 text-foreground disabled:opacity-50"><RefreshCw size={12} aria-hidden="true" />Retry</button> : null}
        </div>
      ) : loading ? <p role="status" className="text-xs text-muted">Loading cached overview…</p> : null}

      <section aria-labelledby="overview-token-info">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-token-info" className="text-sm font-semibold text-foreground">Token Info</h2>
          <SnapshotBadge status={website || twitter ? profileState : 'unavailable'} loading={loading} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {website ? <a href={website} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={linkClass} aria-label="Open token website"><Globe size={14} aria-hidden="true" />Website<ExternalLink size={11} aria-hidden="true" /></a> : null}
          {twitter ? <a href={twitter} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={linkClass} aria-label="Open token X profile"><span aria-hidden="true" className="text-sm">𝕏</span>X / Twitter<ExternalLink size={11} aria-hidden="true" /></a> : null}
          {!website && !twitter ? <span className="py-2 text-xs text-muted">{loading ? 'Checking cached links…' : 'No cached website or X link available.'}</span> : null}
        </div>
      </section>

      <section aria-labelledby="overview-activity" className="border-t border-border pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-activity" className="text-sm font-semibold text-foreground">Market activity</h2>
          <SnapshotBadge status={activityState} loading={loading} />
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric label="Volume · 5m" value={fmtUsd(activity?.volume_5m_usd)} note="Total buy + sell volume · USD" className="col-span-2 sm:col-span-1" />
          <Metric label="Buyers · 1h" value={fmtInt(activity?.buyers_1h)} note="Unique buying addresses" color="text-up" />
          <Metric label="Sellers · 1h" value={fmtInt(activity?.sellers_1h)} note="Unique selling addresses" color="text-down" />
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">Source-pair statistics, not all-pool totals. Each metric uses the window shown.</p>
      </section>

      <section aria-labelledby="overview-holders" className="border-t border-border pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-holders" className="text-sm font-semibold text-foreground">Holder intelligence</h2>
          <SnapshotBadge status={holderState} loading={loading} />
        </div>
        <dl className="flex items-center justify-between gap-4 text-sm">
          <dt className="text-muted">Top 10 holders</dt>
          <dd className="tabular font-semibold text-foreground">{fmtPct(top10, {sign: false, digits: 2})}</dd>
        </dl>
        {top10 !== null && top10 !== undefined ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><div className="h-full rounded-full bg-accent/70" style={{width: `${top10}%`}} /></div> : null}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{top10 === null || top10 === undefined ? 'Shown only when a holder snapshot is already cached. No extra lookup is made.' : 'Share of supply from the source’s Top 10 holder summary.'}</p>
      </section>

      <section aria-labelledby="overview-details" className="border-t border-border pt-5">
        <h2 id="overview-details" className="mb-3 text-sm font-semibold text-foreground">Token details</h2>
        <dl className="space-y-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <dt className="text-muted">Trading route</dt>
            <dd className="max-w-full text-right"><span className="break-words font-medium text-foreground">{routeLabel ?? DASH}</span><span className="mt-1 block text-[11px] text-muted">{routeLabel ? 'Display only · not a quote or execution route' : 'No display label configured'}</span></dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted">Contract <span className="ml-1 text-[10px]">{chainLabel(chain)}</span></dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs text-foreground" title={address}>{shortAddr(address, 7, 6)}</span>
              <button type="button" onClick={() => void copyAddress()} aria-label="Copy token contract address" title={copyStatus === 'copied' ? 'Copied' : 'Copy contract'} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">{copyStatus === 'copied' ? <Check size={14} /> : <Copy size={14} />}</button>
            </dd>
          </div>
        </dl>
        {copyStatus !== 'idle' ? <p role="status" className="mt-2 text-right text-[11px] text-muted">{copyStatus === 'copied' ? 'Contract address copied' : 'Could not copy. Select the address from the token header.'}</p> : null}
      </section>
      <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted">Cached data only. Missing or expired values appear as —; a displayed 0 is a reported zero.</p>
    </div>
  );
}

export default function TokenOverviewTab({chain, address}: {chain: string; address: string}) {
  const {data, error, isValidating, mutate, now} = useTokenOverview(chain, address);
  return <TokenOverviewContent chain={chain} address={address} data={data} now={now} loading={!data && !error} error={error} refreshing={isValidating} onRetry={() => {void mutate();}} />;
}
