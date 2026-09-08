'use client';

import {usePrivy} from '@privy-io/react-auth';
import {useSignMessage, useWallets as useSolanaWallets} from '@privy-io/react-auth/solana';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';

import {createFiatDeposit, getDeposit, submitFiatWalletProof, type FiatDepositSession} from '@/api/deposit';
import {ApiError} from '@/api/envelope';
import {CROSSMINT_CLIENT_API_KEY} from '@/config';
import {fiatCreateFailureIsUncertain, newDepositIdempotencyKey, validFiatAmount} from '@/lib/deposit';
import {
  FIAT_ORDER_MAX_POLL_ATTEMPTS,
  abortablePollDelay,
  fiatOrderPollDelayMs,
  shouldAutoPollFiatOrder,
  waitForVisibleDocument,
} from '@/lib/deposit-polling';
import {signFiatWalletProof} from '@/lib/deposit-signing';
import {isFiatTerminal, parseFiatRecovery, recoveryTracksDeposit, type FiatIntent, type FiatRecovery} from '@/lib/fiat-deposit-recovery';
import {readSite} from '@/session/storage';

const CrossmintCheckout = dynamic(() => import('@/components/CrossmintCheckout'), {ssr: false});
const STATUS: Record<number, string> = {1: 'Created', 2: 'Action required', 3: 'Payment processing', 4: 'Delivery processing', 5: 'Completed', 6: 'Failed', 7: 'Refunded', 9: 'Provider unknown'};

function errorText(error: unknown) {
  if (error instanceof ApiError) return `Request failed · code ${error.code} · ${error.reason ?? 'unknown'} · trace ${error.traceID ?? 'unavailable'}`;
  return error instanceof Error ? error.message : String(error);
}

