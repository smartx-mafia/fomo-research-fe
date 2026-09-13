'use client';

import {AlertTriangle, LoaderCircle, RefreshCw, WalletCards} from 'lucide-react';
import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import useSWR from 'swr';

import {ApiError} from '@/api/envelope';
import {getUserPortfolio} from '@/api/user-portfolio';
import {useLivePortfolio} from '@/hooks/useLivePortfolio';
import {PortfolioDataError, positionTargetID, type PortfolioPosition, type ProtoTimestamp, type PortfolioCycleScope} from '@/api/portfolio';
import {ClosedPortfolioPositions, PortfolioCycleTrades} from '@/components/PortfolioCycles';
import {OpinionComposer} from '@/components/OpinionComposer';
import {PortfolioActivity} from '@/components/PortfolioActivity';
import {PortfolioPnlChart} from '@/components/PortfolioPnlChart';
import {PortfolioTokenIdentity} from '@/components/PortfolioTokenIdentity';
import {
  decimalSign,
  formatBaseUnitsExact,
  formatDecimalExact,
  marketValueFromBaseUnits,
} from '@/lib/exact-decimal';
import {shortAddr} from '@/lib/format';
import {clearSite, readSite, useSession} from '@/session/storage';

function usd(value: string | undefined, digits = 2) {
  let formatted = formatDecimalExact(value, digits);
  if (formatted === '0' && decimalSign(value) !== 0) formatted = formatDecimalExact(value, 20);
  return formatted === '—' ? formatted : `$${formatted}`;
}

function pnlClass(value: string | undefined) {
  const sign = decimalSign(value);
  return sign === 1 ? 'text-up' : sign === -1 ? 'text-down' : 'text-muted';
}

function time(value: ProtoTimestamp | undefined) {
  if (!value) return '—';
  const seconds = Number(value.seconds);
  if (!Number.isFinite(seconds)) return '—';
  return new Date(seconds * 1000 + (value.nanos ?? 0) / 1_000_000).toLocaleString();
}

function PositionRow({position, onOpenOpinion, onOpenCycle}: {position: PortfolioPosition; onOpenOpinion: (targetID: string, label?: string) => void; onOpenCycle: (scope: PortfolioCycleScope) => void}) {
  const targetID = positionTargetID(position);
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3">
        <PortfolioTokenIdentity chain={position.asset.chain} address={position.asset.token_address} symbol={position.symbol} logo={position.logo} />
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs">{formatBaseUnitsExact(position.shares_raw, position.decimals)}{position.pending_shares && position.pending_shares !== '0' ? <p className="mt-1 text-accent">Settlement pending: {position.pending_shares} raw</p> : null}<p className="mt-1 text-muted">Sellable: {position.sellable_shares === undefined ? '—' : formatBaseUnitsExact(position.sellable_shares, position.decimals)}</p></td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.price_usd, 12)}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.market_value_usd)}</td>
      <td className={`px-3 py-3 text-right font-mono text-xs ${pnlClass(position.pnl_ratio)}`}>{position.pnl_ratio === undefined ? '—' : `${formatDecimalExact(marketValueFromBaseUnits('100', 0, position.pnl_ratio), 4)}%`}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.buy_value_usd)}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.avg_buy_price_usd, 12)}</td>
      <td className="px-3 py-3 text-right text-xs">
        <button type="button" disabled={!position.cycle_key || position.cycle_status !== 'ready'} title={!position.cycle_key ? 'This cycle is not ready yet' : undefined}
          onClick={() => {if (position.cycle_key) onOpenCycle({chain: position.asset.chain, asset: position.asset.token_address, cycle_key: position.cycle_key});}}
          className="block w-full whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] text-accent disabled:cursor-not-allowed disabled:opacity-50">Cycle trades</button>
        <button
          type="button"
          disabled={targetID === undefined}
          title={targetID === undefined ? 'This round is still being calculated' : undefined}
          onClick={() => {
            if (targetID === undefined) return;
            onOpenOpinion(targetID, position.symbol ? `$${position.symbol}` : shortAddr(position.asset.token_address));
          }}
          className="mt-2 block w-full rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Opinion
        </button>
      </td>
    </tr>
  );
}

export function PortfolioView() {
  const session = useSession();
  return <PortfolioAccountView key={`${session?.user?.identifier ?? ''}:${session?.jwt ?? ''}`} />;
}

