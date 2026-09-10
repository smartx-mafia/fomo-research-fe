import {describe, expect, it} from 'vitest';
import {depositAddressesFromCashBalances, sweepCandidates} from './sweep-routes';
import {normalizePortfolio} from '@/api/portfolio';
import type {DepositAddress} from '@/api/deposit';

const token = {symbol: 'USDC', address: `0x${'Ab'.repeat(20)}`, decimals: 6};
const base: DepositAddress = {chain: 'base', address: `0x${'12'.repeat(20)}`, address_format: 'evm', accepted_tokens: [token], min_sweep_amount: '1000000', deposit_mode: 'sweep', balance_raw: '1000000', balance_meets_minimum: true};
describe('Sweep deposit routes', () => {
  it('uses exact same-route chain/token after the cash snapshot capability gate', () => {
    expect(sweepCandidates([base])).toEqual([{asset: {chain: 'base', token_address: token.address}, symbol: 'USDC', decimals: 6, minAmountRaw: '1000000'}]);
  });
  it('uses only enabled cash routes with known balances meeting the minimum', () => {
    const cash = {chain: 'base', chain_id: 8453, wallet_address: base.address, address_format: 'evm', token,
      amount_raw: '900719925474099312345', deposit_mode: 'sweep', deposit_enabled: true, min_sweep_amount: '1000000', balance_meets_minimum: true};
    const balances = normalizePortfolio({positions: [], cash_balances: [cash, {...cash, chain: 'bsc', deposit_enabled: false}, {...cash, chain: 'ethereum', amount_raw: '', balance_meets_minimum: false}]}).cash_balances;
    expect(balances?.[0].amount_raw).toBe('900719925474099312345');
    const routes = depositAddressesFromCashBalances(balances);
    expect(routes).toHaveLength(2);
    expect(sweepCandidates(routes).map((x) => x.asset.chain)).toEqual(['base']);
    expect(sweepCandidates([{...base, balance_raw: undefined}, {...base, balance_raw: '0'}, {...base, balance_meets_minimum: false}])).toEqual([]);
  });
  it('preserves zero token decimals and rejects missing/malformed precision', () => {
    const cash = {chain: 'base', chain_id: 8453, wallet_address: base.address, address_format: 'evm', token: {...token, decimals: 0}, amount_raw: '1', deposit_mode: 'sweep', deposit_enabled: true, min_sweep_amount: '1', balance_meets_minimum: true};
    expect(normalizePortfolio({cash_balances: [cash]}).cash_balances?.[0].token.decimals).toBe(0);
    expect(() => normalizePortfolio({cash_balances: [{...cash, token: {...token, decimals: undefined}}]})).toThrow('cash balance route');
  });
  it('keeps successful chains when another canonical wallet is unavailable', () => {
    const cash = {chain: 'base', chain_id: 8453, wallet_address: base.address, address_format: 'evm', token, amount_raw: '1000000', deposit_mode: 'sweep', deposit_enabled: true, min_sweep_amount: '1', balance_meets_minimum: true};
    const result = normalizePortfolio({cash_balances: [cash, {...cash, chain: 'ethereum', wallet_address: '', amount_raw: '', balance_meets_minimum: false}], partial_errors: [{chain: 'ethereum', reason: 'canonical_wallet_unavailable'}]});
    expect(result.cash_balances).toHaveLength(2);
    expect(result.cash_balances?.[1].amount_raw).toBeUndefined();
    expect(depositAddressesFromCashBalances(result.cash_balances).map((row) => row.chain)).toEqual(['base']);
    expect(result.partial_errors[0].reason).toBe('canonical_wallet_unavailable');
  });
  it('excludes Solana, missing wallets, malformed tokens and invalid decimals', () => {
    expect(sweepCandidates([{...base, address_format: 'base58'}, {...base, address: ''},
      {...base, accepted_tokens: [{...token, address: 'bad'}, {...token, decimals: 256}]}])).toEqual([]);
  });
  it('deduplicates within a chain and retains the same token address on another chain', () => {
    expect(sweepCandidates([base, {...base, accepted_tokens: [{...token, address: token.address.toLowerCase()}]}, {...base, chain: 'bsc'}])).toHaveLength(2);
    expect(sweepCandidates()).toEqual([]);
    expect(sweepCandidates([{...base, accepted_tokens: []}])).toEqual([]);
  });
});
