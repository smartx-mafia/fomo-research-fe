'use client';

import {usePrivy} from '@privy-io/react-auth';
import {AlertTriangle, Landmark} from 'lucide-react';
import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import useSWR from 'swr';

import {getDepositAddresses} from '@/api/deposit';
import {getUserInfo} from '@/api/auth';
import {ApiError} from '@/api/envelope';
import {getPortfolio} from '@/api/portfolio';
import {DepositAddresses} from '@/components/DepositAddresses';
import {FiatDepositCard} from '@/components/FiatDepositCard';
import {SweepDepositCard} from '@/components/SweepDepositCard';
import {receiptEmailForAuth} from '@/lib/deposit';
import {
  SOLANA_PORTFOLIO_MAX_ATTEMPTS,
  SOLANA_PORTFOLIO_POLL_INTERVAL_MS,
  type SolanaBalanceMonitor,
  abortablePollDelay,
  solanaAcceptedBalanceChanged,
  solanaAcceptedBalanceSnapshot,
  waitForVisibleDocument,
} from '@/lib/deposit-polling';
import {clearSite, readSite, useSession} from '@/session/storage';

function isAdmissionError(error: unknown) {
  return error instanceof ApiError && (error.reason === 'BIZ_INVITE_NOT_ADMITTED' || error.code === 430114);
}

