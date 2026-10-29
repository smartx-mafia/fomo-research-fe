import {describe, expect, it} from 'vitest';

import type {PrepareTradeReply, TradeIntent} from '@/api/trade';
import {assertPreparedTradeMatches, intentFingerprint, outputAmount, parseIntentFingerprint} from './trade-execution';

const intent: TradeIntent = {
  chain: 'bsc',
  side: 'buy',
  token: '0xABCDEF0000000000000000000000000000000000',
  amountIn: '1000000',
  slippageBps: 300,
};

function prepared(overrides: Partial<PrepareTradeReply['trade']> = {}): PrepareTradeReply {
  return {
    trade: {trade_id: 'trade-1', side: 'buy', token: intent.token, amount_in: '1000000', requested_slippage_bps: 300, ...overrides},
    sign_kind: 4,
    sign_data: 'AA==',
    prepare_id: 'prepare-1',
    wallet_address: '0x1111111111111111111111111111111111111111',
    expires_at: '2099-01-01T00:00:00Z',
  };
}

describe('trade execution guards', () => {
  it('uses case-insensitive EVM token identity but case-sensitive Solana identity', () => {
    expect(intentFingerprint({...intent, token: intent.token.toLowerCase()})).toBe(intentFingerprint(intent));
    expect(intentFingerprint({...intent, chain: 'solana', token: 'TokenA'})).not.toBe(
      intentFingerprint({...intent, chain: 'solana', token: 'tokena'}),
    );
  });

  it('round trips a valid intent fingerprint and rejects malformed recovery data', () => {
    expect(parseIntentFingerprint(intentFingerprint(intent))).toEqual({...intent, token: intent.token.toLowerCase()});
    expect(parseIntentFingerprint('{broken')).toBeUndefined();
    expect(parseIntentFingerprint(JSON.stringify(['bsc', 'buy', intent.token, '0', 300]))).toBeUndefined();
  });

  it('rejects prepared identity, amount, and slippage drift before signing', () => {
    expect(() => assertPreparedTradeMatches(prepared(), intent, 'trade-1')).not.toThrow();
    expect(() => assertPreparedTradeMatches(prepared({trade_id: 'other'}), intent, 'trade-1')).toThrow(/does not match/);
    expect(() => assertPreparedTradeMatches(prepared({amount_in: '2'}), intent, 'trade-1')).toThrow(/amount/);
    expect(() => assertPreparedTradeMatches(prepared({requested_slippage_bps: 301}), intent, 'trade-1')).toThrow(/slippage/);
  });

  it('uses settled, observed, and quoted output in that order while treating empty strings as absent', () => {
    const base = {trade_id: 'trade-1', side: 'buy', token: intent.token};
    expect(outputAmount({...base, amount_out: '3', amount_out_observed: '2', amount_out_quoted: '1'})).toBe('3');
    expect(outputAmount({...base, amount_out: '', amount_out_observed: '2', amount_out_quoted: '1'})).toBe('2');
    expect(outputAmount({...base, amount_out: '', amount_out_observed: '', amount_out_quoted: '1'})).toBe('1');
  });
});
