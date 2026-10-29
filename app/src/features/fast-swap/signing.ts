import {Connection, PublicKey, VersionedTransaction} from '@solana/web3.js';
import {hashTypedData, recoverAddress, recoverTypedDataAddress, type Address, type Hex} from 'viem';
import {hashAuthorization} from 'viem/utils';

import {EvmSigningMethod, SigningKind, type CreateIntent, type EvmSigning, type SolanaSigning} from './contract';

export function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}
export function encodeBase64(value: Uint8Array): string {
  let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary);
}
function hex(value: Uint8Array): Hex { return `0x${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`; }
function bytes(value: string): Uint8Array {
  const raw = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-f]*$/i.test(raw) || raw.length % 2) throw new Error('Wallet returned invalid hex.');
  return Uint8Array.from({length: raw.length / 2}, (_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16));
}
function normalizeSignature(value: string): Hex {
  const signature = bytes(value);
  if (signature.length === 64) {
    const expanded = new Uint8Array(65); expanded.set(signature);
    const parity = (expanded[32] & 0x80) >>> 7; expanded[32] &= 0x7f; expanded[64] = parity;
    return hex(expanded);
  }
  if (signature.length !== 65 || ![0, 1, 27, 28].includes(signature[64]!)) throw new Error('Wallet returned a non-recoverable EVM signature.');
  return hex(signature);
}
async function sha256(value: Uint8Array): Promise<string> {
  const source = new Uint8Array(value).buffer;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', source))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export type SigningTimingReporter = (
  stage: 'solana_precheck_start' | 'solana_precheck_done' | 'evm_precheck_start' | 'evm_precheck_done' | 'evm_precheck_error' | 'evm_provider_start' | 'evm_provider_done' | 'evm_provider_error' | 'privy_sign_start' | 'privy_sign_done' | 'privy_sign_error' | 'evm_postcheck_done' | 'evm_postcheck_error' | 'solana_postcheck_done' | 'solana_postcheck_error' | 'solana_base64_start' | 'solana_base64_done' | 'solana_base64_error',
  details?: Record<string, string | number | boolean | null>,
) => void;

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export async function signSolanaRevision(
  signing: SolanaSigning,
  wallet: {address: string},
  signTransaction: (input: {transaction: Uint8Array; wallet: never; options?: {uiOptions?: {showWalletUIs?: boolean; title?: string; description?: string; buttonText?: string}}}) => Promise<{signedTransaction: Uint8Array}>,
  reportTiming?: SigningTimingReporter,
): Promise<string> {
  const report = (stage: Parameters<SigningTimingReporter>[0], details?: Parameters<SigningTimingReporter>[1]) => {
    try { reportTiming?.(stage, details); } catch { /* Diagnostics never interrupt signing. */ }
  };
  const precheckStarted = monotonicNow();
  report('solana_precheck_start');
  if (signing.kind !== SigningKind.SOLANA_TRANSACTION) throw new Error('The revision is not a Solana transaction.');
  if (signing.broadcast.mode !== 1) throw new Error('This client only supports the backend gateway broadcast mode.');
  if (wallet.address !== signing.user_signer_address) throw new Error('The loaded Solana signer does not match the prepared transaction.');
  const preparedBytes = decodeBase64(signing.transaction_base64);
  const prepared = VersionedTransaction.deserialize(preparedBytes);
  const message = prepared.message.serialize();
  if (await sha256(message) !== signing.message_hash.toLowerCase()) throw new Error('Prepared Solana message hash does not match the contract.');
  if (prepared.message.staticAccountKeys[0]?.toBase58() !== signing.fee_payer_address) throw new Error('Prepared Solana fee payer does not match the contract.');
  const signerIndex = prepared.message.staticAccountKeys.findIndex((key) => key.toBase58() === signing.user_signer_address);
  if (signerIndex < 0 || signerIndex >= prepared.message.header.numRequiredSignatures) throw new Error('The user wallet is not a required signer.');
  const platformIndex = prepared.message.staticAccountKeys.findIndex((key) => key.toBase58() === signing.fee_payer_address);
  const platformSignature = prepared.signatures[platformIndex];
  if (!platformSignature || platformSignature.every((byte) => byte === 0)) throw new Error('Platform fee-payer signature is missing.');
  report('solana_precheck_done', {duration_ms: monotonicNow() - precheckStarted, transaction_bytes: preparedBytes.length});

  const privyStarted = monotonicNow();
  report('privy_sign_start');
  let result: {signedTransaction: Uint8Array};
  try {
    result = await signTransaction({transaction: preparedBytes, wallet: wallet as never, options: {uiOptions: {showWalletUIs: false}}});
  } catch (error) {
    report('privy_sign_error', {duration_ms: monotonicNow() - privyStarted, signature_produced: false});
    throw error;
  }
  report('privy_sign_done', {duration_ms: monotonicNow() - privyStarted, response_bytes: result.signedTransaction.length, signature_produced: true});

  const postcheckStarted = monotonicNow();
  let serialized: Uint8Array;
  try {
    let signed: VersionedTransaction;
    if (result.signedTransaction.length === 64) {
      signed = VersionedTransaction.deserialize(preparedBytes);
      signed.signatures[signerIndex] = new Uint8Array(result.signedTransaction);
    } else signed = VersionedTransaction.deserialize(result.signedTransaction);
    if (!sameBytes(message, signed.message.serialize())) throw new Error('Wallet changed the prepared Solana message.');
    if (!sameBytes(platformSignature, signed.signatures[platformIndex]!)) throw new Error('Wallet changed the platform signature.');
    const userSignature = signed.signatures[signerIndex];
    if (!userSignature || userSignature.every((byte) => byte === 0)) throw new Error('Wallet did not fill the user signature slot.');
    serialized = signed.serialize();
    report('solana_postcheck_done', {duration_ms: monotonicNow() - postcheckStarted, signed_transaction_bytes: serialized.length});
  } catch (error) {
    report('solana_postcheck_error', {duration_ms: monotonicNow() - postcheckStarted, signature_produced: true});
    throw error;
  }
  const base64Started = monotonicNow();
  report('solana_base64_start');
  try {
    const encoded = encodeBase64(serialized);
    report('solana_base64_done', {duration_ms: monotonicNow() - base64Started, encoded_characters: encoded.length});
    return encoded;
  } catch (error) {
    report('solana_base64_error', {duration_ms: monotonicNow() - base64Started, signature_produced: true});
    throw error;
  }
}

