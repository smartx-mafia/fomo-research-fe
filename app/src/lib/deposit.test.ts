import {describe, expect, it, vi} from 'vitest';

import {expiryHasMargin, newDepositIdempotencyKey, receiptEmailForAuth, validFiatAmount} from './deposit';
import {signFiatWalletProof} from './deposit-signing';
import {fromBase64} from './trade-signature';

describe('deposit intent helpers', () => {
  it('validates fiat amounts without floating-point conversion', () => {
    for (const value of ['0.01', '1', '100.00', '999999999999.99']) expect(validFiatAmount(value)).toBe(true);
    for (const value of ['0', '0.00', '00.01', '-1', '1.001', '1000000000000', '1e2', '']) expect(validFiatAmount(value)).toBe(false);
  });

  it('selects only the verified email for the actual login method', () => {
    const accounts = [
      {type: 'email', address: 'Email@Example.com'},
      {type: 'google_oauth', email: 'google@example.com'},
    ];
    expect(receiptEmailForAuth(accounts, 'AUTH_METHOD_EMAIL')).toBe('email@example.com');
    expect(receiptEmailForAuth(accounts, 'AUTH_METHOD_GOOGLE')).toBe('google@example.com');
    expect(receiptEmailForAuth(accounts)).toBeUndefined();
  });

  it('creates a bounded per-intent idempotency key', () => {
    const key = newDepositIdempotencyKey();
    expect(key).toMatch(/^deposit-[0-9a-f-]{36}$/);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it('requires a valid prepare expiry with five seconds of margin', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T00:00:00Z'));
    expect(expiryHasMargin('2026-09-07T00:00:05Z')).toBe(true);
    expect(expiryHasMargin('2026-09-07T00:00:04.999Z')).toBe(false);
    expect(expiryHasMargin('invalid')).toBe(false);
    vi.useRealTimers();
  });

  it('signs the exact wallet-proof UTF-8 bytes without trimming or rebuilding', async () => {
    const message = 'line one\n  line two  ';
    let signed: Uint8Array | undefined;
    const signature = await signFiatWalletProof(async ({message: bytes}) => {
      signed = bytes;
      return {signature: new Uint8Array(64).fill(7)};
    }, {address: 'solana-wallet'}, message);
    expect(new TextDecoder().decode(signed)).toBe(message);
    expect(fromBase64(signature)).toHaveLength(64);
  });

  it('rejects an all-zero Solana wallet proof signature', async () => {
    await expect(signFiatWalletProof(async () => ({signature: new Uint8Array(64)}), {address: 'wallet'}, 'challenge')).rejects.toThrow(/non-zero 64-byte/);
  });
});
