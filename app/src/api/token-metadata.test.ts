import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  batchGetTokenMetadata,
  normalizeBatchTokenMetadata,
  normalizeTokenRef,
  TOKEN_META_STATUS_MISS,
  TOKEN_META_STATUS_OK,
  TOKEN_META_STATUS_UNAVAILABLE,
  tokenKey,
} from './token-metadata';

describe('token metadata contract', () => {
  it('normalizes EVM and CAIP addresses while preserving Solana case', () => {
    expect(normalizeTokenRef('bsc', '0xAbC')).toEqual({chain: 'bsc', address: '0xabc'});
    expect(normalizeTokenRef('sol', 'SoLAbC')).toEqual({chain: 'solana', address: 'SoLAbC'});
    expect(normalizeTokenRef('solana:mainnet', 'SoLAbC')).toEqual({chain: 'solana', address: 'SoLAbC'});
    expect(normalizeTokenRef('eip155:4663', '0xAbC')).toEqual({chain: 'robinhood', address: '0xabc'});
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
    expect(reply.results[0].personal.is_favorited).toBe(true);
    expect(reply.results[1].info).toBeUndefined();
  });

  it('rejects misaligned or mismatched responses', () => {
    const refs = [{chain: 'bsc', address: '0xabc'}];
    expect(() => normalizeBatchTokenMetadata({results: []}, refs)).toThrow(/align/);
    expect(() => normalizeBatchTokenMetadata({results: [{status: 1, chain: 'bsc', address: '0xabc', info: {chain: 'bsc', address: '0xother', decimals: 18}, personal: {is_favorited: false}}]}, refs)).toThrow(/mismatched/);
    expect(() => normalizeBatchTokenMetadata({results: [{status: 1, chain: 'bsc', address: '0xabc', info: {chain: 'bsc', address: '0xabc', decimals: 18}, personal: {}}]}, refs)).toThrow(/personal/);
  });

  it('isolates unknown precision without discarding other token logos or inventing zero decimals', () => {
    const refs = [{chain: 'bsc', address: '0xknown'}, {chain: 'robinhood', address: '0xunknown'}, {chain: 'solana', address: 'ZeroDecimalsMint'}];
    const rows = refs.map((ref, index) => ({...ref, status: TOKEN_META_STATUS_OK, source: 2,
      info: {...ref, decimals: [18, -1, 0][index], logo: `https://images.example/${index}.png`},
      personal: {is_favorited: false}, risk: {result_is_scam: true}}));
    const response = normalizeBatchTokenMetadata({results: rows}, refs);
    expect(response.results[0].info?.logo).toBe('https://images.example/0.png');
    expect(response.results[1].status).toBe(TOKEN_META_STATUS_UNAVAILABLE);
    expect(response.results[1].info).toBeUndefined();
    expect(response.results[1].presentation).toMatchObject({logo: 'https://images.example/1.png'});
    expect(response.results[1].presentation?.decimals).toBeUndefined();
    expect(response.results[1].risk).toEqual(response.results[0].risk);
    expect(response.results[2].info).toMatchObject({decimals: 0, logo: 'https://images.example/2.png'});
    rows[1].info.address = '0xwrong';
    expect(() => normalizeBatchTokenMetadata({results: rows}, refs)).toThrow(/mismatched/);
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