export async function verifySolanaChainState(signing: SolanaSigning, rpcURL: string): Promise<void> {
  if (!rpcURL) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL is required to verify the prepared transaction.');
  const connection = new Connection(rpcURL, 'confirmed');
  const [height, ...tables] = await Promise.all([
    connection.getBlockHeight('confirmed'),
    ...signing.lookup_tables.map((table) => connection.getAddressLookupTable(new PublicKey(table.address), {commitment: 'confirmed'})),
  ]);
  if (BigInt(height) > BigInt(signing.last_valid_block_height)) throw new Error('Prepared Solana blockhash has expired.');
  for (let index = 0; index < signing.lookup_tables.length; index += 1) {
    const expected = signing.lookup_tables[index]!;
    const result = tables[index];
    if (!result?.value) throw new Error(`Address lookup table ${expected.address} is unavailable.`);
    const actualAddresses = result.value.state.addresses.map((address) => address.toBase58());
    if (actualAddresses.length !== expected.addresses.length || actualAddresses.some((address, item) => address !== expected.addresses[item])) {
      throw new Error(`Address lookup table ${expected.address} differs from the prepared revision.`);
    }
    if (BigInt(result.value.state.lastExtendedSlot) !== BigInt(expected.last_extended_slot) || BigInt(result.context.slot) < BigInt(expected.observed_slot)) {
      throw new Error(`Address lookup table ${expected.address} was observed at an incompatible slot.`);
    }
  }
}

/** Quote refresh cannot replace a platform-pre-signed transaction still valid on chain. */
export async function solanaRevisionExpired(signing: SolanaSigning, rpcURL: string): Promise<boolean> {
  if (!rpcURL) throw new Error('Solana RPC is required to check quote expiry.');
  const height = await new Connection(rpcURL,'confirmed').getBlockHeight('confirmed');
  return BigInt(height) > BigInt(signing.last_valid_block_height);
}

