'use client';

import {AlertTriangle} from 'lucide-react';
import Link from 'next/link';

import type {DepositAddress} from '@/api/deposit';
import {CopyButton} from '@/components/CopyButton';
import {chainLabel} from '@/lib/format';
import type {SolanaBalanceMonitor} from '@/lib/deposit-polling';

export function DepositAddresses({
  addresses, loading, solanaMonitor, canMonitorSolana, onStartSolanaMonitor, onStopSolanaMonitor,
}: {
  addresses?: DepositAddress[];
  loading: boolean;
  solanaMonitor: SolanaBalanceMonitor;
  canMonitorSolana: boolean;
  onStartSolanaMonitor: () => void;
  onStopSolanaMonitor: () => void;
}) {
  const monitoring = solanaMonitor.state === 'waiting' || solanaMonitor.state === 'checking';
  const hasEvmRoute = addresses?.some((item) => item.address_format === 'evm') ?? false;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Wallet transfer</h2>
          <p className="mt-1 text-xs text-muted">Only send an accepted token to the exact address returned for that chain.</p>
        </div>
        <Link href="/portfolio" className="text-xs text-accent hover:underline">Check Portfolio balance</Link>
      </div>
      {loading ? <p role="status" className="mt-4 text-sm text-muted">Loading canonical deposit routes…</p> : null}
      {!loading && addresses?.length === 0 ? <p className="mt-4 text-sm text-muted">No deposit routes are enabled for this account.</p> : null}
      {hasEvmRoute ? (
        <p className="mt-4 flex items-start gap-2 rounded border border-accent/40 bg-accent/5 p-2 text-xs text-accent">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          EVM balances can be swept to Solana USDC only after reaching the route minimum and the current wallet signs the sweep.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {addresses?.map((item) => (
          <article key={`${item.chain}:${item.address}`} className="rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-foreground">{chainLabel(item.chain)}</h3>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted">{item.address_format}</span>
            </div>
            <code className="mt-3 block break-all font-mono text-xs text-foreground">{item.address}</code>
            <CopyButton value={item.address} label={`Copy ${item.chain} address`} className="mt-2" />
            <div className="mt-3">
              <p className="text-[11px] uppercase tracking-wide text-muted">Accepted tokens</p>
              {item.accepted_tokens.length ? (
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {item.accepted_tokens.map((token) => (
                    <li key={`${item.chain}:${token.address}`} className="space-y-1 rounded border border-border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-foreground">{token.symbol}</span><span>{token.decimals} decimals</span></div>
                      <code className="block break-all font-mono text-[11px] text-foreground">{token.address}</code>
                      <CopyButton value={token.address} label={`Copy ${token.symbol} token address`} />
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-xs text-down">No tokens are accepted on this route.</p>}
            </div>
            {item.min_sweep_amount ? <p className="mt-3 text-xs text-muted">Minimum EVM sweep: <span className="font-mono">{item.min_sweep_amount} base units</span></p> : null}
            {item.chain === 'solana' ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted">Solana transfers do not create a Deposit record. SmartX checks the current balance through Portfolio; the browser never scans chain history.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={onStartSolanaMonitor} disabled={!canMonitorSolana || monitoring} className="rounded border border-accent px-3 py-2 text-xs text-accent disabled:opacity-50">I transferred — monitor balance</button>
                  {monitoring ? <button type="button" onClick={onStopSolanaMonitor} className="rounded border border-border px-3 py-2 text-xs text-muted">Stop checking</button> : null}
                </div>
                {solanaMonitor.state !== 'idle' && solanaMonitor.message ? <p role={solanaMonitor.state === 'error' ? 'alert' : 'status'} className={`rounded border p-2 text-xs ${solanaMonitor.state === 'error' ? 'border-down/40 bg-down/5 text-down' : solanaMonitor.state === 'changed' ? 'border-up/40 bg-up/5 text-up' : 'border-accent/40 bg-accent/5 text-accent'}`}>{solanaMonitor.message}</p> : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
