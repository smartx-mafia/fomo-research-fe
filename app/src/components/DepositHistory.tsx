'use client';

import {LoaderCircle, RefreshCw} from 'lucide-react';
import useSWRInfinite from 'swr/infinite';

import {listDeposits, type DepositEntry} from '@/api/deposit';
import {ApiError} from '@/api/envelope';
import {formatBaseUnitsExact, formatDecimalExact} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';

const STATUS: Record<number, string> = {1: 'Created', 2: 'Action required', 3: 'Payment processing', 4: 'Delivery processing', 5: 'Completed', 6: 'Failed', 7: 'Refunded', 9: 'Provider unknown'};

function formatTime(value: DepositEntry['created_at']) {
  if (!value) return '—';
  const seconds = Number(value.seconds);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : '—';
}

function amount(entry: DepositEntry) {
  if (entry.kind === 1) return entry.fiat_amount ? `$${formatDecimalExact(entry.fiat_amount)} ${entry.fiat_currency ?? ''}` : '—';
  return entry.token_amount ? `${formatBaseUnitsExact(entry.token_amount, entry.token_decimals)} ${entry.token_currency ? shortAddr(entry.token_currency) : ''}` : '—';
}

export function DepositHistory({bearer, onProtectedError, onResumeFiat, onResumeSweep}: {bearer: string; onProtectedError: (error: unknown) => boolean; onResumeFiat: (id: string) => void; onResumeSweep: (id: string) => void}) {
  const {data, error, isLoading, isValidating, size, setSize, mutate} = useSWRInfinite(
    (index, previous: {next_cursor?: string} | null) => {
      if (index > 0 && !previous?.next_cursor) return null;
      return ['deposit-history', bearer, previous?.next_cursor ?? ''];
    },
    async ([, jwt, cursor]) => {
      try {
        return await listDeposits(jwt, cursor, 20);
      } catch (cause) {
        onProtectedError(cause);
        throw cause;
      }
    },
    {revalidateFirstPage: false, revalidateOnFocus: true, persistSize: false},
  );
  const entries = data?.flatMap((page) => page.deposits) ?? [];
  const next = data?.at(-1)?.next_cursor;
  const apiError = error instanceof ApiError ? error : undefined;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div><h2 className="font-semibold text-foreground">Deposit history</h2><p className="text-xs text-muted">Fiat orders and EVM sweeps only; Solana direct transfers are verified in Portfolio.</p></div>
        <button type="button" onClick={() => void mutate()} disabled={isValidating} className="inline-flex items-center gap-1.5 text-xs text-accent disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
      </div>
      {error ? <p role="alert" className="m-4 rounded border border-down/40 bg-down/5 p-3 text-sm text-down">History unavailable{apiError ? ` · code ${apiError.code} · trace ${apiError.traceID ?? 'unavailable'}` : ''}.</p> : null}
      {isLoading ? <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Loading history…</p> : null}
      {!isLoading && entries.length === 0 && !error ? <p className="p-6 text-sm text-muted">No fiat orders or EVM sweeps yet.</p> : null}
      {entries.length ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Created</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.deposit_id} className="border-t border-border">
            <td className="px-3 py-3">{entry.kind === 1 ? 'Fiat onramp' : entry.kind === 3 ? `${chainLabel(entry.chain)} sweep` : `Unknown kind ${entry.kind}`}</td>
            <td className="px-3 py-3 font-mono">{amount(entry)}</td><td className="px-3 py-3">{STATUS[entry.status] ?? `Unknown ${entry.status}`}</td>
            <td className="px-3 py-3 text-muted">{formatTime(entry.created_at)}</td><td className="px-3 py-3 font-mono text-muted">{shortAddr(entry.deposit_id, 8, 6)}</td>
            <td className="px-3 py-3 text-right">{entry.kind === 1 || entry.kind === 3 ? <button type="button" onClick={() => entry.kind === 1 ? onResumeFiat(entry.deposit_id) : onResumeSweep(entry.deposit_id)} className="text-accent hover:underline">View / recover</button> : null}</td>
          </tr>)}</tbody>
        </table></div>
      ) : null}
      {next ? <button type="button" onClick={() => void setSize(size + 1)} disabled={isValidating} className="m-4 rounded-md border border-border px-3 py-2 text-xs text-muted disabled:opacity-50">Load more</button> : null}
    </section>
  );
}
