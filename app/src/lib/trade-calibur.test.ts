import {hashAuthorization} from 'viem/utils';
import {privateKeyToAccount, sign} from 'viem/accounts';
import {describe, expect, it} from 'vitest';

import {
  assertRecoveredSigner,
  checkAuthorizationDigest,
  digestFromBase64,
  encodeCaliburSignatures,
  parseCaliburSignData,
} from './trade-calibur';
import {fromBase64, toBase64} from './trade-signature';

const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const WALLET = privateKeyToAccount(PRIVATE_KEY).address;
const CALIBUR = '0x000000009b1d0af20d8c6d0a44e162d11f9b8f00';

function hexBytes(value: `0x${string}`) {
  return Uint8Array.from({length: (value.length - 2) / 2}, (_, index) =>
    Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16),
  );
}

describe('Calibur signing envelope', () => {
  it('keeps authorization absent when delegation is already installed', () => {
    const digest = toBase64(new Uint8Array(32).fill(1));
    const parsed = parseCaliburSignData(new TextEncoder().encode(JSON.stringify({batch_digest: digest})));
    expect(parsed).toEqual({batch_digest: digest});
  });

  it('rejects invalid JSON, missing digest, and non-32-byte digests', () => {
    expect(() => parseCaliburSignData(new TextEncoder().encode('not-json'))).toThrow(/not valid JSON/);
    expect(() => parseCaliburSignData(new TextEncoder().encode('{}'))).toThrow(/batch_digest/);
    expect(() => digestFromBase64(toBase64(new Uint8Array(31)), 'Batch digest')).toThrow(/31/);
  });

  it('cross-checks the authorization digest against chain, address, and nonce', () => {
    const expected = hashAuthorization({chainId: 56, address: CALIBUR, nonce: 7});
    const authorization = {digest: toBase64(hexBytes(expected)), chain_id: 56, address: CALIBUR, nonce: 7};
    expect(() => checkAuthorizationDigest(authorization)).not.toThrow();
    expect(() => checkAuthorizationDigest({...authorization, nonce: 8})).toThrow(/does not match/);
  });

  it('recovers and verifies the wallet that signed the exact digest', async () => {
    const digest = `0x${'ab'.repeat(32)}` as const;
    const signature = await sign({hash: digest, privateKey: PRIVATE_KEY, to: 'hex'});
    await expect(assertRecoveredSigner(hexBytes(digest), hexBytes(signature), WALLET)).resolves.toBeUndefined();
    await expect(assertRecoveredSigner(hexBytes(digest), hexBytes(signature), CALIBUR)).rejects.toThrow(/expected/);
  });

  it('encodes the exact optional signature fields expected by the backend', () => {
    const batch = new Uint8Array(65).fill(2);
    const auth = new Uint8Array(65).fill(3);
    const withoutAuth = JSON.parse(new TextDecoder().decode(fromBase64(encodeCaliburSignatures(batch))));
    expect(withoutAuth).toEqual({batch_signature: toBase64(batch)});
    const withAuth = JSON.parse(new TextDecoder().decode(fromBase64(encodeCaliburSignatures(batch, auth))));
    expect(withAuth).toEqual({batch_signature: toBase64(batch), authorization_signature: toBase64(auth)});
  });
});