function PortfolioAccountView() {
  const session = useSession();
  const identifier = session?.user?.identifier;
  const forceRefresh = useRef(false);
  const [opinionTarget, setOpinionTarget] = useState<{targetID: string; label?: string}>();
  const [opinionNotice, setOpinionNotice] = useState<string>();
  const [cycle, setCycle] = useState<{bearer: string; scope: PortfolioCycleScope}>();
  useEffect(() => setCycle(undefined), [session?.jwt]);
  useEffect(() => {setOpinionTarget(undefined); setOpinionNotice(undefined);}, [session?.jwt, identifier]);
  const {data: snapshot, error, isLoading, isValidating, mutate} = useSWR(
    session && identifier ? ['user-portfolio-v1', identifier, session.jwt] : null,
    async () => {
      const bearer = session!.jwt;
      try {
        const force = forceRefresh.current;
        forceRefresh.current = false;
        return await getUserPortfolio(identifier!, bearer, force);
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 400000 && readSite()?.jwt === bearer) clearSite();
        throw cause;
      }
    },
    {
      dedupingInterval: 12_000,
      keepPreviousData: false,
      refreshInterval: 0,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );

  const data = useLivePortfolio(snapshot, identifier);
  useEffect(() => setCycle(undefined), [identifier, snapshot?.history_epoch]);

  if (!session) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <WalletCards className="h-9 w-9 text-muted" />
        <h1 className="text-xl font-semibold text-foreground">Your portfolio</h1>
        <p className="text-sm text-muted">Sign in to view your trading positions and USDC cash.</p>
        <Link href="/login" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
      </div>
    );
  }

  if (!identifier) return <p role="alert">Your user identifier is unavailable. Please sign in again.</p>;

  const apiError = error instanceof ApiError ? error : undefined;
  if (apiError?.code === 430114) {
    return (
      <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-9 w-9 text-accent" />
        <h1 className="text-xl font-semibold text-foreground">Invitation access required</h1>
        <p className="max-w-lg text-sm text-muted">Your account is signed in, but the backend has not admitted it yet. Complete invitation access before loading private holdings.</p>
        <p className="font-mono text-xs text-muted">code 430114 · trace {apiError.traceID ?? 'unavailable'}</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-9 w-9 text-down" />
        <h1 className="text-xl font-semibold text-foreground">Could not load portfolio</h1>
        <p className="max-w-lg text-sm text-muted">
          Your holdings could not be displayed. Existing balances have not been replaced with zero.
        </p>
        {error instanceof Error ? <p className="max-w-xl break-words text-xs text-muted">{error.message}</p> : null}
        {apiError || error instanceof PortfolioDataError ? <p className="font-mono text-xs text-muted">{apiError ? 'code ' + apiError.code + ' · ' : ''}trace {(apiError ?? error as PortfolioDataError).traceID ?? 'unavailable'}</p> : null}
        <button type="button" onClick={() => void mutate()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Portfolio</h1>
          <p className="mt-1 text-sm text-muted">Open trading positions and Solana USDC cash. Updated {time(data?.observed_at)}.</p>
          {data?.cash_observed_at ? <p className="mt-1 text-xs text-muted">Cash snapshot {time(data.cash_observed_at)}.</p> : null}
        </div>
        <button
          type="button"
          onClick={() => {forceRefresh.current = true; void mutate();}}
          disabled={isValidating}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50"
        >
          {isValidating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </header>

      {error ? (
        <div role="alert" className="rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">
          Could not refresh portfolio. {error instanceof Error ? error.message : ''}
          {apiError || error instanceof PortfolioDataError ? <span className="mt-1 block font-mono text-xs">trace {(apiError ?? error as PortfolioDataError).traceID ?? 'unavailable'}</span> : null}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Total assets', data?.total_assets_usd],
          ['USDC cash', data?.cash_balance_usd],
          ['Positions value', data?.total_value_usd],
          ['1D PnL', data?.pnl?.d1?.amount_usd],
          ['7D PnL', data?.pnl?.d7?.amount_usd],
          ['30D PnL', data?.pnl?.d30?.amount_usd],
          ['All-time PnL', data?.pnl?.all?.amount_usd ?? data?.pnl?.all_usd],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted">{label}{data?.partial_errors.length ? ' · partial' : ''}</p>
            <p className={`mt-2 font-mono text-xl font-semibold ${['Total assets', 'USDC cash', 'Positions value'].includes(label ?? '') ? 'text-foreground' : pnlClass(value)}`}>{usd(value)}</p>
          </div>
        ))}
      </section>

      {data?.cash_balances?.length ? <section className="overflow-x-auto rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">Cash by chain</h2>
        <table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="p-2">Chain</th><th className="p-2">Asset</th><th className="p-2">Wallet</th><th className="p-2 text-right">Balance</th></tr></thead>
          <tbody>{data.cash_balances.map((cash) => <tr key={`${cash.chain_id}:${cash.token.address}`} className="border-t border-border"><td className="p-2">{cash.chain}</td><td className="p-2">{cash.token.symbol}</td><td className="p-2 font-mono" title={cash.wallet_address}>{shortAddr(cash.wallet_address)}</td><td className="p-2 text-right font-mono">{cash.amount_raw === undefined ? '—' : formatBaseUnitsExact(cash.amount_raw, cash.token.decimals)}</td></tr>)}</tbody>
        </table>
      </section> : null}
      {data?.quantity_completeness === 'partial' || data?.completeness === 'partial' ? <p role="status" className="text-sm text-accent">Some portfolio inputs are incomplete. Unavailable amounts are shown as —.</p> : null}

      {data?.partial_errors.length ? (
        <section role="status" aria-live="polite" className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-accent" />Partial portfolio</div>
          <p className="mt-1 text-xs text-muted">Some account data is unavailable. Cash failures affect cash and total assets; missing prices affect position valuation. Missing values are shown as —.</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
            {data.partial_errors.map((item, index) => (
              <li key={`${item.chain ?? ''}:${item.token_address ?? ''}:${item.reason}:${index}`}>
                {item.chain ?? 'unknown chain'}{item.token_address ? ` · ${shortAddr(item.token_address)}` : ''} · {item.reason}{item.retryable ? ' · retryable' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PortfolioPnlChart key={`pnl:${session.jwt}`} balance={data?.balance} pnl={data?.pnl} loading={isLoading} refreshing={isValidating} stale={!!error} observedAt={data?.observed_at} onRefresh={() => void mutate()} />

      {opinionNotice ? (
        <p role="status" className="rounded-lg border border-up/30 bg-up/5 p-3 text-sm text-up">{opinionNotice}</p>
      ) : null}

      {cycle?.bearer === session.jwt ? <PortfolioCycleTrades key={`${session.jwt}:${JSON.stringify(cycle.scope)}`} bearer={session.jwt} userIdentifier={identifier} scope={cycle.scope} onClose={() => setCycle(undefined)} /> : null}

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-foreground">Current positions</h2>
          <span className="text-xs text-muted">{data ? data.positions.length : '—'} assets</span>
        </div>
        {isLoading ? (
          <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Loading positions and cash…</div>
        ) : data?.positions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Token</th><th className="px-3 py-2 text-right">Shares</th>
                  <th className="px-3 py-2 text-right">Market price</th><th className="px-3 py-2 text-right">Position value</th>
                  <th className="px-3 py-2 text-right">ROI</th><th className="px-3 py-2 text-right">Total bought</th>
                  <th className="px-3 py-2 text-right">Avg buy / share</th><th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>{data.positions.map((position) => (
                <PositionRow
                  key={`${position.asset.chain_id}:${position.asset.kind}:${position.asset.token_address}:${position.cycle_key ?? position.opened_entry_id}`}
                  position={position}
                  onOpenCycle={(scope) => setCycle({bearer: session.jwt, scope})}
                  onOpenOpinion={(targetID, label) => {setOpinionNotice(undefined); setOpinionTarget({targetID, label});}}
                />
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted">{data?.quantity_completeness && data.quantity_completeness !== 'complete' ? 'Position quantities are incomplete. Holdings cannot be confirmed yet.' : 'No open trading positions were returned. USDC cash is shown separately above.'}</div>
        )}
      </section>

      <p className="text-xs text-muted">Shares represent your recorded trading position, not the amount currently available to sell. Execution checks wallet balances separately.</p>
      <ClosedPortfolioPositions key={`closed:${identifier}:${session.jwt}`} historyEpoch={data?.history_epoch} bearer={session.jwt} userIdentifier={identifier} onOpenCycle={(scope) => setCycle({bearer: session.jwt, scope})} />
      <PortfolioActivity key={`${identifier}:${session.jwt}`} bearer={session.jwt} userIdentifier={identifier} />

      {opinionTarget ? (
        <OpinionComposer
          targetID={opinionTarget.targetID}
          targetLabel={opinionTarget.label}
          onClose={() => setOpinionTarget(undefined)}
          onPublished={() => setOpinionNotice('Opinion published.')}
          onDeleted={() => setOpinionNotice('Opinion deleted.')}
        />
      ) : null}
    </div>
  );
}
