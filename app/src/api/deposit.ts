import {call} from './envelope';
import type {ProtoTimestamp} from './portfolio';

export type AcceptedToken = {symbol: string; address: string; decimals: number};
export type DepositAddress = {
  chain: string;
  address: string;
  address_format: 'base58' | 'evm' | string;
  accepted_tokens: AcceptedToken[];
  min_sweep_amount?: string;
  balance_raw?: string;
  balance_meets_minimum?: boolean;
  deposit_mode?: 'direct' | 'sweep';
};
export type WalletProofChallenge = {challenge_id: string; message: string};
export type DepositEntry = {
  deposit_id: string;
  kind: number;
  status: number;
  fiat_amount?: string;
  fiat_currency?: string;
  token_amount?: string;
  token_currency?: string;
  token_decimals?: number;
  chain?: string;
  tx_hash?: string;
  failure_reason?: string;
  created_at?: ProtoTimestamp;
  updated_at?: ProtoTimestamp;
};
export type FiatDepositSession = {
  deposit_id: string;
  provider_order_id?: string;
  client_secret?: string;
  status: number;
  wallet_proof?: WalletProofChallenge;
  deposit?: DepositEntry;
  next_action?: string;
};
export type DepositSweep = {
  sweep_id: string;
  status?: string;
  lifecycle: string;
  reconciliation_state?: string;
  origin_chain: string;
  origin_token: string;
  origin_decimals?: number;
  amount_raw?: string;
  destination_token?: string;
  action_hash?: string;
  origin_tx_hash?: string;
  destination_tx_hash?: string;
  refund_tx_hash?: string;
  failure_reason?: string;
  created_at?: ProtoTimestamp;
  updated_at?: ProtoTimestamp;
};
export type PrepareSweepReply = {
  sweep: DepositSweep & {amount_raw: string; destination_token: string};
  sign_kind: number;
  sign_data: string;
  wallet_address: string;
  expires_at?: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Deposit response is missing ${field}.`);
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
function nonnegativeIntegerString(value: unknown, field: string): string | undefined {
  const output = optionalString(value);
  if (output !== undefined && !/^\d+$/.test(output)) throw new Error(`Deposit response has invalid ${field}.`);
  return output;
}
function decimalString(value: unknown, field: string): string | undefined {
  const output = optionalString(value);
  if (output !== undefined && !/^\d+(?:\.\d+)?$/.test(output)) throw new Error(`Deposit response has invalid ${field}.`);
  return output;
}
function timestamp(value: unknown): ProtoTimestamp | undefined {
  const row = record(value);
  if (!row || (typeof row.seconds !== 'number' && typeof row.seconds !== 'string')) return undefined;
  return {seconds: row.seconds, ...(typeof row.nanos === 'number' ? {nanos: row.nanos} : {})};
}
function challenge(value: unknown): WalletProofChallenge | undefined {
  const row = record(value);
  if (!row) return undefined;
  return {challenge_id: requiredString(row.challenge_id, 'wallet_proof.challenge_id'), message: requiredString(row.message, 'wallet_proof.message')};
}
function depositEntry(value: unknown): DepositEntry {
  const row = record(value);
  if (!row || !Number.isInteger(row.kind) || !Number.isInteger(row.status)) throw new Error('Deposit response has invalid entry enums.');
  return {
    deposit_id: requiredString(row.deposit_id, 'deposit_id'), kind: row.kind as number, status: row.status as number,
    fiat_amount: decimalString(row.fiat_amount, 'fiat_amount'), fiat_currency: optionalString(row.fiat_currency),
    token_amount: nonnegativeIntegerString(row.token_amount, 'token_amount'), token_currency: optionalString(row.token_currency),
    token_decimals: typeof row.token_decimals === 'number' && Number.isInteger(row.token_decimals) && row.token_decimals >= 0 && row.token_decimals <= 255 ? row.token_decimals : undefined,
    chain: optionalString(row.chain), tx_hash: optionalString(row.tx_hash), failure_reason: optionalString(row.failure_reason),
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
  };
}
function sweep(value: unknown): DepositSweep {
  const row = record(value);
  if (!row) throw new Error('Deposit response is missing sweep.');
  return {
    sweep_id: requiredString(row.sweep_id, 'sweep_id'), lifecycle: requiredString(row.lifecycle, 'sweep.lifecycle'),
    status: optionalString(row.status), reconciliation_state: optionalString(row.reconciliation_state),
    origin_chain: requiredString(row.origin_chain, 'sweep.origin_chain'), origin_token: requiredString(row.origin_token, 'sweep.origin_token'),
    origin_decimals: typeof row.origin_decimals === 'number' && Number.isInteger(row.origin_decimals) && row.origin_decimals >= 0 && row.origin_decimals <= 255 ? row.origin_decimals : undefined,
    amount_raw: nonnegativeIntegerString(row.amount_raw, 'sweep.amount_raw'), destination_token: optionalString(row.destination_token),
    action_hash: optionalString(row.action_hash), origin_tx_hash: optionalString(row.origin_tx_hash), destination_tx_hash: optionalString(row.destination_tx_hash),
    refund_tx_hash: optionalString(row.refund_tx_hash), failure_reason: optionalString(row.failure_reason),
    created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at),
  };
}


export async function createFiatDeposit(bearer: string, request: {idempotencyKey: string; fiatAmount: string; receiptEmail: string}, signal?: AbortSignal): Promise<FiatDepositSession> {
  if (!request.idempotencyKey || request.idempotencyKey.length > 128) throw new Error('Fiat deposit idempotency key is invalid.');
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(request.fiatAmount) || BigInt(request.fiatAmount.replace('.', '')) <= BigInt(0)) throw new Error('Fiat deposit amount is invalid.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.receiptEmail)) throw new Error('Fiat deposit receipt email is invalid.');
  const response = await call<unknown>('/v1/deposits/fiat', {method: 'POST', bearer, signal, body: {
    idempotency_key: request.idempotencyKey, fiat_amount: request.fiatAmount, fiat_currency: 'USD', receipt_email: request.receiptEmail,
  }});
  const row = record(response.data);
  if (!row || !Number.isInteger(row.status)) throw new Error('Fiat deposit response is invalid.');
  return {deposit_id: requiredString(row.deposit_id, 'deposit_id'), provider_order_id: optionalString(row.provider_order_id), client_secret: optionalString(row.client_secret), status: row.status as number, wallet_proof: challenge(row.wallet_proof)};
}

export async function submitFiatWalletProof(bearer: string, depositID: string, challengeID: string, signature: string, signal?: AbortSignal) {
  const response = await call<{status: number; verified?: boolean}>(`/v1/deposits/fiat/${encodeURIComponent(depositID)}/wallet-proof`, {method: 'POST', bearer, signal, body: {challenge_id: challengeID, signature}});
  if (!Number.isInteger(response.data.status) || response.data.verified !== true) throw new Error('Wallet proof success response is invalid.');
  return response.data;
}

export async function getDeposit(bearer: string, depositID: string, signal?: AbortSignal): Promise<FiatDepositSession> {
  const response = await call<unknown>(`/v1/deposits/${encodeURIComponent(depositID)}`, {bearer, signal});
  const row = record(response.data);
  if (!row) throw new Error('Deposit detail response is invalid.');
  const entry = depositEntry(row.deposit);
  if (entry.deposit_id !== depositID) throw new Error('Deposit detail identity does not match the request.');
  return {deposit_id: entry.deposit_id, status: entry.status, deposit: entry, next_action: optionalString(row.next_action), wallet_proof: challenge(row.wallet_proof), client_secret: optionalString(row.client_secret)};
}

export async function createDepositSweep(bearer: string, originChain: string, originTokenAddress: string, signal?: AbortSignal) {
  if (!originChain || !originTokenAddress) throw new Error('Sweep origin chain and token are required.');
  const response = await call<unknown>('/v1/deposit-sweeps', {method: 'POST', bearer, signal, body: {origin_chain: originChain, origin_token_address: originTokenAddress}});
  const row = record(response.data);
  if (!row) throw new Error('Create sweep response is invalid.');
  const result = sweep(row.sweep);
  const addressMatches = /^0x/i.test(originTokenAddress)
    ? result.origin_token.toLowerCase() === originTokenAddress.toLowerCase()
    : result.origin_token === originTokenAddress;
  if (result.origin_chain !== originChain || !addressMatches) throw new Error('Created sweep identity does not match the selected Portfolio asset.');
  return {sweep: result, duplicate: row.duplicate === true};
}
export async function prepareDepositSweep(bearer: string, sweepID: string, signal?: AbortSignal): Promise<PrepareSweepReply> {
  const response = await call<unknown>(`/v1/deposit-sweeps/${encodeURIComponent(sweepID)}/prepare`, {method: 'POST', bearer, signal});
  const row = record(response.data);
  if (!row || !Number.isInteger(row.sign_kind)) throw new Error('Prepare sweep response is invalid.');
  const result = sweep(row.sweep);
  if (result.sweep_id !== sweepID) throw new Error('Prepared sweep identity does not match the request.');
  if (!result.amount_raw || !/^[1-9]\d*$/.test(result.amount_raw) || !result.destination_token) throw new Error('Prepared sweep is missing a positive complete balance or destination token.');
  return {sweep: result as DepositSweep & {amount_raw: string; destination_token: string}, sign_kind: row.sign_kind as number, sign_data: requiredString(row.sign_data, 'sign_data'), wallet_address: requiredString(row.wallet_address, 'wallet_address'), expires_at: optionalString(row.expires_at)};
}
export async function submitDepositSweep(bearer: string, sweepID: string, signature: string, signal?: AbortSignal): Promise<DepositSweep> {
  const response = await call<unknown>(`/v1/deposit-sweeps/${encodeURIComponent(sweepID)}/submit`, {method: 'POST', bearer, signal, body: {signature}});
  const row = record(response.data);
  if (!row) throw new Error('Submit sweep response is invalid.');
  const result = sweep(row.sweep);
  if (result.sweep_id !== sweepID) throw new Error('Submitted sweep identity does not match the request.');
  return result;
}
export async function getDepositSweep(bearer: string, sweepID: string, signal?: AbortSignal) {
  const response = await call<unknown>(`/v1/deposit-sweeps/${encodeURIComponent(sweepID)}`, {bearer, signal});
  const row = record(response.data);
  if (!row) throw new Error('Sweep detail response is invalid.');
  const result = sweep(row.sweep);
  if (result.sweep_id !== sweepID) throw new Error('Sweep detail identity does not match the request.');
  return {sweep: result, next_action: optionalString(row.next_action)};
}
