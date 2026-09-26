export function isExternalSubjectId(value: unknown): value is string {
  return typeof value === 'string' && /^subject:[1-9][0-9]*$/.test(value);
}

export type SmartMoneyIdentityRoute =
  | {status: 'pending'}
  | {status: 'subject'; subjectId: string}
  | {status: 'wallet'; namespace: 'evm' | 'solana'; walletAddress: string}
  | {status: 'legacy'; chain: string; address: string}
  | {status: 'invalid'};

export function parseSmartMoneyIdentityRoute(pathname: string, query: URLSearchParams): SmartMoneyIdentityRoute {
  const invalid = {status: 'invalid'} as const;
  const keys = ['subject_id', 'namespace', 'wallet_address', 'chain', 'address'];
  if (keys.some((key) => query.getAll(key).length > 1)) return invalid;

  const segments = pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (segments[0] !== 'smart-money' || ![1, 3].includes(segments.length)) return invalid;
  let pathWallet: {chain: string; address: string} | undefined;
  if (segments.length === 3) {
    try {
      pathWallet = {chain: decodeURIComponent(segments[1]), address: decodeURIComponent(segments[2])};
    } catch { return invalid; }
    if (!pathWallet.chain || !pathWallet.address) return invalid;
  }
  const hasSubject = query.has('subject_id');
  const hasWallet = query.has('namespace') || query.has('wallet_address');
  const hasLegacy = query.has('chain') || query.has('address') || Boolean(pathWallet);
  if (Number(hasSubject) + Number(hasWallet) + Number(hasLegacy) !== 1) return invalid;
  if (hasSubject) {
    const subjectId = query.get('subject_id');
    return isExternalSubjectId(subjectId) ? {status: 'subject', subjectId} : invalid;
  }
  if (hasWallet) {
    const namespace = query.get('namespace');
    const walletAddress = query.get('wallet_address');
    return (namespace === 'evm' || namespace === 'solana') && walletAddress?.trim() === walletAddress && walletAddress
      ? {status: 'wallet', namespace, walletAddress} : invalid;
  }
  const chain = query.get('chain');
  const address = query.get('address');
  if (query.has('chain') || query.has('address')) {
    if (!chain || !address) return invalid;
    if (pathWallet && (pathWallet.chain !== chain || pathWallet.address !== address)) return invalid;
    return {status: 'legacy', chain, address};
  }
  return pathWallet ? {status: 'legacy', ...pathWallet} : invalid;
}
