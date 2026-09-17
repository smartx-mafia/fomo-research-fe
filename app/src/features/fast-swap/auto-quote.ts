import {PublicKey} from '@solana/web3.js';
import {ChainLegStatus, ExecutionStatus, Outcome, RelayStatus, type CreateIntent, type SwapSnapshot} from './contract';

export type QuoteDraft = Omit<CreateIntent, 'client_intent_id'>;

export function draftKey(draft: QuoteDraft | CreateIntent): string {
  const asset = (chain: string, address: string) => chain.startsWith('eip155:') ? address.toLowerCase() : address;
  return JSON.stringify([draft.origin_chain, draft.destination_chain, asset(draft.origin_chain,draft.origin_asset),
    asset(draft.destination_chain,draft.destination_asset), draft.amount_in_raw, draft.slippage_bps,
    draft.side, draft.source_wallet_id, draft.destination_wallet_id, draft.fee_policy]);
}

export function validDraft(draft: QuoteDraft): boolean {
  if (!/^\d+$/.test(draft.amount_in_raw) || BigInt(draft.amount_in_raw) <= BigInt(0) ||
      !Number.isSafeInteger(draft.slippage_bps) || draft.slippage_bps < 1 || draft.slippage_bps > 10000 ||
      !draft.source_wallet_id || !draft.destination_wallet_id) return false;
  const validAsset = (chain: string, address: string) => {
    if (/^eip155:\d+$/.test(chain)) return /^0x[0-9a-f]{40}$/i.test(address);
    if (chain !== 'solana:mainnet') return false;
    try { return new PublicKey(address).toBase58() === address; } catch { return false; }
  };
  return validAsset(draft.origin_chain,draft.origin_asset) && validAsset(draft.destination_chain,draft.destination_asset);
}

/** Only an unsigned intent with no evidence of money movement is replaceable. */
export function unsignedQuote(snapshot: SwapSnapshot): boolean {
  return snapshot.execution.status === ExecutionStatus.NOT_REPORTED &&
    !snapshot.execution.artifact_hash && !snapshot.execution.origin_tx_hash &&
    snapshot.settlement.source === ChainLegStatus.NOT_SEEN &&
    snapshot.settlement.destination === ChainLegStatus.NOT_SEEN &&
    snapshot.settlement.relay === RelayStatus.PENDING &&
    !snapshot.settlement.destination_tx_hash && snapshot.settlement.amount_in_actual_raw === null &&
    [Outcome.PENDING, Outcome.CANCEL_PENDING].includes(snapshot.settlement.outcome as never);
}

/** Replayed events must not restart the signing lifetime of the same revision. */
export function signingDeadline(deadlines: Map<string, number>, snapshot: SwapSnapshot, now: number) {
  const key = `${snapshot.swap_id}:${snapshot.preparation.current_revision}`;
  const ttl = snapshot.preparation.retry_after_ms;
  if (snapshot.preparation.status !== 2 || ttl === null || ttl <= 0) return {key,until:0};
  const until = Math.min(deadlines.get(key) ?? Infinity, now + ttl);
  deadlines.set(key,until);
  return {key,until};
}