export function DepositView() {
  const session = useSession();
  const {ready, authenticated, user} = usePrivy();
  const [manualAdmissionError, setManualAdmissionError] = useState<ApiError>();
  const [solanaMonitor, setSolanaMonitor] = useState<SolanaBalanceMonitor>({state: 'idle', attempts: 0});
  const solanaMonitorController = useRef<AbortController | undefined>(undefined);
  const delayedPortfolioRefreshController = useRef<AbortController | undefined>(undefined);
  const pollingContextRef = useRef<string | undefined>(undefined);
  const bearer = session?.jwt;
  useEffect(() => setManualAdmissionError(undefined), [bearer]);
  useEffect(() => () => {
    solanaMonitorController.current?.abort();
    delayedPortfolioRefreshController.current?.abort();
  }, []);
  const fetchWithSessionGuard = async <T,>(load: (jwt: string) => Promise<T>) => {
    const jwt = bearer!;
    try {return await load(jwt);} catch (error) {
      if (error instanceof ApiError && error.code === 400000 && readSite()?.jwt === jwt) clearSite();
      throw error;
    }
  };
  const addresses = useSWR(
    bearer ? ['deposit-addresses', bearer] : null,
    () => fetchWithSessionGuard((jwt) => getDepositAddresses(jwt)),
    {dedupingInterval: 12_000, revalidateOnFocus: true, shouldRetryOnError: false},
  );
  const portfolio = useSWR(
    bearer ? ['deposit-portfolio', bearer] : null,
    () => fetchWithSessionGuard((jwt) => getPortfolio(jwt)),
    {dedupingInterval: 12_000, revalidateOnFocus: true, shouldRetryOnError: false},
  );
  const accountInfo = useSWR(
    bearer ? ['deposit-account-info', bearer] : null,
    () => fetchWithSessionGuard((jwt) => getUserInfo(jwt).then((result) => result.data)),
    {dedupingInterval: 12_000, revalidateOnFocus: true, shouldRetryOnError: false},
  );
  const handleProtectedError = (error: unknown) => {
    if (!(error instanceof ApiError)) return false;
    if (error.code === 400000) {
      if (bearer && readSite()?.jwt === bearer) clearSite();
      return true;
    }
    if (isAdmissionError(error)) {
      if (!bearer || readSite()?.jwt !== bearer) return true;
      setManualAdmissionError(error);
      return true;
    }
    return false;
  };
  // A failed revalidation means the server can no longer vouch for the cached
  // route/allowlist. Do not leave a stale address copyable or usable by fiat.
  const currentAddresses = addresses.error ? undefined : addresses.data;
  const solanaRoute = currentAddresses?.find((item) => item.chain === 'solana');
  const privyActor = ready && authenticated ? user?.id : undefined;
  const identityMatched = !accountInfo.error && !!privyActor && !!accountInfo.data?.privy_did && accountInfo.data.privy_did === privyActor;
  const solanaRouteFingerprint = solanaRoute
    ? JSON.stringify([solanaRoute.address, ...solanaRoute.accepted_tokens.map((token) => token.address).sort()])
    : undefined;
  const pollingContext = bearer && identityMatched && solanaRouteFingerprint && !portfolio.error && !manualAdmissionError
    ? `${bearer}\u0000${privyActor}\u0000${solanaRouteFingerprint}`
    : undefined;
  pollingContextRef.current = pollingContext;
  useEffect(() => {
    solanaMonitorController.current?.abort();
    delayedPortfolioRefreshController.current?.abort();
    setSolanaMonitor({state: 'idle', attempts: 0});
  }, [pollingContext]);

  const stopSolanaMonitor = () => {
    solanaMonitorController.current?.abort();
    solanaMonitorController.current = undefined;
    setSolanaMonitor({state: 'idle', attempts: 0});
  };

  const startSolanaMonitor = () => {
    if (!bearer || !solanaRoute || !portfolio.data || !pollingContext) return;
    const context = pollingContext;
    const acceptedMints = solanaRoute.accepted_tokens.map((token) => token.address);
    const baseline = solanaAcceptedBalanceSnapshot(portfolio.data, acceptedMints);
    if (baseline === undefined) {
      setSolanaMonitor({state: 'error', attempts: 0, message: 'Portfolio is incomplete for the accepted Solana assets. Refresh it before starting an arrival check.'});
      return;
    }
    solanaMonitorController.current?.abort();
    const controller = new AbortController();
    solanaMonitorController.current = controller;
    setSolanaMonitor({state: 'waiting', attempts: 0, message: 'Waiting for the 12-second Portfolio cache window before the first check.'});
    void (async () => {
      try {
        for (let attempt = 1; attempt <= SOLANA_PORTFOLIO_MAX_ATTEMPTS; attempt += 1) {
          await abortablePollDelay(SOLANA_PORTFOLIO_POLL_INTERVAL_MS, controller.signal);
          await waitForVisibleDocument(controller.signal);
          if (readSite()?.jwt !== bearer || pollingContextRef.current !== context) return;
          setSolanaMonitor({state: 'checking', attempts: attempt, message: `Checking the backend Portfolio (${attempt}/${SOLANA_PORTFOLIO_MAX_ATTEMPTS})…`});
          const next = await getPortfolio(bearer, controller.signal);
          if (controller.signal.aborted || pollingContextRef.current !== context) return;
          await portfolio.mutate(next, {revalidate: false});
          const snapshot = solanaAcceptedBalanceSnapshot(next, acceptedMints);
          if (snapshot === undefined) {
            setSolanaMonitor({state: 'checking', attempts: attempt, message: 'Portfolio returned partial Solana errors. No missing balance was treated as zero; the bounded check will continue.'});
            continue;
          }
          if (solanaAcceptedBalanceChanged(baseline, snapshot)) {
            setSolanaMonitor({state: 'changed', attempts: attempt, message: 'An accepted Solana balance changed in Portfolio. Review the current balance there; this is not a per-transaction confirmation.'});
            solanaMonitorController.current = undefined;
            return;
          }
          setSolanaMonitor({state: 'waiting', attempts: attempt, message: 'No accepted Solana balance change is visible yet. The bounded check will continue while this tab is visible.'});
        }
        setSolanaMonitor({state: 'timeout', attempts: SOLANA_PORTFOLIO_MAX_ATTEMPTS, message: 'Automatic checks paused after about four minutes. Refresh Portfolio later; no failed asset was interpreted as a zero balance.'});
        solanaMonitorController.current = undefined;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!handleProtectedError(error)) setSolanaMonitor({state: 'error', attempts: 0, message: error instanceof Error ? error.message : 'Portfolio check failed.'});
        solanaMonitorController.current = undefined;
      }
    })();
  };

  const refreshPortfolioAfterCacheWindow = () => {
    if (!bearer || !pollingContext) return;
    const context = pollingContext;
    delayedPortfolioRefreshController.current?.abort();
    const controller = new AbortController();
    delayedPortfolioRefreshController.current = controller;
    void (async () => {
      try {
        await abortablePollDelay(SOLANA_PORTFOLIO_POLL_INTERVAL_MS, controller.signal);
        await waitForVisibleDocument(controller.signal);
        if (readSite()?.jwt !== bearer || pollingContextRef.current !== context) return;
        const next = await getPortfolio(bearer, controller.signal);
        if (!controller.signal.aborted && pollingContextRef.current === context) await portfolio.mutate(next, {revalidate: false});
      } catch (error) {
        if (!controller.signal.aborted) handleProtectedError(error);
      } finally {
        if (delayedPortfolioRefreshController.current === controller) delayedPortfolioRefreshController.current = undefined;
      }
    })();
  };

  if (!session) {
    return <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center"><Landmark className="h-9 w-9 text-muted" /><h1 className="text-xl font-semibold text-foreground">Deposit</h1><p className="text-sm text-muted">Sign in to load your canonical deposit routes and history.</p><Link href="/login" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Sign in</Link></div>;
  }
  if (manualAdmissionError || isAdmissionError(addresses.error) || isAdmissionError(portfolio.error) || isAdmissionError(accountInfo.error)) {
    const error = (manualAdmissionError ?? (isAdmissionError(addresses.error) ? addresses.error : isAdmissionError(portfolio.error) ? portfolio.error : accountInfo.error)) as ApiError;
    return <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center"><AlertTriangle className="h-9 w-9 text-accent" /><h1 className="text-xl font-semibold text-foreground">Invitation access required</h1><p className="max-w-lg text-sm text-muted">The account is authenticated but is not admitted to the protected deposit endpoints. Re-login to refresh admission state before depositing.</p><p className="font-mono text-xs text-muted">{error.reason ?? error.code} · trace {error.traceID ?? 'unavailable'}</p></div>;
  }
  const receiptEmail = accountInfo.data?.email || session.user?.email || (ready && authenticated && user
    ? receiptEmailForAuth(user.linkedAccounts ?? [], session.meta?.auth_method) : undefined);
  const solanaAddress = solanaRoute?.address;
  return (
    <div className="space-y-4">
      <header><h1 className="text-2xl font-semibold tracking-tight text-foreground">Deposit</h1><p className="mt-1 text-sm text-muted">Fund your canonical SmartX wallets by direct transfer, EVM sweep or Crossmint fiat onramp.</p></header>
      {addresses.error ? <p role="alert" className="rounded border border-down/40 bg-down/5 p-3 text-sm text-down">Deposit routes unavailable{addresses.error instanceof ApiError ? ` · code ${addresses.error.code} · trace ${addresses.error.traceID ?? 'unavailable'}` : ''}.</p> : null}
      {accountInfo.error ? <p role="alert" className="rounded border border-down/40 bg-down/5 p-3 text-sm text-down">Current SmartX/Privy identity could not be verified{accountInfo.error instanceof ApiError ? ` · code ${accountInfo.error.code} · trace ${accountInfo.error.traceID ?? 'unavailable'}` : ''}.</p> : null}
      {!accountInfo.isLoading && !identityMatched ? <p role="alert" className="rounded border border-accent/40 bg-accent/5 p-3 text-sm text-accent">SmartX JWT and the current Privy session could not be proven to belong to the same DID. Re-login and exchange a fresh SmartX token before any fiat or Sweep action.</p> : null}
      <DepositAddresses
        addresses={currentAddresses}
        loading={addresses.isLoading && !addresses.error}
        solanaMonitor={solanaMonitor}
        canMonitorSolana={!!pollingContext && !!portfolio.data && !!solanaRoute?.accepted_tokens.length}
        onStartSolanaMonitor={startSolanaMonitor}
        onStopSolanaMonitor={stopSolanaMonitor}
      />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <FiatDepositCard key={`fiat:${bearer}:${privyActor ?? 'no-privy'}`} bearer={bearer!} ownerKey={accountInfo.data?.identifier ?? session.user?.identifier ?? ''} receiptEmail={receiptEmail} canonicalSolanaAddress={solanaAddress} identityMatched={identityMatched} onProtectedError={handleProtectedError} onOrderCompleted={refreshPortfolioAfterCacheWindow} />
        {portfolio.isLoading ? <section className="rounded-lg border border-border bg-surface p-4 text-sm text-muted" role="status">Loading Portfolio sweep capabilities…</section> : portfolio.error ? <section className="rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down" role="alert">Portfolio sweep capabilities could not be loaded. No absence of sweep routes has been inferred.</section> : <SweepDepositCard key={`sweep:${bearer}:${privyActor ?? 'no-privy'}:${identityMatched ? 'matched' : 'unmatched'}`} bearer={bearer!} ownerKey={accountInfo.data?.identifier ?? session.user?.identifier ?? ''} identityMatched={identityMatched} positions={portfolio.data?.positions ?? []} onProtectedError={handleProtectedError} />}
      </div>
      <p className="rounded-lg border border-border bg-surface p-4 text-xs text-muted">The retired Deposit list is no longer queried. Finalized direct Solana USDC movements are available under <Link href="/portfolio" className="text-accent hover:underline">Portfolio → USDC in / out</Link>; active fiat and Sweep recovery remains scoped to the known order ID saved by this browser.</p>
    </div>
  );
}
