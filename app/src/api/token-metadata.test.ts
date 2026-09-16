import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  batchGetTokenMetadata,
  normalizeBatchTokenMetadata,
  normalizeTokenRef,
  TOKEN_META_STATUS_MISS,
  TOKEN_META_STATUS_OK,
  tokenKey,
} from './token-metadata';

describe('token metadata contract', () => {
  it('normalizes EVM addresses, preserves Solana case and maps Smart Money sol', () => {
    expect(normalizeTokenRef('bsc', '0xAbC')).toEqual({chain: 'bsc', address: '0xabc'});
    expect(normalizeTokenRef('sol', 'SoLAbC')).toEqual({chain: 'solana', address: 'SoLAbC'});
    expect(tokenKey('solana', 'SoLAbC')).toBe('solana:SoLAbC');
  });

  it('reads info only for OK and defaults an old backend is_verify to false', () => {
    const refs = [{chain: 'bsc', address: '0xabc'}, {chain: 'solana', address: 'SoL'}];
    const reply = normalizeBatchTokenMetadata({results: [
      {chain: 'bsc', address: '0xAbC', status: TOKEN_META_STATUS_OK, source: 2,
        info: {chain: 'bsc', address: '0xabc', symbol: 'A', decimals: 18}, personal: {is_favorited: true}},
      {chain: 'solana', address: 'SoL', status: TOKEN_META_STATUS_MISS,
        info: {chain: 'solana', address: 'SoL', decimals: 9, is_verify: true}, personal: {is_favorited: true}},
    ]}, refs);
    expect(reply.results[0].info?.is_verify).toBe(false);
    expect(reply.results[0].risk).toMatchObject({level: 'UNKNOWN', quality: {state: 'UNAVAILABLE'}});
    expect(reply.results[0].personal.is_favorited).toBe(true);
    expect(reply.results[0].personal.position_amount).toBe('');
    expect(reply.results[1].info).toBeUndefined();
  });

  it('preserves personal position amounts as exact strings', () => {
    const refs = [{chain: 'bsc', address: '0xabc'}];
    const reply = normalizeBatchTokenMetadata({results: [{
      chain: 'bsc', address: '0xabc', status: TOKEN_META_STATUS_OK, source: 2,
      info: {chain: 'bsc', address: '0xabc', decimals: 18},
      personal: {is_favorited: false, position_amount: '1000000000000000001'},
    }]}, refs);
    expect(reply.results[0].personal).toEqual({is_favorited: false, position_amount: '1000000000000000001'});
  });

  it('normalizes canonical risk beside static metadata info', () => {
    const refs = [{chain: 'base', address: '0xabc'}];
    const reply = normalizeBatchTokenMetadata({results: [{
      chain: 'base', address: '0xabc', status: TOKEN_META_STATUS_OK, source: 2,
      info: {chain: 'base', address: '0xabc', decimals: 18},
      risk: {
        resultIsScam: false,
        tokenIsScam: null,
        potentialScamReasons: ['MinimumLiquidity'],
        level: 'POTENTIAL',
        quality: {state: 'AVAILABLE', freshness: 'FRESH', source: 'codex.filterTokens', definitionVersion: 'token-risk-v2', observedAtMs: '1788922311890'},
      },
      personal: {is_favorited: false},
    }]}, refs);
    expect(reply.results[0].risk).toMatchObject({level: 'POTENTIAL', resultIsScam: false, tokenIsScam: null});
  });

  it('rejects misaligned or mismatched responses', () => {
    const refs = [{chain: 'bsc', address: '0xabc'}];
    expect(() => normalizeBatchTokenMetadata({results: []}, refs)).toThrow(/align/);
    expect(() => normalizeBatchTokenMetadata({results: [{status: 1, chain: 'bsc', address: '0xabc', info: {chain: 'bsc', address: '0xother', decimals: 18}, personal: {is_favorited: false}}]}, refs)).toThrow(/mismatched/);
    expect(() => normalizeBatchTokenMetadata({results: [{status: 1, chain: 'bsc', address: '0xabc', info: {chain: 'bsc', address: '0xabc', decimals: 18}, personal: {}}]}, refs)).toThrow(/personal/);
  });

  it('posts normalized refs and rejects more than 500 client-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {results: [
      {chain: 'bsc', address: '0xabc', status: 1, source: 2, info: {chain: 'bsc', address: '0xabc', decimals: 18, is_verify: true}, personal: {is_favorited: false}},
    ]}}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const result = await batchGetTokenMetadata([{chain: 'bsc', address: '0xAbC'}], 'jwt');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({tokens: [{chain: 'bsc', address: '0xabc'}]});
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt');
    expect(result.data.results[0].info?.is_verify).toBe(true);
    await expect(batchGetTokenMetadata(Array.from({length: 501}, (_, i) => ({chain: 'bsc', address: `0x${i}`})))).rejects.toThrow(/1–500/);
  });

  afterEach(() => vi.unstubAllGlobals());
});
