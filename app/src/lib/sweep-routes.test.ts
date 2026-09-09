import {describe, expect, it} from 'vitest';
import {sweepCandidates} from './sweep-routes';
import type {DepositAddress} from '@/api/deposit';

const token = {symbol: 'USDC', address: `0x${'Ab'.repeat(20)}`, decimals: 6};
const base: DepositAddress = {chain: 'base', address: `0x${'12'.repeat(20)}`, address_format: 'evm', accepted_tokens: [token], min_sweep_amount: '1000000'};
describe('Sweep deposit routes', () => {
  it('uses exact same-route chain/token with no Portfolio balance or capability', () => {
    expect(sweepCandidates([base])).toEqual([{asset: {chain: 'base', token_address: token.address}, symbol: 'USDC', decimals: 6, minAmountRaw: '1000000'}]);
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
