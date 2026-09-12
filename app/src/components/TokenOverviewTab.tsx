'use client';

import {useState} from 'react';
import {AlertTriangle, Check, CircleAlert, Copy, ExternalLink, Globe, MessageCircle, RefreshCw} from 'lucide-react';
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
      <dd><span className={`tabular mt-2 block break-words text-xl font-semibold tracking-tight ${value === DASH ? 'text-muted' : color}`}>{value}</span><span className="mt-1 block text-[11px] text-muted">{note}</span></dd>
    </div>
  );
}

const RISK_REASON_COPY: Record<string, string> = {
  MinimumLiquidity: 'Liquidity is below the minimum threshold used by Codex.',
  LiquidityUnknown: 'Codex could not determine the token’s liquidity.',
  LiquidityRugPull: 'Codex detected signs consistent with removed or unsafe liquidity.',
  SuspiciousWalletActivity: 'Codex detected suspicious wallet activity around this token.',
  AbnormalBuyerRatio: 'Codex detected an unusual buyer ratio for this token.',
};

function RiskNotice({risk, status, loading}: {risk?: TokenOverview['risk']; status: OverviewStatus; loading: boolean}) {
  if (loading && !risk) {
    return <section aria-labelledby="overview-risk"><div role="status" className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-4 text-sm text-muted"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div><h2 id="overview-risk" className="font-semibold text-foreground">Checking cached risk status</h2><p className="mt-1 text-xs">No additional network request is made.</p></div></div></section>;
  }
  if (status === 'unavailable' || !risk) {
    return <section aria-labelledby="overview-risk"><div role="status" className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-4 text-sm text-muted"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div><h2 id="overview-risk" className="font-semibold text-foreground">Risk status unavailable</h2><p className="mt-1 text-xs">The current cached Codex snapshot does not provide a usable risk status. This is not a safety assessment.</p></div></div></section>;
  }
  const explicitScam = risk.result_is_scam === true || risk.token_is_scam === true;
  const messages = [...new Set(risk.potential_scam_reasons.map((reason) => RISK_REASON_COPY[reason] ?? 'Codex reported an additional potential risk signal.'))];
  if (!explicitScam && messages.length === 0) return null;
  const title = explicitScam ? 'Scam warning' : 'Potential token risk';
  return (
    <section aria-labelledby="overview-risk">
      <div role="alert" className={`rounded-lg border p-4 ${explicitScam ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${explicitScam ? 'text-red-500' : 'text-amber-500'}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="overview-risk" className="text-sm font-semibold text-foreground">{title}</h2>
              <SnapshotBadge status={status} loading={false} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{explicitScam ? 'Codex explicitly marked this token as a scam. Treat interactions as high risk.' : 'Codex reported one or more potential risk signals. Review them before interacting.'}</p>
            {messages.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground">{messages.map((message) => <li key={message}>{message}</li>)}</ul> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function HolderRow({label, count, percent, showCount = false, note}: {label: string; count?: number | null; percent: number | null | undefined; showCount?: boolean; note: string}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-4">
      <dt className="text-xs font-medium text-foreground">{label}</dt>
      <dd className="mt-3">
        <span className={`grid gap-3 ${showCount ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {showCount ? <span><span className="block text-[10px] uppercase tracking-wide text-muted">Wallets</span><span className={`tabular mt-1 block text-lg font-semibold ${count === null || count === undefined ? 'text-muted' : 'text-foreground'}`}>{fmtInt(count)}</span></span> : null}
          <span><span className="block text-[10px] uppercase tracking-wide text-muted">Held</span><span className={`tabular mt-1 block text-lg font-semibold ${percent === null || percent === undefined ? 'text-muted' : 'text-foreground'}`}>{fmtPct(percent, {sign: false, digits: 2})}</span></span>
        </span>
        <span className="mt-2 block text-[11px] leading-relaxed text-muted">{note}</span>
      </dd>
    </div>
  );
}

function AuthorityRow({label, authority, valid, className = ''}: {label: string; authority: string | null | undefined; valid: boolean | null | undefined; className?: string}) {
  const hasAuthority = authority !== null && authority !== undefined;
  const value = hasAuthority ? authority : valid === true ? 'None reported' : DASH;
  const note = valid === true
    ? hasAuthority ? 'Codex validated this authority field.' : 'Codex validated this field and reported no authority.'
    : 'Codex did not validate this authority field in the current snapshot.';
  return (
    <div className={`flex flex-wrap items-start justify-between gap-2 ${className}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-full text-right"><span className={`break-all font-mono text-xs ${value === DASH ? 'text-muted' : 'text-foreground'}`} title={hasAuthority ? authority : undefined}>{value}</span><span className="mt-1 block text-[11px] text-muted">{note}</span></dd>
    </div>
  );
}

function BooleanStatusRow({label, value}: {label: string; value: boolean | null | undefined}) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted">{label}</dt><dd className={`font-medium ${value === null || value === undefined ? 'text-muted' : 'text-foreground'}`}>{value === true ? 'Yes' : value === false ? 'No' : DASH}</dd></div>;
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
  const intelligenceState = overviewStatus(data?.holder_intelligence.quality, now);
  const riskState = overviewStatus(data?.risk.quality, now);
  const contractState = overviewStatus(data?.contract_status.quality, now);
  const profile = profileState === 'unavailable' ? undefined : data?.profile;
  const website = profile?.website ?? null;
  const twitter = profile?.twitter ?? null;
  const telegram = profile?.telegram ?? null;
  const description = profile?.description ?? null;
  const activity = activityState === 'unavailable' ? undefined : data?.activity;
  const intelligence = intelligenceState === 'unavailable' ? undefined : data?.holder_intelligence;
  const risk = riskState === 'unavailable' ? undefined : data?.risk;
  const contract = contractState === 'unavailable' ? undefined : data?.contract_status;
  const hasB20Status = contract !== undefined && [contract.b20_transfer_paused, contract.b20_mint_paused, contract.b20_burn_paused].some((value) => value !== null && value !== undefined);
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

      <RiskNotice risk={risk} status={riskState} loading={loading} />

      <section aria-labelledby="overview-token-info">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-token-info" className="text-sm font-semibold text-foreground">Token Info</h2>
          <SnapshotBadge status={profileState} loading={loading} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {website ? <a href={website} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={linkClass} aria-label="Open token website"><Globe size={14} aria-hidden="true" />Website<ExternalLink size={11} aria-hidden="true" /></a> : null}
          {twitter ? <a href={twitter} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={linkClass} aria-label="Open token X profile"><span aria-hidden="true" className="text-sm">𝕏</span>X / Twitter<ExternalLink size={11} aria-hidden="true" /></a> : null}
          {telegram ? <a href={telegram} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={linkClass} aria-label="Open token Telegram"><MessageCircle size={14} aria-hidden="true" />Telegram<ExternalLink size={11} aria-hidden="true" /></a> : null}
          {website === null && twitter === null && telegram === null ? <span className="py-2 text-xs text-muted">{loading ? 'Checking cached links…' : 'No cached website, X or Telegram link available.'}</span> : null}
        </div>
        {description !== null ? <div className="mt-4 rounded-lg border border-border bg-surface-2/50 p-4"><h3 className="text-xs font-medium text-foreground">About</h3><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted">{description}</p></div> : null}
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
          <SnapshotBadge status={intelligenceState} loading={loading} />
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <HolderRow label="Developer holdings" percent={intelligence?.dev_held_percent} note="Share of supply held by developer-associated wallets." />
          <HolderRow label="Sniper wallets" count={intelligence?.sniper_count} percent={intelligence?.sniper_held_percent} showCount note="Codex-tagged wallets that bought shortly after the first swap." />
          <HolderRow label="Insider wallets" count={intelligence?.insider_count} percent={intelligence?.insider_held_percent} showCount note="Count and supply share reported by Codex’s insider classification." />
          <HolderRow label="Bundler wallets" count={intelligence?.bundler_count} percent={intelligence?.bundler_held_percent} showCount note="Count and supply share reported by Codex’s bundler classification." />
          <HolderRow label="Suspicious wallets · deduplicated" count={intelligence?.suspicious_count} percent={intelligence?.suspicious_held_percent} showCount note="Deduplicated Codex union of sniper, insider and bundler wallets." />
          <HolderRow label="Top 10 holders" percent={intelligence?.top10_percent} note="Direct value from the current Codex filterTokens snapshot." />
        </dl>
      </section>

      <section aria-labelledby="overview-contract-status" className="border-t border-border pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-contract-status" className="text-sm font-semibold text-foreground">Contract status</h2>
          <SnapshotBadge status={contractState} loading={loading} />
        </div>
        {contract === undefined ? <p className="text-xs leading-relaxed text-muted">No validated contract status is available in the current cached snapshot.</p> : (
          <div className="space-y-4 text-sm">
            <dl className="space-y-4">
              <AuthorityRow label="Mint authority" authority={contract.mint_authority} valid={contract.mintable_valid} />
              <AuthorityRow label="Freeze authority" authority={contract.freeze_authority} valid={contract.freezable_valid} className="border-t border-border pt-4" />
            </dl>
            {hasB20Status ? <div className="border-t border-border pt-4"><h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">B20 current state</h3><dl className="mt-4 space-y-4"><BooleanStatusRow label="Transfer currently paused" value={contract.b20_transfer_paused} /><BooleanStatusRow label="Mint currently paused" value={contract.b20_mint_paused} /><BooleanStatusRow label="Burn currently paused" value={contract.b20_burn_paused} /></dl></div> : null}
          </div>
        )}
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
