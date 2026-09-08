'use client';

import {AlertTriangle, LoaderCircle, RefreshCw, WalletCards} from 'lucide-react';
import Link from 'next/link';
import {useState} from 'react';
import useSWR from 'swr';

import {ApiError} from '@/api/envelope';
import {getPortfolio, positionTargetID, type PortfolioPosition, type ProtoTimestamp} from '@/api/portfolio';
import {OpinionComposer} from '@/components/OpinionComposer';
import {
  addDecimalStrings,
  decimalSign,
  formatBaseUnitsExact,
  formatDecimalExact,
  marketValueFromBaseUnits,
  subtractDecimalStrings,
} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {clearSite, readSite, useSession} from '@/session/storage';

function usd(value: string | undefined, digits = 2) {
  const formatted = formatDecimalExact(value, digits);
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

function metrics(position: PortfolioPosition) {
  const marketValue = position.decimals !== undefined && position.price_usd
    ? marketValueFromBaseUnits(position.amount_raw, position.decimals, position.price_usd)
    : undefined;
  const matched = position.trade_basis?.status === 1;
  const unrealized = matched && marketValue && position.trade_basis?.cost_basis_usd
    ? subtractDecimalStrings(marketValue, position.trade_basis.cost_basis_usd)
    : undefined;
  const cyclePnl = unrealized && position.current_cycle?.realized_pnl_usd
    ? addDecimalStrings(unrealized, position.current_cycle.realized_pnl_usd)
    : undefined;
  return {marketValue, unrealized, cyclePnl};
}

function StatusBadge({position}: {position: PortfolioPosition}) {
  if (!position.trade_basis) return <span className="text-muted">On-chain only</span>;
  if (position.trade_basis.status === 1) return <span className="text-up">Matched</span>;
  if (position.trade_basis.status === 2) return <span className="text-accent">Balance mismatch</span>;
  return <span className="text-muted">Basis pending</span>;
}

function PositionRow({position, onOpenOpinion}: {position: PortfolioPosition; onOpenOpinion: (targetID: string, label?: string) => void}) {
  const {marketValue, unrealized, cyclePnl} = metrics(position);
  const targetID = positionTargetID(position);
  const tokenHref = `/token/${encodeURIComponent(position.asset.chain)}/${encodeURIComponent(position.asset.token_address)}`;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3">
        <Link href={tokenHref} className="font-semibold text-foreground hover:text-accent">
          {position.symbol ?? shortAddr(position.asset.token_address)}
        </Link>
        <div className="mt-1 text-[11px] text-muted">
          {chainLabel(position.asset.chain)} · {shortAddr(position.asset.token_address, 6, 5)}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-xs">
        {formatBaseUnitsExact(position.amount_raw, position.decimals)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.price_usd, 12)}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(marketValue)}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">
        {usd(position.trade_basis?.cost_basis_usd)}
      </td>
      <td className={`px-3 py-3 text-right font-mono text-xs ${pnlClass(unrealized)}`}>
        {usd(unrealized)}
        {position.trade_basis?.status === 2 ? <div className="mt-1 text-[10px] text-muted">Unavailable while quantities differ</div> : null}
      </td>
      <td className={`px-3 py-3 text-right font-mono text-xs ${pnlClass(position.current_cycle?.realized_pnl_usd)}`}>
        {usd(position.current_cycle?.realized_pnl_usd)}
        {cyclePnl ? <div className={`mt-1 text-[10px] ${pnlClass(cyclePnl)}`}>Current cycle total {usd(cyclePnl)}</div> : null}
      </td>
      <td className={`px-3 py-3 text-right font-mono text-xs ${pnlClass(position.trade_basis?.realized_pnl_usd)}`}>
        {usd(position.trade_basis?.realized_pnl_usd)}
      </td>
      <td className="px-3 py-3 text-right text-xs">
        <StatusBadge position={position} />
        {position.sweep?.status === 1 ? <div className="mt-1 text-[10px] text-accent">Sweep available</div> : null}
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
  const [opinionTarget, setOpinionTarget] = useState<{targetID: string; label?: string}>();
  const [opinionNotice, setOpinionNotice] = useState<string>();
  const {data, error, isLoading, isValidating, mutate} = useSWR(
    session ? ['portfolio', session.jwt] : null,
    async () => {
      const bearer = session!.jwt;
      try {
        return await getPortfolio(bearer);
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 400000 && readSite()?.jwt === bearer) clearSite();
        throw cause;
      }
    },
    {
      dedupingInterval: 12_000,
      refreshInterval: 0,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );

  if (!session) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <WalletCards className="h-9 w-9 text-muted" />
        <h1 className="text-xl font-semibold text-foreground">Your portfolio</h1>
        <p className="text-sm text-muted">Sign in to load the canonical wallets and on-chain balances for your account.</p>
        <Link href="/login" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
      </div>
    );
  }

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
          The holdings request failed. No zero balance or empty portfolio has been inferred from this failure.
        </p>
        {apiError ? <p className="font-mono text-xs text-muted">code {apiError.code} · trace {apiError.traceID ?? 'unavailable'}</p> : null}
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
          <p className="mt-1 text-sm text-muted">Canonical-wallet balances read directly from chain. Updated {time(data?.observed_at)}.</p>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          disabled={isValidating}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50"
        >
          {isValidating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </header>

      {error ? (
        <div role="alert" className="rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">
          Could not load portfolio{apiError ? ` (code ${apiError.code}, trace ${apiError.traceID ?? 'unavailable'})` : ''}.
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Total value', data?.total_value_usd],
          ['1D PnL', data?.pnl?.d1?.amount_usd],
          ['7D PnL', data?.pnl?.d7?.amount_usd],
          ['30D PnL', data?.pnl?.d30?.amount_usd],
          ['All-time PnL', data?.pnl?.all?.amount_usd ?? data?.pnl?.all_usd],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted">{label}{data?.partial_errors.length ? ' · partial' : ''}</p>
            <p className={`mt-2 font-mono text-xl font-semibold ${label === 'Total value' ? 'text-foreground' : pnlClass(value)}`}>{usd(value)}</p>
          </div>
        ))}
      </section>

      {data?.partial_errors.length ? (
        <section role="status" aria-live="polite" className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-accent" />Partial portfolio</div>
          <p className="mt-1 text-xs text-muted">Some chains or assets could not be read. Totals and PnL may be incomplete; failures are not shown as zero balances.</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
            {data.partial_errors.map((item, index) => (
              <li key={`${item.chain ?? ''}:${item.token_address ?? ''}:${item.reason}:${index}`}>
                {item.chain ?? 'unknown chain'}{item.token_address ? ` · ${shortAddr(item.token_address)}` : ''} · {item.reason}{item.retryable ? ' · retryable' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {opinionNotice ? (
        <p role="status" className="rounded-lg border border-up/30 bg-up/5 p-3 text-sm text-up">{opinionNotice}</p>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-foreground">Current holdings</h2>
          <span className="text-xs text-muted">{data?.positions.length ?? 0} assets</span>
        </div>
        {isLoading ? (
          <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Loading on-chain balances…</div>
        ) : data?.positions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Asset</th><th className="px-3 py-2">Balance</th><th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2 text-right">Cost basis</th>
                  <th className="px-3 py-2 text-right">Unrealized</th><th className="px-3 py-2 text-right">Cycle realized</th>
                  <th className="px-3 py-2 text-right">Lifetime realized</th><th className="px-3 py-2 text-right">Basis</th>
                </tr>
              </thead>
              <tbody>{data.positions.map((position) => (
                <PositionRow
                  key={`${position.asset.chain_id}:${position.asset.kind}:${position.asset.token_address}`}
                  position={position}
                  onOpenOpinion={(targetID, label) => {setOpinionNotice(undefined); setOpinionTarget({targetID, label});}}
                />
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted">No non-zero on-chain positions were returned for your canonical wallets.</div>
        )}
      </section>

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
