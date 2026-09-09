'use client';

import {usePrivy, useWallets as useEthereumWallets} from '@privy-io/react-auth';
import {AlertTriangle, LoaderCircle, RefreshCw} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {
  createDepositSweep,
  getDepositSweep,
  prepareDepositSweep,
  submitDepositSweep,
  type DepositSweep,
  type PrepareSweepReply,
} from '@/api/deposit';
import {ApiError} from '@/api/envelope';
import type {PortfolioAsset} from '@/api/portfolio';
import {expiryHasMargin} from '@/lib/deposit';
import {abortablePollDelay, waitForVisibleDocument} from '@/lib/deposit-polling';
import {signDepositSweepCalibur} from '@/lib/deposit-signing';
import {formatBaseUnitsExact} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {checkAuthorizationDigest, parseCaliburSignData} from '@/lib/trade-calibur';

type PendingSubmit = {sweepID: string; signature: string; expiresAt?: string; actorContext: string};
type SweepAttempt = {version: 1; ownerKey: string; originChain: string; originToken: string; sweepID?: string};

// A sweep needs independently verified on-chain balances/capabilities. Trade
// ledger positions from Portfolio are deliberately not assignable to this type.
type SweepPosition = {asset: PortfolioAsset; symbol?: string; decimals?: number; amount_raw: string; sweep?: {status: number; min_amount_raw?: string}};

