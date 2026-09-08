import {VersionedTransaction} from '@solana/web3.js';

export function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromHex(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Wallet returned invalid hex.');
  return Uint8Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function toHex(value: Uint8Array): `0x${string}` {
  return `0x${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function extractSolanaSignature(signed: Uint8Array, walletAddress: string): Uint8Array {
  if (signed.length === 64) throw new Error('Wallet returned a bare signature instead of the signed transaction.');
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(signed);
  } catch (error) {
    throw new Error(`Signed Solana transaction could not be decoded: ${String(error)}`);
  }
  const index = transaction.message.staticAccountKeys.findIndex((key) => key.toBase58() === walletAddress);
  if (index < 0) throw new Error(`Server-selected wallet ${walletAddress} is not a signer in this transaction.`);
  const signature = transaction.signatures[index];
  if (!signature || signature.length !== 64 || signature.every((byte) => byte === 0)) {
    throw new Error(`The selected wallet ${walletAddress} did not sign its transaction slot.`);
  }
  return new Uint8Array(signature);
}

export async function signEvmDigest(
  wallet: {getEthereumProvider: () => Promise<{request: (request: {method: string; params?: unknown[]}) => Promise<unknown>}>},
  digest: Uint8Array,
): Promise<Uint8Array> {
  if (digest.length !== 32) throw new Error(`EVM digest must be 32 bytes, received ${digest.length}.`);
  const provider = await wallet.getEthereumProvider();
  const result = await provider.request({method: 'secp256k1_sign', params: [toHex(digest)]});
  if (typeof result !== 'string') throw new Error('Wallet returned a non-hex EVM signature.');
  const signature = fromHex(result);
  if (signature.length === 64) {
    // Privy may return EIP-2098 r || yParityAndS. Expand it to r || s || v.
    const expanded = new Uint8Array(65);
    expanded.set(signature);
    const parity = (expanded[32] & 0x80) >>> 7;
    expanded[32] &= 0x7f;
    expanded[64] = 27 + parity;
    return expanded;
  }
  if (signature.length !== 65 || ![0, 1, 27, 28].includes(signature[64])) {
    throw new Error(`EVM signature must be 64-byte EIP-2098 or 65-byte recoverable, received ${signature.length}.`);
  }
  return signature;
}