type EvmWallet = {address: string; getEthereumProvider: () => Promise<{request: (request: {method: string; params?: unknown[]}) => Promise<unknown>}>};
const CALIBUR_IMPLEMENTATION = '0x000000009b1d0af20d8c6d0a44e162d11f9b8f00';
const CALIBUR_MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const CALIBUR_SALT = `0x${CALIBUR_IMPLEMENTATION.slice(2).padStart(64, '0')}`;
const MAX_UINT256 = BigInt(2) ** BigInt(256) - BigInt(1);
const APPROVE_SELECTOR = '095ea7b3';
const PUSH_SELECTORS = new Set(['a9059cbb', '23b872dd']);
const NATIVE_ASSETS = new Set(['0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function equalAddress(left: unknown, right: string): boolean {
  return typeof left === 'string' && /^0x[0-9a-f]{40}$/i.test(left) && left.toLowerCase() === right.toLowerCase();
}
function decimalEquals(value: unknown, expected: string): boolean {
  try { return (typeof value === 'string' || typeof value === 'number') && BigInt(value) === BigInt(expected); } catch { return false; }
}
function fields(types: Record<string, unknown>, name: string, expected: readonly [string, string][]): boolean {
  const value = types[name];
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => {
    const field = object(item, `types.${name}[${index}]`);
    return field.name === expected[index]?.[0] && field.type === expected[index]?.[1];
  });
}
type CaliburCall = {to: string; value: bigint; data: string};
function decodeApprove(call: CaliburCall): {spender: string; amount: bigint} | null {
  const data = call.data.slice(2).toLowerCase();
  if (!data.startsWith(APPROVE_SELECTOR)) return null;
  if (data.length !== 8 + 64 + 64) throw new Error('ERC-20 approve calldata has trailing or missing bytes.');
  const addressWord = data.slice(8, 72);
  if (!/^0{24}[0-9a-f]{40}$/.test(addressWord)) throw new Error('ERC-20 approve spender is not canonically encoded.');
  return {spender: `0x${addressWord.slice(24)}`, amount: BigInt(`0x${data.slice(72)}`)};
}
function validateCalls(callsValue: unknown, intent: CreateIntent): void {
  if (!Array.isArray(callsValue) || callsValue.length < 1 || callsValue.length > 2) throw new Error('Calibur requires one spend call or approve plus spend.');
  const calls: CaliburCall[] = callsValue.map((item, index) => {
    const call = object(item, `calls[${index}]`);
    if (!equalAddress(call.to, String(call.to)) || typeof call.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(call.data) || typeof call.value !== 'string' || !/^\d+$/.test(call.value)) throw new Error(`Calibur call ${index} is malformed.`);
    const selector = call.data.slice(2, 10).toLowerCase();
    if (call.data.length > 2 && call.data.length < 10) throw new Error(`Calibur call ${index} does not contain a full selector.`);
    if (PUSH_SELECTORS.has(selector)) throw new Error('Calibur may not directly transfer or transferFrom user assets.');
    return {to: String(call.to).toLowerCase(), value: BigInt(call.value), data: call.data};
  });
  const firstApprove = decodeApprove(calls[0]!);
  const secondApprove = calls.length === 2 ? decodeApprove(calls[1]!) : null;
  if (secondApprove) throw new Error('Only the first Calibur call may be approve.');
  if (calls.length === 2 && !firstApprove) throw new Error('A two-call Calibur batch must be approve followed by spend.');
  if (calls.length === 1 && firstApprove) throw new Error('An approve-only Calibur batch does not execute a swap.');
  const nativeOrigin = NATIVE_ASSETS.has(intent.origin_asset.toLowerCase());
  const amountIn = BigInt(intent.amount_in_raw);
  const spend = calls[calls.length - 1]!;
  if (firstApprove) {
    if (nativeOrigin) throw new Error('A native-asset swap may not contain ERC-20 approve.');
    if (calls[0]!.to !== intent.origin_asset.toLowerCase()) throw new Error('Approve targets an asset other than the intended input asset.');
    if (calls[0]!.value !== BigInt(0)) throw new Error('ERC-20 approve may not transfer native value.');
    if (firstApprove.spender !== spend.to && firstApprove.spender !== PERMIT2) throw new Error('Approve grants allowance outside the current spend call.');
    if (firstApprove.amount !== amountIn && !(firstApprove.spender === PERMIT2 && firstApprove.amount === MAX_UINT256)) throw new Error('Approve allowance exceeds the intended amount.');
  }
  if (!nativeOrigin) {
    calls.forEach((call, index) => { if (call.to === intent.origin_asset.toLowerCase() && !(index === 0 && firstApprove)) throw new Error('A non-approve call targets the input token contract.'); });
    if (spend.value !== BigInt(0)) throw new Error('ERC-20 input may not also spend native value.');
  } else if (spend.value !== amountIn) throw new Error('Native spend value does not equal amount_in_raw.');
}

