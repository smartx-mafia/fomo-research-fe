export type EmbeddedWalletAddress = {
  address: string;
  chainType: 'ethereum' | 'solana';
  walletIndex?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

/** Extract only Privy embedded wallets; external MetaMask/Phantom accounts are intentionally excluded. */
export function embeddedWalletAddresses(linkedAccounts: readonly unknown[]): EmbeddedWalletAddress[] {
  const deduped = new Map<string, EmbeddedWalletAddress>();
  for (const value of linkedAccounts) {
    const account = record(value);
    if (
      !account || account.type !== 'wallet' ||
      (account.walletClientType !== 'privy' && account.walletClientType !== 'privy-v2') ||
      (account.chainType !== 'ethereum' && account.chainType !== 'solana') ||
      typeof account.address !== 'string' || account.address === ''
    ) continue;
    const chainType = account.chainType;
    const walletIndex = typeof account.walletIndex === 'number' &&
      Number.isSafeInteger(account.walletIndex) && account.walletIndex >= 0
      ? account.walletIndex : undefined;
    const identity = chainType === 'ethereum' ? account.address.toLowerCase() : account.address;
    const key = `${chainType}:${identity}`;
    const existing = deduped.get(key);
    if (!existing || (existing.walletIndex === undefined && walletIndex !== undefined)) {
      deduped.set(key, {address: account.address, chainType, walletIndex});
    }
  }
  return [...deduped.values()].sort((a, b) => {
    if (a.chainType !== b.chainType) return a.chainType === 'ethereum' ? -1 : 1;
    const ai = a.walletIndex ?? Number.MAX_SAFE_INTEGER;
    const bi = b.walletIndex ?? Number.MAX_SAFE_INTEGER;
    return ai - bi || a.address.localeCompare(b.address);
  });
}

export function signerHasAddress(addresses: readonly string[], wallet: EmbeddedWalletAddress): boolean {
  return wallet.chainType === 'ethereum'
    ? addresses.some((address) => address.toLowerCase() === wallet.address.toLowerCase())
    : addresses.includes(wallet.address);
}