function text(error: unknown) {
  if (error instanceof ApiError) return `Sweep request failed · code ${error.code} · trace ${error.traceID ?? 'unavailable'}`;
  return error instanceof Error ? error.message : String(error);
}
function terminal(sweep: DepositSweep) {
  return sweep.lifecycle === 'confirmed' || sweep.lifecycle === 'failed';
}
export function SweepDepositCard({bearer, ownerKey, identityMatched, positions, resumeID, onProtectedError}: {bearer: string; ownerKey: string; identityMatched: boolean; positions?: SweepPosition[]; resumeID?: string; onProtectedError: (error: unknown) => boolean}) {
  const {ready, authenticated, user} = usePrivy();
  const {wallets, ready: walletsReady} = useEthereumWallets();
  const candidates = positions?.filter((position) => position.asset.kind === 'erc20' && position.sweep) ?? [];
  const [review, setReview] = useState<SweepPosition>();
  const [sweep, setSweep] = useState<DepositSweep>();
  const [nextAction, setNextAction] = useState<string>();
  const [pending, setPending] = useState<PendingSubmit>();
  const [prepared, setPrepared] = useState<PrepareSweepReply>();
  const [confirmed, setConfirmed] = useState(false);
  const [needsAuthorization, setNeedsAuthorization] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [attempt, setAttempt] = useState<SweepAttempt>();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const lockRef = useRef(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const actorContext = ready && authenticated && user && walletsReady && identityMatched ? `${bearer}\u0000${user.id}` : undefined;
  const actorContextRef = useRef<string | undefined>(actorContext);
  actorContextRef.current = actorContext;
  const storageKey = ownerKey ? `smartx.deposit.sweep-recovery.v1.${ownerKey}` : '';

  const writeAttempt = (value: SweepAttempt): boolean => {
    try {
      const encoded = JSON.stringify(value);
      sessionStorage.setItem(storageKey, encoded);
      if (sessionStorage.getItem(storageKey) !== encoded) return false;
      setAttempt(value);
      return true;
    } catch {return false;}
  };
  const clearAttempt = () => {
    try {sessionStorage.removeItem(storageKey); if (sessionStorage.getItem(storageKey) !== null) throw new Error('marker remains'); setAttempt(undefined);}
    catch {setStorageBlocked(true); setError('Sweep finished, but its recovery marker could not be removed. New sweeps remain blocked in this browser session.');}
  };

  const startOperation = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  };
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => () => controllerRef.current?.abort(), [actorContext]);

  const report = (cause: unknown) => {
    if (!onProtectedError(cause)) setError(text(cause));
  };

  useEffect(() => {
    setRecoveryReady(false);
    let stored: SweepAttempt | undefined;
    try {
      const raw = storageKey ? sessionStorage.getItem(storageKey) : null;
      if (raw) {
        const row = JSON.parse(raw) as Partial<SweepAttempt>;
        if (
          row.version !== 1 || row.ownerKey !== ownerKey ||
          typeof row.originChain !== 'string' || !row.originChain ||
          typeof row.originToken !== 'string' || !row.originToken ||
          (row.sweepID !== undefined && (typeof row.sweepID !== 'string' || !row.sweepID))
        ) throw new Error('invalid marker');
        stored = {version: 1, ownerKey, originChain: row.originChain, originToken: row.originToken, sweepID: row.sweepID};
        setAttempt(stored);
      }
    } catch {
      setStorageBlocked(true); setError('Sweep recovery metadata is corrupt. New sweep creation is blocked until the existing state is reconciled.'); setRecoveryReady(true); return;
    }
    const targetID = stored?.sweepID ?? (stored ? undefined : resumeID);
    if (!targetID) {
      if (stored) setNotice('A prior Sweep Create was dispatched without a confirmed response. Review and retry only the same chain/token; the backend will recover the active sweep.');
      setRecoveryReady(true);
      return;
    }
    const controller = startOperation();
    setBusy(true);
    setError(undefined);
    void getDepositSweep(bearer, targetID, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setSweep(result.sweep); setNextAction(result.next_action); setPending(undefined); setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false);
        if (terminal(result.sweep)) clearAttempt();
        else if (!stored) writeAttempt({version: 1, ownerKey, originChain: result.sweep.origin_chain, originToken: result.sweep.origin_token, sweepID: result.sweep.sweep_id});
      })
      .catch((cause) => {if (!controller.signal.aborted) report(cause);})
      .finally(() => {if (!controller.signal.aborted) {setBusy(false); setRecoveryReady(true);}});
    return () => controller.abort();
  }, [actorContext, bearer, ownerKey, resumeID, storageKey]);

  const confirmCreate = async () => {
    if (!review || !ownerKey || !actorContext || review.sweep?.status !== 1 || lockRef.current || storageBlocked || !recoveryReady || sweep && !terminal(sweep)) return;
    const marker: SweepAttempt = {version: 1, ownerKey, originChain: review.asset.chain, originToken: review.asset.token_address};
    if (!writeAttempt(marker)) {setStorageBlocked(true); setError('Could not persist Sweep recovery metadata. No Create request was sent.'); return;}
    lockRef.current = true;
    const controller = startOperation();
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await createDepositSweep(bearer, review.asset.chain, review.asset.token_address, controller.signal);
      if (controller.signal.aborted) return;
      const recovered = await getDepositSweep(bearer, result.sweep.sweep_id, controller.signal);
      writeAttempt({...marker, sweepID: result.sweep.sweep_id});
      setSweep(recovered.sweep); setNextAction(recovered.next_action); setPending(undefined); setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false); setReview(undefined);
      if (terminal(recovered.sweep)) clearAttempt();
      setNotice(result.duplicate ? 'An existing active sweep was recovered; no second sweep was created.' : 'Sweep intent created. Review it below before signing.');
    } catch (cause) {
      if (!controller.signal.aborted) report(cause);
    } finally {
      lockRef.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const poll = async (initial: DepositSweep, controller: AbortController) => {
    let current = initial;
    for (let round = 0; round < 45 && !terminal(current); round += 1) {
      await abortablePollDelay(round === 0 ? 0 : 2_000, controller.signal);
      await waitForVisibleDocument(controller.signal);
      const result = await getDepositSweep(bearer, current.sweep_id, controller.signal);
      current = result.sweep;
      setSweep(current); setNextAction(result.next_action);
      if (result.next_action !== 'sign') {setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false);}
      if (result.next_action && result.next_action !== 'wait') break;
    }
    if (terminal(current)) clearAttempt();
    if (!terminal(current)) setNotice('Sweep is still pending. Keep this sweep ID and check the same record again; do not create another sweep.');
  };

  const submitAndRecover = async (payload: PendingSubmit, controller: AbortController) => {
    if (actorContextRef.current !== payload.actorContext) throw new Error('Privy session changed before Submit. The sweep was not submitted.');
    try {
      const submitted = await submitDepositSweep(bearer, payload.sweepID, payload.signature, controller.signal);
      setSweep(submitted); setPending(undefined);
      await poll(submitted, controller);
    } catch (submitError) {
      if (controller.signal.aborted) throw submitError;
      if (onProtectedError(submitError)) return;
      try {
        const recovered = await getDepositSweep(bearer, payload.sweepID, controller.signal);
        setSweep(recovered.sweep); setNextAction(recovered.next_action);
        if (terminal(recovered.sweep)) clearAttempt();
        if (recovered.sweep.lifecycle !== 'awaiting_signature') setPending(undefined);
        setError(`Submit did not return cleanly; the same sweep was recovered as ${recovered.sweep.lifecycle}. Do not create another sweep.`);
      } catch (recoveryError) {
        if (!onProtectedError(recoveryError)) setError('Submit result and sweep recovery are both unknown. Keep this sweep ID and do not create another sweep; contact support.');
      }
    }
  };

  const prepareOnly = async () => {
    if (!sweep || terminal(sweep) || !actorContext || lockRef.current || (nextAction !== 'prepare' && nextAction !== 'sign')) return;
    lockRef.current = true;
    const controller = startOperation();
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const next = await prepareDepositSweep(bearer, sweep.sweep_id, controller.signal);
      if (actorContextRef.current !== actorContext) throw new Error('Privy session changed during Prepare. No signature was requested.');
      if (next.sign_kind !== 5) throw new Error(`Unsupported sweep sign_kind=${next.sign_kind}; expected Calibur batch kind 5.`);
      if (!expiryHasMargin(next.expires_at)) throw new Error('Prepared sweep is expired or has less than five seconds remaining. Prepare the same sweep again.');
      const envelope = parseCaliburSignData(Uint8Array.from(atob(next.sign_data), (char) => char.charCodeAt(0)));
      if (envelope.authorization) checkAuthorizationDigest(envelope.authorization);
      const wallet = wallets.find((candidate) => candidate.address.toLowerCase() === next.wallet_address.toLowerCase());
      if (!wallet) throw new Error(`Backend selected ${next.wallet_address}, which is not loaded in the current Privy EVM signer.`);
      setSweep(next.sweep); setPrepared(next); setConfirmed(false); setNeedsAuthorization(!!envelope.authorization); setNextAction('sign');
    } catch (cause) {
      if (!controller.signal.aborted) report(cause);
    } finally {
      lockRef.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const signAndSubmitPrepared = async () => {
    if (!prepared || !confirmed || !actorContext || lockRef.current) return;
    if (!expiryHasMargin(prepared.expires_at)) {setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false); setNotice('Prepared sweep expired. Prepare the same sweep again.'); return;}
    const wallet = wallets.find((candidate) => candidate.address.toLowerCase() === prepared.wallet_address.toLowerCase());
    if (!wallet) {setError(`Backend selected ${prepared.wallet_address}, which is not loaded in the current Privy EVM signer.`); return;}
    lockRef.current = true;
    const controller = startOperation();
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const signature = await signDepositSweepCalibur(wallet, prepared.sign_data, prepared.wallet_address);
      if (actorContextRef.current !== actorContext) throw new Error('Privy session changed after signing. The sweep was not submitted.');
      if (!expiryHasMargin(prepared.expires_at)) throw new Error('Prepared sweep expired after signing. The signature was not submitted; prepare again.');
      const payload = {sweepID: prepared.sweep.sweep_id, signature, expiresAt: prepared.expires_at, actorContext};
      setPending(payload); setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false);
      await submitAndRecover(payload, controller);
    } catch (cause) {
      if (!controller.signal.aborted) report(cause);
    } finally {
      lockRef.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const retrySameSubmit = async () => {
    if (!pending || !actorContext || pending.actorContext !== actorContext || lockRef.current) return;
    if (!expiryHasMargin(pending.expiresAt)) {setPending(undefined); setNotice('The saved signature expired. Prepare and sign the same sweep again.'); return;}
    lockRef.current = true;
    const controller = startOperation();
    setBusy(true); setError(undefined);
    try {
      const current = await getDepositSweep(bearer, pending.sweepID, controller.signal);
      setSweep(current.sweep); setNextAction(current.next_action);
      if (current.next_action !== 'sign') {setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false);}
      if (terminal(current.sweep) || current.next_action === 'wait') {
        setPending(undefined);
        if (current.next_action === 'wait') await poll(current.sweep, controller);
        return;
      }
      if (current.sweep.lifecycle !== 'awaiting_signature' || current.next_action !== 'sign') {
        setPending(undefined);
        setNotice(`The same sweep now requires ${current.next_action ?? 'an unknown action'}; the saved signature was not submitted.`);
        return;
      }
      await submitAndRecover(pending, controller);
    } catch (cause) {
      if (!controller.signal.aborted) report(cause);
    } finally {
      lockRef.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const checkStatus = async () => {
    if (!sweep || lockRef.current) return;
    lockRef.current = true;
    const controller = startOperation();
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await getDepositSweep(bearer, sweep.sweep_id, controller.signal);
      setSweep(result.sweep); setNextAction(result.next_action);
      if (terminal(result.sweep)) clearAttempt();
      if (result.next_action !== 'sign') {setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false);}
      if (result.sweep.lifecycle !== 'awaiting_signature') setPending(undefined);
      if (result.next_action === 'wait') await poll(result.sweep, controller);
    } catch (cause) {if (!controller.signal.aborted) report(cause);}
    finally {lockRef.current = false; if (!controller.signal.aborted) setBusy(false);}
  };

  const hasActive = !!attempt || (!!sweep && !terminal(sweep));
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div><h2 className="font-semibold text-foreground">EVM full-balance sweep</h2><p className="mt-1 text-xs text-muted">Sweep requires verified wallet balances and supported assets. Prepare rereads the complete latest balance; there is no amount input.</p></div>
      {review ? <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-3"><p className="text-sm text-foreground">Create a sweep for the complete latest balance of <strong>{review.symbol ?? shortAddr(review.asset.token_address)}</strong> on {chainLabel(review.asset.chain)}?</p><p className="mt-1 text-xs text-muted">Selected identity: <span className="font-mono">{review.asset.chain} · {review.asset.token_address}</span>. The backend controls recipient, refund path and minimum output.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setReview(undefined)} className="rounded border border-border px-3 py-2 text-xs text-muted">Cancel</button><button type="button" onClick={() => void confirmCreate()} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-white">Create sweep intent</button></div></div> : null}
      <div className="mt-4 space-y-2">
        {candidates.length === 0 ? <p className="text-sm text-muted">{positions === undefined ? 'Sweep asset discovery is temporarily unavailable. Existing sweep recovery remains available below.' : 'No verified wallet asset currently has a sweep capability.'}</p> : candidates.map((position) => {
          const exactRecovery = !!attempt && !attempt.sweepID && attempt.originChain === position.asset.chain &&
            (position.asset.token_address.startsWith('0x')
              ? attempt.originToken.toLowerCase() === position.asset.token_address.toLowerCase()
              : attempt.originToken === position.asset.token_address);
          return (
            <div key={`${position.asset.chain_id}:${position.asset.token_address}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
              <div><p className="text-sm font-medium text-foreground">{position.symbol ?? shortAddr(position.asset.token_address)} · {chainLabel(position.asset.chain)}</p><p className="mt-1 font-mono text-xs text-muted">{formatBaseUnitsExact(position.amount_raw, position.decimals)} · {shortAddr(position.asset.token_address, 7, 6)}</p>{position.sweep?.status === 2 ? <p className="mt-1 text-xs text-accent">Below minimum: {position.sweep.min_amount_raw ?? 'unknown'} base units</p> : position.sweep?.status === 3 ? <p className="mt-1 text-xs text-muted">Route disabled</p> : null}</div>
              <button type="button" disabled={position.sweep?.status !== 1 || (hasActive && !exactRecovery) || busy || !recoveryReady || storageBlocked || !actorContext} onClick={() => setReview(position)} className="rounded-md border border-border px-3 py-2 text-xs text-accent disabled:opacity-50">{exactRecovery ? 'Recover exact Create' : 'Review sweep'}</button>
            </div>
          );
        })}
      </div>
      {sweep ? (
        <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-foreground">Sweep {sweep.sweep_id}</span>
            <span className="text-muted">{sweep.lifecycle} · {nextAction ?? 'unknown action'}</span>
          </div>
          {sweep.amount_raw ? <p className="mt-2 text-muted">Locked amount: <span className="font-mono">{formatBaseUnitsExact(sweep.amount_raw, sweep.origin_decimals)}</span></p> : null}
          {sweep.origin_tx_hash ? <p className="mt-1 break-all text-muted">Origin tx: {sweep.origin_tx_hash}</p> : null}
          {sweep.destination_tx_hash ? <p className="mt-1 break-all text-muted">Destination tx: {sweep.destination_tx_hash}</p> : null}
          {sweep.refund_tx_hash ? <p className="mt-1 break-all text-accent">Refund tx: {sweep.refund_tx_hash}</p> : null}
          {sweep.failure_reason ? <p className="mt-2 text-down">{sweep.failure_reason}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!terminal(sweep) && (nextAction === 'prepare' || nextAction === 'sign') && !pending && !prepared ? <button type="button" onClick={() => void prepareOnly()} disabled={busy || !actorContext} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Prepare same sweep</button> : null}
            {pending && !terminal(sweep) && pending.actorContext === actorContext ? <button type="button" onClick={() => void retrySameSubmit()} disabled={busy || !actorContext} className="rounded border border-accent px-3 py-2 text-xs text-accent disabled:opacity-50">Retry same Submit</button> : null}
            {!terminal(sweep) ? <button type="button" onClick={() => void checkStatus()} disabled={busy} className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs text-muted disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Check same sweep</button> : null}
          </div>
        </div>
      ) : null}
      {prepared ? (
        <div className="mt-4 rounded-md border border-accent/50 bg-accent/5 p-3 text-xs">
          <h3 className="font-semibold text-foreground">Confirm complete-balance sweep</h3>
          <dl className="mt-3 grid gap-2">
            <div><dt className="text-muted">Source</dt><dd className="break-all font-mono text-foreground">{prepared.sweep.origin_chain} · {prepared.sweep.origin_token}</dd></div>
            <div><dt className="text-muted">Complete latest balance</dt><dd className="font-mono text-foreground">{prepared.sweep.amount_raw ? `${formatBaseUnitsExact(prepared.sweep.amount_raw, prepared.sweep.origin_decimals)} (${prepared.sweep.amount_raw} raw)` : 'Unavailable'}</dd></div>
            <div><dt className="text-muted">Destination token</dt><dd className="break-all font-mono text-foreground">{prepared.sweep.destination_token ?? 'Unavailable'}</dd></div>
            <div><dt className="text-muted">Required EVM signer</dt><dd className="break-all font-mono text-foreground">{prepared.wallet_address}</dd></div>
            <div><dt className="text-muted">Signature deadline</dt><dd className="text-foreground">{prepared.expires_at ? new Date(prepared.expires_at).toLocaleString() : 'Unavailable'}</dd></div>
            <div><dt className="text-muted">EIP-7702 authorization</dt><dd className="text-foreground">{needsAuthorization ? 'Required (two digest signatures)' : 'Not required'}</dd></div>
          </dl>
          <label className="mt-3 flex items-start gap-2 text-foreground"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" /><span>I verified the source chain/token, complete balance, destination token and required signer. Submit this same sweep through Relay.</span></label>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => {setPrepared(undefined); setConfirmed(false); setNeedsAuthorization(false);}} disabled={busy} className="rounded border border-border px-3 py-2 text-muted">Cancel</button><button type="button" onClick={() => void signAndSubmitPrepared()} disabled={busy || !confirmed || !actorContext || !expiryHasMargin(prepared.expires_at)} className="rounded bg-down px-3 py-2 font-semibold text-white disabled:opacity-50">Sign and Submit</button></div>
        </div>
      ) : null}
      {!ready || !authenticated || !walletsReady ? <p className="mt-3 text-xs text-muted">Restore the Privy session and EVM signer before preparing a sweep.</p> : null}
      {busy ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Processing the current sweep only…</p> : null}
      {notice ? <p role="status" className="mt-3 rounded border border-accent/40 bg-accent/5 p-3 text-xs text-accent">{notice}</p> : null}
      {error ? <p role="alert" className="mt-3 flex items-start gap-2 rounded border border-down/40 bg-down/5 p-3 text-xs text-down"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}</p> : null}
    </section>
  );
}
