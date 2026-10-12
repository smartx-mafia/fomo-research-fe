import {describe, expect, it} from 'vitest';
import {metadataRetryMs, overlayTradeMetadata, type TradeTokenMetadata} from './trade-token-metadata';

describe('trade display recovery', () => {
  it('matches by chain and address while preserving exact execution values', () => {
    const rows = [{chain: 'bsc', token_address: '0xABC', token_symbol: '', token_logo: 'old', cost_usd: '0.000000000000000001', tx_hash: 'hash'},
      {chain: 'base', token_address: '0xABC', token_symbol: 'BASE', token_logo: 'base', cost_usd: '9', tx_hash: 'other'}];
    const got = overlayTradeMetadata(rows, [{chain: 'bsc', address: '0xabc', name: 'Name', symbol: 'SYM', logo: '', refresh_state: 'partial'}]);
    expect(got[0]).toEqual({...rows[0], token_name: 'Name', token_symbol: 'SYM', token_logo: ''});
    expect(got[1]).toBe(rows[1]);
    expect(rows[0].token_logo).toBe('old');
  });
  it('preserves Solana case and stops refreshing after the fixed budget', () => {
    expect(overlayTradeMetadata([{chain: 'sol', token_address: 'AbC', token_symbol: undefined as string | undefined}], [{chain: 'solana', address: 'abc', symbol: 'wrong', refresh_state: 'ready'}])[0].token_symbol).toBeUndefined();
    const pending: TradeTokenMetadata[] = [{chain: 'solana', address: 'AbC', refresh_state: 'pending', retry_after_ms: '2000'}];
    expect(metadataRetryMs(pending, 1000, 2000)).toBe(2000);
    expect(metadataRetryMs(pending, 1000, 30_500)).toBe(0);
    expect(metadataRetryMs(pending, 1000, 31_000)).toBe(0);
    expect(metadataRetryMs([{...pending[0], refresh_state: 'not_found'}], 1000, 2000)).toBe(0);
  });
});
