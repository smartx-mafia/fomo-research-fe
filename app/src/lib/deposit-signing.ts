import {
  assertRecoveredSigner,
  checkAuthorizationDigest,
  digestFromBase64,
  encodeCaliburSignatures,
  parseCaliburSignData,
} from './trade-calibur';
import {fromBase64, signEvmDigest, toBase64} from './trade-signature';

type EvmSigner = Parameters<typeof signEvmDigest>[0];

export async function signFiatWalletProof(
  sign: (input: {message: Uint8Array; wallet: {address: string}}) => Promise<{signature: Uint8Array}>,
  wallet: {address: string},
  message: string,
): Promise<string> {
  // TextEncoder preserves whitespace/newlines; never trim or reconstruct the provider challenge.
  const result = await sign({message: new TextEncoder().encode(message), wallet});
  if (result.signature.length !== 64 || result.signature.every((byte) => byte === 0)) throw new Error(`Solana wallet proof must be a non-zero 64-byte signature, received ${result.signature.length} bytes.`);
  return toBase64(result.signature);
}

export async function signDepositSweepCalibur(
  wallet: EvmSigner & {address: string},
  signDataBase64: string,
  expectedAddress: string,
): Promise<string> {
  if (wallet.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`Prepared sweep requires ${expectedAddress}, but selected wallet is ${wallet.address}.`);
  }
  const envelope = parseCaliburSignData(fromBase64(signDataBase64));
  const batchDigest = digestFromBase64(envelope.batch_digest, 'Calibur batch digest');
  const batchSignature = await signEvmDigest(wallet, batchDigest);
  await assertRecoveredSigner(batchDigest, batchSignature, expectedAddress);
  let authorizationSignature: Uint8Array | undefined;
  if (envelope.authorization) {
    checkAuthorizationDigest(envelope.authorization);
    const digest = digestFromBase64(envelope.authorization.digest, 'Calibur authorization digest');
    authorizationSignature = await signEvmDigest(wallet, digest);
    await assertRecoveredSigner(digest, authorizationSignature, expectedAddress);
  }
  return encodeCaliburSignatures(batchSignature, authorizationSignature);
}
