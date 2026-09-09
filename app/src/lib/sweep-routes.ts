import type {DepositAddress} from '@/api/deposit';
import type {PortfolioCashBalance} from '@/api/portfolio';

/** UI projection only: cash_balances is the sole backend discovery contract. */
export function depositAddressesFromCashBalances(balances?: PortfolioCashBalance[]): DepositAddress[] {
  return (balances ?? []).filter((row) => row.deposit_enabled && row.wallet_address !== '').map((row) => ({chain: row.chain, address: row.wallet_address,
    address_format: row.address_format, accepted_tokens: [row.token], min_sweep_amount: row.min_sweep_amount,
    balance_raw: row.amount_raw, balance_meets_minimum: row.balance_meets_minimum, deposit_mode: row.deposit_mode}));
}

export type SweepCandidate = {
  asset: {chain: string; token_address: string};
  symbol: string;
  decimals: number;
  minAmountRaw?: string;
};

/** Cached cash gates discovery; Prepare must still freshly verify the balance. */
export function sweepCandidates(addresses?: DepositAddress[]): SweepCandidate[] {
  const candidates = new Map<string, SweepCandidate>();
  for (const route of addresses ?? []) {
    if (route.address_format !== 'evm' || route.deposit_mode !== 'sweep' || !route.balance_meets_minimum || route.balance_raw === undefined ||
      !/^[0-9]+$/.test(route.balance_raw) || BigInt(route.balance_raw) <= BigInt(0) || !route.chain || !/^0x[\da-fA-F]{40}$/.test(route.address)) continue;
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
