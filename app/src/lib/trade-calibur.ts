import {recoverAddress, type Hex} from 'viem';
import {hashAuthorization} from 'viem/utils';

import {fromBase64, toBase64} from './trade-signature';

export type CaliburAuthorization = {
  digest: string;
  chain_id: number;
  address: string;
  nonce: number;
};

export type CaliburSignData = {
  batch_digest: string;
  authorization?: CaliburAuthorization;
};

function toHex(value: Uint8Array): Hex {
  return `0x${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function parseCaliburSignData(value: Uint8Array): CaliburSignData {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(value));
  } catch (error) {
    throw new Error(`Calibur sign envelope is not valid JSON: ${String(error)}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('Calibur sign envelope is not an object.');
  const row = raw as Record<string, unknown>;
  if (typeof row.batch_digest !== 'string' || !row.batch_digest) throw new Error('Calibur batch_digest is missing.');
  const result: CaliburSignData = {batch_digest: row.batch_digest};
  if (row.authorization !== undefined && row.authorization !== null) {
    if (typeof row.authorization !== 'object') throw new Error('Calibur authorization is invalid.');
    const auth = row.authorization as Record<string, unknown>;
    if (
      typeof auth.digest !== 'string' || !auth.digest ||
      typeof auth.address !== 'string' || !auth.address ||
      typeof auth.chain_id !== 'number' || !Number.isSafeInteger(auth.chain_id) ||
      typeof auth.nonce !== 'number' || !Number.isSafeInteger(auth.nonce)
    ) {
      throw new Error('Calibur authorization fields are invalid.');
    }
    result.authorization = {
      digest: auth.digest,
      address: auth.address,
      chain_id: auth.chain_id,
      nonce: auth.nonce,
    };
  }
  return result;
}

export function digestFromBase64(value: string, label: string): Uint8Array {
  const bytes = fromBase64(value);
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes, received ${bytes.length}.`);
  return bytes;
}

export function checkAuthorizationDigest(auth: CaliburAuthorization) {
  const expected = hashAuthorization({
    address: auth.address.toLowerCase() as Hex,
    chainId: auth.chain_id,
    nonce: auth.nonce,
  });
  const actual = toHex(digestFromBase64(auth.digest, 'Authorization digest'));
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error('Calibur authorization digest does not match its chain/address/nonce fields.');
  }
}

export async function assertRecoveredSigner(digest: Uint8Array, signature: Uint8Array, walletAddress: string) {
  const recovered = await recoverAddress({hash: toHex(digest), signature: toHex(signature)});
  if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(`Signature recovered ${recovered}, expected ${walletAddress}.`);
  }
}

export function encodeCaliburSignatures(batch: Uint8Array, authorization?: Uint8Array): string {
  if (batch.length !== 65) throw new Error('Calibur batch signature must be 65 bytes.');
  if (authorization && authorization.length !== 65) throw new Error('Calibur authorization signature must be 65 bytes.');
  const envelope = {
    batch_signature: toBase64(batch),
    ...(authorization ? {authorization_signature: toBase64(authorization)} : {}),
  };
  return toBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}