function validateCalibur(signing: EvmSigning, intent: CreateIntent): void {
  if (signing.kind !== SigningKind.EVM_CALIBUR) throw new Error('This client does not enable unverified EVM permit signing.');
  if (signing.chain !== intent.origin_chain) throw new Error('EVM signing chain differs from the immutable intent.');
  const match = /^eip155:(\d+)$/.exec(signing.chain);
  if (!match) throw new Error('EVM signing chain is not a CAIP eip155 chain.');
  const chainID = match[1]!;
  const typedRequests = signing.requests.filter((request) => request.method === EvmSigningMethod.ETH_SIGN_TYPED_DATA_V4);
  const authRequests = signing.requests.filter((request) => request.method === EvmSigningMethod.EIP7702_AUTHORIZATION);
  if (typedRequests.length !== 1 || typedRequests[0]?.request_id !== 'calibur_batch' || !typedRequests[0].typed_data || authRequests.length > 1 || signing.requests.length !== typedRequests.length + authRequests.length) {
    throw new Error('Calibur signing requests do not match the supported request set.');
  }
  const typed = typedRequests[0].typed_data;
  const domain = typed.domain; const message = typed.message; const batched = object(message.batchedCall, 'message.batchedCall');
  if (typed.primary_type !== 'SignedBatchedCall' || domain.name !== 'Calibur' || domain.version !== '1.0.0' ||
    !decimalEquals(domain.chainId, chainID) || !equalAddress(domain.verifyingContract, signing.signer_address) ||
    typeof domain.salt !== 'string' || domain.salt.toLowerCase() !== CALIBUR_SALT ||
    !decimalEquals(message.nonce, signing.nonce) || message.keyHash !== ZERO_BYTES32 ||
    !equalAddress(message.executor, CALIBUR_MULTICALL) || batched.revertOnFailure !== true) {
    throw new Error('Calibur typed-data domain or execution envelope is outside the client allowlist.');
  }
  const deadline = Date.parse(signing.deadline);
  if (!Number.isFinite(deadline) || deadline % 1000 !== 0 || !decimalEquals(message.deadline, String(deadline / 1000))) throw new Error('Calibur deadline does not match the signed message.');
  validateCalls(batched.calls, intent);
  if (!fields(typed.types, 'EIP712Domain', [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']]) ||
    !fields(typed.types, 'SignedBatchedCall', [['batchedCall', 'BatchedCall'], ['nonce', 'uint256'], ['keyHash', 'bytes32'], ['executor', 'address'], ['deadline', 'uint256']]) ||
    !fields(typed.types, 'BatchedCall', [['calls', 'Call[]'], ['revertOnFailure', 'bool']]) ||
    !fields(typed.types, 'Call', [['to', 'address'], ['value', 'uint256'], ['data', 'bytes']])) throw new Error('Calibur typed-data schema differs from the audited client schema.');
  if (authRequests.length === 1) {
    const request = authRequests[0]!;
    if (request.request_id !== 'authorization_7702' || !request.authorization || request.typed_data !== null ||
      !decimalEquals(request.authorization.chain_id, chainID) || !equalAddress(request.authorization.address, CALIBUR_IMPLEMENTATION) || !/^\d+$/.test(request.authorization.nonce)) {
      throw new Error('EIP-7702 authorization is outside the Calibur allowlist.');
    }
  }
}

export async function signEvmRevision(signing: EvmSigning, wallet: EvmWallet, intent: CreateIntent, reportTiming?: SigningTimingReporter): Promise<{request_id: string; signature: string}[]> {
  const report = (stage: Parameters<SigningTimingReporter>[0], details?: Parameters<SigningTimingReporter>[1]) => {
    try { reportTiming?.(stage, details); } catch { /* Diagnostics never interrupt signing. */ }
  };
  const precheckStarted = monotonicNow();
  report('evm_precheck_start');
  try {
    validateCalibur(signing, intent);
    if (wallet.address.toLowerCase() !== signing.signer_address.toLowerCase()) throw new Error('The loaded EVM signer does not match the prepared revision.');
    report('evm_precheck_done', {duration_ms: monotonicNow() - precheckStarted, request_count: signing.requests.length});
  } catch (error) {
    report('evm_precheck_error', {duration_ms: monotonicNow() - precheckStarted, signature_produced: false});
    throw error;
  }
  const providerStarted = monotonicNow();
  report('evm_provider_start');
  let provider: Awaited<ReturnType<EvmWallet['getEthereumProvider']>>;
  try {
    provider = await wallet.getEthereumProvider();
    report('evm_provider_done', {duration_ms: monotonicNow() - providerStarted});
  } catch (error) {
    report('evm_provider_error', {duration_ms: monotonicNow() - providerStarted, signature_produced: false});
    throw error;
  }
  const output: {request_id: string; signature: string}[] = [];
  const seen = new Set<string>();
  for (const request of signing.requests) {
    if (seen.has(request.request_id)) throw new Error(`Duplicate signing request ${request.request_id}.`);
    seen.add(request.request_id);
    if (request.method === EvmSigningMethod.ETH_SIGN_TYPED_DATA_V4 && request.typed_data) {
      const typed = {domain: request.typed_data.domain, types: request.typed_data.types, primaryType: request.typed_data.primary_type, message: request.typed_data.message};
      const digest = hashTypedData(typed as Parameters<typeof hashTypedData>[0]);
      if (digest.toLowerCase() !== signing.execution_digest.toLowerCase()) throw new Error('Typed-data digest does not match execution_digest.');
      const privyStarted = monotonicNow();
      report('privy_sign_start', {request_id: request.request_id, method: request.method});
      let raw: unknown;
      try {
        raw = await provider.request({method: 'eth_signTypedData_v4', params: [signing.signer_address, JSON.stringify(typed)]});
        report('privy_sign_done', {duration_ms: monotonicNow() - privyStarted, request_id: request.request_id, method: request.method, signature_produced: true});
      } catch (error) {
        report('privy_sign_error', {duration_ms: monotonicNow() - privyStarted, request_id: request.request_id, method: request.method, signature_produced: false});
        throw error;
      }
      const postcheckStarted = monotonicNow();
      if (typeof raw !== 'string') throw new Error('Wallet returned an invalid typed-data signature.');
      try {
        const signature = normalizeSignature(raw);
        const recovered = await recoverTypedDataAddress({...typed, signature} as Parameters<typeof recoverTypedDataAddress>[0]);
        if (recovered.toLowerCase() !== signing.signer_address.toLowerCase()) throw new Error('Typed-data signature recovered the wrong wallet.');
        output.push({request_id: request.request_id, signature});
        report('evm_postcheck_done', {duration_ms: monotonicNow() - postcheckStarted, request_id: request.request_id, method: request.method});
      } catch (error) {
        report('evm_postcheck_error', {duration_ms: monotonicNow() - postcheckStarted, request_id: request.request_id, method: request.method, signature_produced: true});
        throw error;
      }
      continue;
    }
    if (request.method === EvmSigningMethod.EIP7702_AUTHORIZATION && request.authorization) {
      const digest = hashAuthorization({address: request.authorization.address as Address, chainId: BigInt(request.authorization.chain_id), nonce: BigInt(request.authorization.nonce)} as never);
      const privyStarted = monotonicNow();
      report('privy_sign_start', {request_id: request.request_id, method: request.method});
      let raw: unknown;
      try {
        raw = await provider.request({method: 'secp256k1_sign', params: [digest]});
        report('privy_sign_done', {duration_ms: monotonicNow() - privyStarted, request_id: request.request_id, method: request.method, signature_produced: true});
      } catch (error) {
        report('privy_sign_error', {duration_ms: monotonicNow() - privyStarted, request_id: request.request_id, method: request.method, signature_produced: false});
        throw error;
      }
      const postcheckStarted = monotonicNow();
      if (typeof raw !== 'string') throw new Error('Wallet returned an invalid authorization signature.');
      try {
        const signature = normalizeSignature(raw);
        const recovered = await recoverAddress({hash: digest, signature});
        if (recovered.toLowerCase() !== signing.signer_address.toLowerCase()) throw new Error('Authorization signature recovered the wrong wallet.');
        output.push({request_id: request.request_id, signature});
        report('evm_postcheck_done', {duration_ms: monotonicNow() - postcheckStarted, request_id: request.request_id, method: request.method});
      } catch (error) {
        report('evm_postcheck_error', {duration_ms: monotonicNow() - postcheckStarted, request_id: request.request_id, method: request.method, signature_produced: true});
        throw error;
      }
      continue;
    }
    throw new Error(`Unsupported or malformed EVM signing request ${request.request_id}.`);
  }
  if (output.length !== signing.requests.length) throw new Error('Not every EVM signing request was completed.');
  return output;
}
