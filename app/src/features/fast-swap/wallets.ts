export type FastSwapWallet = {id: string; address: string; chainType: 'ethereum' | 'solana'; walletIndex: number | null};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Mirrors the backend's deterministic embedded-wallet choice: the smallest explicit wallet index wins. */
export function fastSwapWallets(linkedAccounts: readonly unknown[]): FastSwapWallet[] {
  const output: FastSwapWallet[] = [];
  for (const value of linkedAccounts) {
    const item = record(value);
    if (!item || item.type !== 'wallet' || item.walletClientType !== 'privy' ||
      !['ethereum', 'solana'].includes(String(item.chainType)) || typeof item.id !== 'string' || !item.id ||
      typeof item.address !== 'string' || !item.address) continue;
    output.push({
      id: item.id,
      address: item.address,
      chainType: item.chainType as FastSwapWallet['chainType'],
      walletIndex: typeof item.walletIndex === 'number' && Number.isSafeInteger(item.walletIndex) && item.walletIndex >= 0 ? item.walletIndex : null,
    });
  }
  return output.toSorted((a, b) => {
    if (a.chainType !== b.chainType) return a.chainType.localeCompare(b.chainType);
    return (a.walletIndex ?? Number.MAX_SAFE_INTEGER) - (b.walletIndex ?? Number.MAX_SAFE_INTEGER) || a.address.localeCompare(b.address);
  });
}

export function chainType(chain: string): FastSwapWallet['chainType'] | undefined {
  if (chain === 'solana:mainnet') return 'solana';
  if (/^eip155:\d+$/.test(chain)) return 'ethereum';
  return undefined;
}

export function walletForChain(wallets: readonly FastSwapWallet[], chain: string): FastSwapWallet | undefined {
  const type = chainType(chain);
  return type ? wallets.find((wallet) => wallet.chainType === type) : undefined;
}

export function signerByAddress<T extends {address: string}>(wallets: readonly T[], address: string, evm: boolean): T | undefined {
  const normalize = (value: string) => evm ? value.toLowerCase() : value;
  return wallets.find((wallet) => normalize(wallet.address) === normalize(address));
}
