import type {DepositAddress} from '@/api/deposit';

export type SweepCandidate = {
  asset: {chain: string; token_address: string};
  symbol: string;
  decimals: number;
  minAmountRaw?: string;
};

/** Routes advertise support; only Prepare can establish the current sweepable balance. */
export function sweepCandidates(addresses?: DepositAddress[]): SweepCandidate[] {
  const candidates = new Map<string, SweepCandidate>();
  for (const route of addresses ?? []) {
    if (route.address_format !== 'evm' || !route.chain || !/^0x[\da-fA-F]{40}$/.test(route.address)) continue;
    for (const token of route.accepted_tokens) {
      if (!/^0x[\da-fA-F]{40}$/.test(token.address) || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) continue;
      candidates.set(`${route.chain}:${token.address.toLowerCase()}`, {
        asset: {chain: route.chain, token_address: token.address}, symbol: token.symbol,
        decimals: token.decimals, minAmountRaw: route.min_sweep_amount,
      });
    }
  }
  return [...candidates.values()];
}