export function FiatDepositCard({
  bearer, ownerKey, receiptEmail, canonicalSolanaAddress, identityMatched, resumeID, onProtectedError, onOrderCompleted,
}: {
  bearer: string;
  ownerKey: string;
  receiptEmail?: string;
  canonicalSolanaAddress?: string;
  identityMatched: boolean;
  resumeID?: string;
  onProtectedError: (error: unknown) => boolean;
  onOrderCompleted?: () => void;
}) {
  const {ready, authenticated, user} = usePrivy();
  const {wallets, ready: walletsReady} = useSolanaWallets();
  const {signMessage} = useSignMessage();
  const actorID = ready && authenticated && identityMatched ? user?.id : undefined;
  const actorRef = useRef<string | undefined>(actorID);
  actorRef.current = actorID;
  const protectedErrorRef = useRef(onProtectedError);
  protectedErrorRef.current = onProtectedError;
  const completedRef = useRef(onOrderCompleted);
  completedRef.current = onOrderCompleted;
  const lockRef = useRef(false);
  const autoPollRequestRef = useRef(false);
  const [amount, setAmount] = useState('100.00');
  const [review, setReview] = useState<FiatIntent>();
  const [recovery, setRecovery] = useState<FiatRecovery>();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [actorMismatch, setActorMismatch] = useState(false);
  const [order, setOrder] = useState<FiatDepositSession>();
  const [orderEmail, setOrderEmail] = useState(receiptEmail);
  const [proofUncertain, setProofUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [autoPoll, setAutoPoll] = useState<{state: 'idle' | 'checking' | 'timeout'; attempts: number; message?: string}>({state: 'idle', attempts: 0});
  const [autoPollRequestInFlight, setAutoPollRequestInFlight] = useState(false);
  const [autoPollGeneration, setAutoPollGeneration] = useState(0);
  const storageKey = ownerKey ? `smartx.deposit.fiat-recovery.v1.${ownerKey}` : '';

  const writeRecovery = (record: FiatRecovery): boolean => {
    if (!storageKey) return false;
    try {
      const encoded = JSON.stringify(record);
      sessionStorage.setItem(storageKey, encoded);
      if (sessionStorage.getItem(storageKey) !== encoded) return false;
      setRecovery(record);
      return true;
    } catch {
      return false;
    }
  };
  const clearRecovery = () => {
    try {
      if (storageKey) sessionStorage.removeItem(storageKey);
      if (storageKey && sessionStorage.getItem(storageKey) !== null) throw new Error('recovery marker remains');
      setRecovery(undefined);
    } catch {
      setStorageBlocked(true);
      setError('The terminal order was reached, but its recovery marker could not be removed. New fiat creation remains blocked in this browser session.');
    }
  };
  const updateFromGet = (next: FiatDepositSession, base?: FiatRecovery) => {
    const providerOrderID = base?.depositID === next.deposit_id ? base.providerOrderID : undefined;
    setOrder((current) => ({...next, provider_order_id: current?.deposit_id === next.deposit_id ? current.provider_order_id : providerOrderID, client_secret: next.client_secret ?? (current?.deposit_id === next.deposit_id ? current.client_secret : undefined)}));
    setProofUncertain(false);
    if (isFiatTerminal(next.status)) {
      // A history record may be viewed while an unrelated Create result is
      // unresolved. Only the recovery target itself may clear its marker.
      if (recoveryTracksDeposit(base, next.deposit_id)) clearRecovery();
      if (next.status === 5) completedRef.current?.();
      return;
    }
    if (base && actorID && !writeRecovery({...base, phase: next.status === 9 ? 'unknown' : 'active', depositID: next.deposit_id})) {
      setStorageBlocked(true);
      setError('The active order was recovered, but its recovery marker could not be saved. New fiat creation remains blocked; keep this page open.');
    }
  };
  const updateFromGetRef = useRef(updateFromGet);
  updateFromGetRef.current = updateFromGet;
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;

  useEffect(() => {
    setRecoveryReady(false);
    setStorageBlocked(false);
    setActorMismatch(false);
    setOrder(undefined);
    setProofUncertain(false);
    setError(undefined);
    let stored: FiatRecovery | undefined;
    try {
      const parsed = parseFiatRecovery(storageKey ? sessionStorage.getItem(storageKey) : null, ownerKey);
      if (parsed.corrupt) {
        setStorageBlocked(true);
        setError('Fiat recovery metadata is corrupt. New order creation is blocked; use Deposit history and support to reconcile before clearing browser data.');
        setRecoveryReady(true);
        return;
      }
      stored = parsed.record;
    } catch {
      setStorageBlocked(true);
      setError('Recovery storage is unavailable. New fiat order creation is blocked because an idempotency key could not be preserved safely.');
      setRecoveryReady(true);
      return;
    }
    setRecovery(stored);
    if (stored?.intent) {
      setAmount(stored.intent.fiatAmount);
      setOrderEmail(stored.intent.receiptEmail);
    }
    if (stored && stored.privyUserID !== actorID) {
      setActorMismatch(true);
      setError('This unresolved fiat order belongs to a different or unloaded Privy session. Restore that exact Privy user before continuing.');
      setRecoveryReady(true);
      return;
    }
    // A history record may always be opened read-only. It must not replace an
    // unresolved pre-response marker that has no known deposit id.
    const targetID = stored?.depositID ?? resumeID;
    if (!targetID) {
      if (stored) setError('A dispatched fiat intent has no confirmed provider result. Retry only the exact same idempotent intent; do not create a new one.');
      setRecoveryReady(true);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    const base = stored?.depositID === targetID
      ? stored
      : (!stored && actorID ? {version: 1, ownerKey, privyUserID: actorID, phase: 'active', depositID: targetID} satisfies FiatRecovery : undefined);
    void getDeposit(bearer, targetID, controller.signal)
      .then((next) => {if (!controller.signal.aborted) updateFromGet(next, base);})
      .catch((cause) => {if (!controller.signal.aborted && !onProtectedError(cause)) setError(errorText(cause));})
      .finally(() => {if (!controller.signal.aborted) {setBusy(false); setRecoveryReady(true);}});
    return () => controller.abort();
  }, [actorID, bearer, ownerKey, resumeID, storageKey]);

  const checkoutMounted = order?.next_action === 'mount_checkout' && !!order.provider_order_id && !!order.client_secret && !!orderEmail && !!CROSSMINT_CLIENT_API_KEY && !!actorID && (!recovery || recovery.privyUserID === actorID);
  const pollableDepositID = actorID && shouldAutoPollFiatOrder(order) && (order?.next_action === 'wait' || checkoutMounted) ? order!.deposit_id : undefined;
  useEffect(() => {
    if (!pollableDepositID) {
      setAutoPoll({state: 'idle', attempts: 0});
      return;
    }
    const controller = new AbortController();
    const actor = actorID;
    setAutoPoll({state: 'checking', attempts: 0, message: 'The backend will refresh this same order while checkout is mounted or its next action is wait.'});
    void (async () => {
      let attempt = 0;
      while (attempt < FIAT_ORDER_MAX_POLL_ATTEMPTS) {
        await abortablePollDelay(fiatOrderPollDelayMs(attempt), controller.signal);
        await waitForVisibleDocument(controller.signal);
        if (actorRef.current !== actor || readSite()?.jwt !== bearer) return;
        if (lockRef.current) continue;
        attempt += 1;
        setAutoPoll({state: 'checking', attempts: attempt, message: `Checking the same fiat order (${attempt}/${FIAT_ORDER_MAX_POLL_ATTEMPTS})…`});
        try {
          autoPollRequestRef.current = true;
          setAutoPollRequestInFlight(true);
          const next = await getDeposit(bearer, pollableDepositID, controller.signal);
          if (controller.signal.aborted || actorRef.current !== actor || readSite()?.jwt !== bearer) return;
          updateFromGetRef.current(next, recoveryRef.current);
          if (!shouldAutoPollFiatOrder(next)) return;
          setAutoPoll({state: 'checking', attempts: attempt, message: 'Payment or delivery is still processing. The next check uses bounded backoff.'});
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (protectedErrorRef.current(cause)) return;
          setAutoPoll({state: 'checking', attempts: attempt, message: `A status check failed and will be retried with backoff. ${errorText(cause)}`});
        } finally {
          autoPollRequestRef.current = false;
          setAutoPollRequestInFlight(false);
        }
      }
      setAutoPoll({state: 'timeout', attempts: FIAT_ORDER_MAX_POLL_ATTEMPTS, message: 'Automatic status checks paused after the bounded window. Refresh this same order later; do not create a second order.'});
    })().catch((cause) => {
      if (!controller.signal.aborted) setAutoPoll({state: 'timeout', attempts: 0, message: errorText(cause)});
    });
    return () => {
      controller.abort();
      autoPollRequestRef.current = false;
      setAutoPollRequestInFlight(false);
    };
  }, [actorID, autoPollGeneration, bearer, pollableDepositID]);

  const openReview = () => {
    if (!actorID || !ownerKey || !receiptEmail || !validFiatAmount(amount) || lockRef.current || recovery || storageBlocked || !recoveryReady) return;
    setReview({idempotencyKey: newDepositIdempotencyKey(), fiatAmount: amount.trim(), receiptEmail});
    setError(undefined);
  };

  const runCreate = async (intent: FiatIntent) => {
    if (!actorID || lockRef.current) return;
    const marker: FiatRecovery = {version: 1, ownerKey, privyUserID: actorID, phase: 'dispatching', intent};
    if (!writeRecovery(marker)) {
      setStorageBlocked(true);
      setError('Could not persist the fiat idempotency recovery marker. No provider request was sent. Enable sessionStorage before creating an order.');
      return;
    }
    lockRef.current = true;
    setBusy(true);
    setReview(undefined);
    setOrderEmail(intent.receiptEmail);
    setError(undefined);
    try {
      const created = await createFiatDeposit(bearer, intent);
      const nextAction = created.wallet_proof ? 'submit_wallet_proof' : created.provider_order_id && created.client_secret ? 'mount_checkout' : 'wait';
      setOrder({...created, next_action: nextAction});
      const nextMarker: FiatRecovery = {...marker, phase: created.status === 9 ? 'unknown' : 'active', depositID: created.deposit_id, providerOrderID: created.provider_order_id};
      if (isFiatTerminal(created.status)) {
        clearRecovery();
        if (created.status === 5) completedRef.current?.();
      }
      else if (!writeRecovery(nextMarker)) setError('Order was created, but its updated recovery metadata could not be saved. Do not create another order; keep this page open and use the same order ID.');
    } catch (cause) {
      if (onProtectedError(cause)) clearRecovery();
      else if (fiatCreateFailureIsUncertain(cause)) {
        if (!writeRecovery({...marker, phase: 'unknown'})) setStorageBlocked(true);
        setError('Provider Create result is unknown. Do not resend it. Reconcile it in Deposit history or with support; only create a new intent after provider review.');
      } else {
        clearRecovery();
        setError(errorText(cause));
      }
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };

  const refreshOrder = async () => {
    const depositID = order?.deposit_id ?? recovery?.depositID;
    if (!depositID || lockRef.current || autoPollRequestRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await getDeposit(bearer, depositID);
      updateFromGet(next, recovery);
    } catch (cause) {
      if (!onProtectedError(cause)) setError(errorText(cause));
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };

  const submitProof = async () => {
    const proof = order?.wallet_proof;
    if (!proof || !order?.deposit_id || !canonicalSolanaAddress || !actorID || !walletsReady || proofUncertain || lockRef.current) return;
    const wallet = wallets.find((candidate) => candidate.address === canonicalSolanaAddress);
    if (!wallet) {setError(`The backend-selected Solana wallet ${canonicalSolanaAddress} is not loaded in this Privy session.`); return;}
    lockRef.current = true;
    const actor = actorID;
    setBusy(true);
    setError(undefined);
    let submitted = false;
    try {
      const signature = await signFiatWalletProof(
        ({message}) => signMessage({
          message,
          wallet,
          options: {uiOptions: {showWalletUIs: true, title: 'Confirm fiat deposit wallet', description: 'Sign the original Crossmint challenge only to prove ownership of this Solana wallet.', buttonText: 'Sign and continue'}},
        }),
        {address: wallet.address},
        proof.message,
      );
      if (actorRef.current !== actor) throw new Error('Privy session changed after signing. The proof was not submitted.');
      submitted = true;
      await submitFiatWalletProof(bearer, order.deposit_id, proof.challenge_id, signature);
      const next = await getDeposit(bearer, order.deposit_id);
      updateFromGet(next, recovery);
    } catch (cause) {
      if (onProtectedError(cause)) return;
      if (!submitted) {setError(errorText(cause)); return;}
      setProofUncertain(true);
      try {
        const next = await getDeposit(bearer, order.deposit_id);
        updateFromGet(next, recovery);
        setError(`Wallet-proof Submit did not return cleanly. The same order was recovered with next action ${next.next_action ?? 'unknown'}; no blind replay was sent.`);
      } catch (recoveryError) {
        if (!onProtectedError(recoveryError)) setError('Wallet-proof Submit and status recovery are both unknown. Refresh this same order before any further proof action.');
      }
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };

  const active = !!recovery || (!!order && !isFiatTerminal(order.status));
  const canCreate = recoveryReady && !storageBlocked && !actorMismatch && !active && !!actorID && !!ownerKey && !!receiptEmail && !!CROSSMINT_CLIENT_API_KEY && validFiatAmount(amount) && !busy;
  const checkoutReady = !busy && checkoutMounted;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold text-foreground">Buy USDC with fiat</h2><p className="mt-1 text-xs text-muted">Business creates one idempotent Crossmint order; the official checkout handles KYC, payment and delivery.</p></div>
        {order ? <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">{STATUS[order.status] ?? `Unknown ${order.status}`}</span> : null}
      </div>
      {!receiptEmail ? <p className="mt-4 rounded border border-accent/40 bg-accent/5 p-3 text-xs text-accent">The backend/Privy session did not expose one verified canonical email. Fiat creation is disabled.</p> : null}
      {!CROSSMINT_CLIENT_API_KEY ? <p className="mt-4 rounded border border-accent/40 bg-accent/5 p-3 text-xs text-accent">Configure NEXT_PUBLIC_CROSSMINT_CLIENT_SIDE_API_KEY with a Crossmint publishable browser key before creating an order. Never use the server key.</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">Amount (USD)<input value={amount} onChange={(event) => {setAmount(event.target.value); setReview(undefined);}} disabled={busy || active} inputMode="decimal" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground" /></label>
        <label className="text-xs text-muted">Verified receipt email<input value={receiptEmail ?? ''} readOnly className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground opacity-80" /></label>
      </div>
      {amount && !validFiatAmount(amount) ? <p className="mt-2 text-xs text-down">Use a positive USD amount with at most 12 integer digits and 2 decimals; leading zeroes are not accepted.</p> : null}
      {!active ? <button type="button" onClick={openReview} disabled={!canCreate} className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Review fiat deposit</button> : null}
      {review ? <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-3"><p className="text-sm text-foreground">Create one Crossmint order for <strong>${review.fiatAmount} USD</strong> to the canonical Solana wallet?</p><p className="mt-1 text-xs text-muted">The recovery marker must be stored before dispatch. An uncertain response keeps this exact idempotency key and blocks new orders.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setReview(undefined)} className="rounded border border-border px-3 py-2 text-xs text-muted">Cancel</button><button type="button" onClick={() => void runCreate(review)} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-white">Create order</button></div></div> : null}
      {recovery?.phase === 'dispatching' && recovery.intent && !recovery.depositID ? <button type="button" onClick={() => void runCreate(recovery.intent!)} disabled={busy || actorMismatch} className="mt-4 rounded-md border border-accent px-3 py-2 text-xs text-accent disabled:opacity-50">Retry exact same idempotent intent</button> : null}
      {recovery?.phase === 'unknown' && !recovery.depositID ? <p className="mt-4 rounded border border-down/40 bg-down/5 p-3 text-xs text-down">A provider Create result is unresolved. New orders and automatic replay are blocked. A history record opened below is read-only and does not clear this marker; reconcile with support before starting a new intent.</p> : null}
      {order ? <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-foreground">Deposit {order.deposit_id}</span><button type="button" onClick={() => void refreshOrder()} disabled={busy || autoPollRequestInFlight} className="text-accent hover:underline disabled:opacity-50">Refresh same order</button></div><p className="mt-2 text-muted">Next action: <span className="font-mono">{order.next_action ?? 'unknown'}</span></p>{order.status === 5 ? <p className="mt-2 text-up">Crossmint delivery completed. <Link href="/portfolio" className="underline">Verify the available balance in Portfolio.</Link></p> : null}{order.status === 9 ? <p className="mt-2 text-accent">Provider result is unknown. Do not create another order until reconciled.</p> : null}{order.deposit?.failure_reason ? <p className="mt-2 text-down">{order.deposit.failure_reason}</p> : null}</div> : null}
      {order?.next_action === 'submit_wallet_proof' && order.wallet_proof ? <button type="button" onClick={() => void submitProof()} disabled={busy || proofUncertain || !actorID || !walletsReady} className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Sign original wallet proof</button> : null}
      {order?.next_action === 'mount_checkout' && !order.provider_order_id ? <p className="mt-4 rounded border border-down/40 bg-down/5 p-3 text-xs text-down">The backend Get response does not return provider_order_id. This browser has no stored order ID, so checkout recovery is blocked; do not create another order.</p> : null}
      {checkoutReady ? <div className="mt-4"><CrossmintCheckout orderID={order!.provider_order_id!} clientSecret={order!.client_secret!} receiptEmail={orderEmail!} /></div> : null}
      {order?.next_action === 'wait' ? <p className="mt-3 rounded border border-accent/40 bg-accent/5 p-3 text-xs text-accent">Payment or delivery is processing. Refresh this same order; completion does not imply Portfolio balance until the on-chain read confirms it.</p> : null}
      {autoPoll.state !== 'idle' && autoPoll.message ? <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-3 text-xs text-accent"><p role="status">{autoPoll.message}</p>{autoPoll.state === 'timeout' && pollableDepositID ? <button type="button" onClick={() => setAutoPollGeneration((value) => value + 1)} className="mt-2 rounded border border-accent px-3 py-1.5">Resume bounded checks</button> : null}</div> : null}
      {!recoveryReady ? <p role="status" className="mt-3 text-xs text-muted">Checking account-scoped fiat recovery state…</p> : null}
      {busy ? <p role="status" className="mt-3 text-xs text-muted">Processing this existing fiat intent only…</p> : null}
      {error ? <p role="alert" className="mt-3 rounded border border-down/40 bg-down/5 p-3 text-xs text-down">{error}</p> : null}
    </section>
  );
}
