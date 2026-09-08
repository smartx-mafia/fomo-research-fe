import {PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} from '@solana/web3.js';
import {describe, expect, it} from 'vitest';

import {extractSolanaSignature, fromBase64, signEvmDigest, toBase64} from './trade-signature';

const SPONSOR = new PublicKey('SysvarC1ock11111111111111111111111111111111');
const USER = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const OTHER = new PublicKey('So11111111111111111111111111111111111111112');
const PROGRAM = new PublicKey('11111111111111111111111111111111');
const USER_SIGNATURE = new Uint8Array(64).fill(7);

function sponsoredTransaction() {
  const message = new TransactionMessage({
    payerKey: SPONSOR,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [new TransactionInstruction({
      programId: PROGRAM,
      keys: [{pubkey: USER, isSigner: true, isWritable: false}],
      data: Buffer.alloc(0),
    })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function signedWire() {
  const transaction = sponsoredTransaction();
  const userSlot = transaction.message.staticAccountKeys.findIndex((key) => key.equals(USER));
  transaction.signatures[userSlot] = USER_SIGNATURE;
  return transaction.serialize();
}

describe('extractSolanaSignature', () => {
  it('extracts the server-selected user slot rather than the empty sponsor slot', () => {
    expect([...extractSolanaSignature(signedWire(), USER.toBase58())]).toEqual([...USER_SIGNATURE]);
  });

  it('rejects an all-zero signature slot', () => {
    expect(() => extractSolanaSignature(signedWire(), SPONSOR.toBase58())).toThrow(/did not sign/);
  });

  it('rejects a wallet that is not a signer in the transaction', () => {
    expect(() => extractSolanaSignature(signedWire(), OTHER.toBase58())).toThrow(/is not a signer/);
  });

  it('rejects a bare 64-byte signature where a signed transaction is required', () => {
    expect(() => extractSolanaSignature(new Uint8Array(64), USER.toBase58())).toThrow(/bare signature/);
  });
});

describe('base64 helpers', () => {
  it('round trips arbitrary binary data without changing bytes', () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

describe('Privy EVM signature shapes', () => {
  it('expands a 64-byte EIP-2098 signature to recoverable r-s-v', async () => {
    const compact = new Uint8Array(64);
    compact[0] = 1;
    compact[32] = 0x80 | 2;
    const wallet = {getEthereumProvider: async () => ({request: async () => `0x${[...compact].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`})};
    const signature = await signEvmDigest(wallet, new Uint8Array(32));
    expect(signature).toHaveLength(65);
    expect(signature[32]).toBe(2);
    expect(signature[64]).toBe(28);
  });
});
