import {createHash} from 'node:crypto';
import {Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction} from '@solana/web3.js';
import {privateKeyToAccount} from 'viem/accounts';
import {hashTypedData, type Hex} from 'viem';
import {describe, expect, it} from 'vitest';

import {signEvmRevision, signSolanaRevision} from './signing';
import type {CreateIntent, EvmSigning, SolanaSigning} from './contract';

describe('fast swap signing', () => {
  it('keeps the platform signature and attaches a bare Solana user signature', async () => {
    const platform = Keypair.generate(); const user = Keypair.generate(); const recipient = Keypair.generate();
    const message = new TransactionMessage({payerKey: platform.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({fromPubkey: user.publicKey, toPubkey: recipient.publicKey, lamports: 1})]}).compileToV0Message();
    const prepared = new VersionedTransaction(message); prepared.sign([platform]);
    const platformSignature = new Uint8Array(prepared.signatures[0]!);
    const signing: SolanaSigning = {kind: 1, transaction_base64: Buffer.from(prepared.serialize()).toString('base64'), message_hash: createHash('sha256').update(message.serialize()).digest('hex'), fee_payer_address: platform.publicKey.toBase58(), user_signer_address: user.publicKey.toBase58(), blockhash: message.recentBlockhash, last_valid_block_height: '999999999', lookup_tables: [], execution_guard: {program_id: '', group_id: ''}, broadcast: {mode: 1, endpoint_id: 'gateway', backup_endpoint_id: null}};
    const stages: string[] = [];
    const durations: number[] = [];
    const result = await signSolanaRevision(
      signing,
      {address: user.publicKey.toBase58()},
      async ({transaction}) => { const tx = VersionedTransaction.deserialize(transaction); tx.sign([user]); return {signedTransaction: tx.signatures[1]!}; },
      (stage, details) => { stages.push(stage); if (typeof details?.duration_ms === 'number') durations.push(details.duration_ms); },
    );
    const signed = VersionedTransaction.deserialize(Buffer.from(result, 'base64'));
    expect([...signed.signatures[0]!]).toEqual([...platformSignature]);
    expect(signed.signatures[1]!.some((byte) => byte !== 0)).toBe(true);
    expect(stages).toEqual(['solana_precheck_start', 'solana_precheck_done', 'privy_sign_start', 'privy_sign_done', 'solana_postcheck_done', 'solana_base64_start', 'solana_base64_done']);
    expect(durations).toHaveLength(4);
    expect(durations.every((duration) => duration >= 0)).toBe(true);
    await expect(signSolanaRevision(
      signing,
      {address: user.publicKey.toBase58()},
      async ({transaction}) => { const tx = VersionedTransaction.deserialize(transaction); tx.sign([user]); return {signedTransaction: tx.signatures[1]!}; },
      () => { throw new Error('diagnostics unavailable'); },
    )).resolves.toMatch(/^[A-Za-z0-9+/]+=*$/);
    const rejected: string[] = [];
    await expect(signSolanaRevision(signing, {address:user.publicKey.toBase58()}, async () => { throw new Error('wallet rejected'); }, (stage) => rejected.push(stage))).rejects.toThrow('wallet rejected');
    expect(rejected).toContain('privy_sign_error');
    expect(rejected).not.toContain('solana_postcheck_done');
    const timedOut: {stage:string; signature?:boolean}[] = [];
    await expect(signSolanaRevision(signing, {address:user.publicKey.toBase58()}, async () => { throw new DOMException('timed out','TimeoutError'); }, (stage,details) => timedOut.push({stage,signature:typeof details?.signature_produced === 'boolean' ? details.signature_produced : undefined}))).rejects.toMatchObject({name:'TimeoutError'});
    expect(timedOut).toContainEqual({stage:'privy_sign_error',signature:false});
  });

  it('signs only typed data whose hash matches execution_digest', async () => {
    const account = privateKeyToAccount('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const deadline = '2026-09-16T00:01:00Z';
    const salt = `0x${'000000009b1d0af20d8c6d0a44e162d11f9b8f00'.padStart(64, '0')}` as Hex;
    const domain = {name: 'Calibur', version: '1.0.0', chainId: BigInt(8453), verifyingContract: account.address, salt} as const;
    const types = {EIP712Domain: [{name: 'name', type: 'string'}, {name: 'version', type: 'string'}, {name: 'chainId', type: 'uint256'}, {name: 'verifyingContract', type: 'address'}, {name: 'salt', type: 'bytes32'}], SignedBatchedCall: [{name: 'batchedCall', type: 'BatchedCall'}, {name: 'nonce', type: 'uint256'}, {name: 'keyHash', type: 'bytes32'}, {name: 'executor', type: 'address'}, {name: 'deadline', type: 'uint256'}], BatchedCall: [{name: 'calls', type: 'Call[]'}, {name: 'revertOnFailure', type: 'bool'}], Call: [{name: 'to', type: 'address'}, {name: 'value', type: 'uint256'}, {name: 'data', type: 'bytes'}]} as const;
    const message = {batchedCall: {calls: [{to: '0x0000000000000000000000000000000000000002', value: BigInt(0), data: '0xdeadbeef'}], revertOnFailure: true}, nonce: BigInt(1), keyHash: `0x${'00'.repeat(32)}` as const, executor: '0xca11bde05977b3631167028862be2a173976ca11', deadline: BigInt(Date.parse(deadline) / 1000)} as const;
    const typed = {domain, types, primaryType: 'SignedBatchedCall', message} as const;
    const signing: EvmSigning = {kind: 2, chain: 'eip155:8453', signer_address: account.address, execution_digest: hashTypedData(typed), nonce: '1', deadline, requests: [{request_id: 'calibur_batch', method: 1, typed_data: {domain: {...domain, chainId: 8453}, types: {...types}, primary_type: typed.primaryType, message: {batchedCall: {calls: [{to: message.batchedCall.calls[0].to, value: '0', data: '0xdeadbeef'}], revertOnFailure: true}, nonce: '1', keyHash: message.keyHash, executor: message.executor, deadline: String(message.deadline)}}, authorization: null}]};
    const intent: CreateIntent = {client_intent_id: 'intent', origin_chain: 'eip155:8453', destination_chain: 'solana:mainnet', origin_asset: '0x0000000000000000000000000000000000000003', destination_asset: 'mint', amount_in_raw: '1', slippage_bps: 300, side: 2, source_wallet_id: 'evm', destination_wallet_id: 'sol', fee_policy: 1};
    const signatures = await signEvmRevision(signing, {address: account.address, getEthereumProvider: async () => ({request: async () => account.signTypedData(typed)})}, intent);
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    await expect(signEvmRevision({...signing, execution_digest: `0x${'00'.repeat(32)}`}, {address: account.address, getEthereumProvider: async () => ({request: async () => account.signTypedData(typed)})}, intent)).rejects.toThrow(/digest/);
    const maliciousTyped = {...signing.requests[0]!.typed_data!, domain: {...signing.requests[0]!.typed_data!.domain, name: 'OtherApp'}};
    const maliciousDigest = hashTypedData({domain: maliciousTyped.domain, types: maliciousTyped.types, primaryType: maliciousTyped.primary_type, message: maliciousTyped.message} as Parameters<typeof hashTypedData>[0]);
    await expect(signEvmRevision(
      {...signing, execution_digest: maliciousDigest, requests: [{...signing.requests[0]!, typed_data: maliciousTyped}]},
      {address: account.address, getEthereumProvider: async () => ({request: async () => '0x'})},
      intent,
    )).rejects.toThrow(/allowlist/);
    const dangerousTyped = {...signing.requests[0]!.typed_data!, message: {...signing.requests[0]!.typed_data!.message, batchedCall: {calls: [{to: intent.origin_asset, value: '0', data: '0xa9059cbb'}], revertOnFailure: true}}};
    const dangerousDigest = hashTypedData({domain: dangerousTyped.domain, types: dangerousTyped.types, primaryType: dangerousTyped.primary_type, message: dangerousTyped.message} as Parameters<typeof hashTypedData>[0]);
    await expect(signEvmRevision(
      {...signing, execution_digest: dangerousDigest, requests: [{...signing.requests[0]!, typed_data: dangerousTyped}]},
      {address: account.address, getEthereumProvider: async () => ({request: async () => '0x'})},
      intent,
    )).rejects.toThrow(/transfer/);
  });
});
