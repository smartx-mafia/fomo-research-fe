import {afterEach, describe, expect, it, vi} from 'vitest';

import {fetchBoard, fetchHolderPage, fetchOhlcv, fetchOnChainTradeBoard, fetchTokenMarket, fetchTopTraders, getWsUrl, MARKET_API_BASE} from './market';

describe('market API browser-direct transport', () => {
  it('sends candle ranges in seconds, reads milliseconds and forwards cancellation without a trade fallback', async () => {
    const t = Date.UTC(2026, 0, 1);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {bars: [{t, o: 1, h: 2, l: 1, c: 1.5, v: 0}]}})));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const rows = await fetchOhlcv('solana', 'A/B', {period: '1m', from: t / 1000, to: t / 1000 + 60, signal: controller.signal});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(MARKET_API_BASE + '/v1/tokens/solana/A%2FB/ohlcv?period=1m&from=' + t / 1000 + '&to=' + (t / 1000 + 60));
    expect(rows[0].t).toBe(t);
    expect(rows[0].v).toBe(0);
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('supports an empty candle envelope and surfaces API errors rather than manufacturing data', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({code: 200, data: {}})))
      .mockResolvedValueOnce(new Response(JSON.stringify({code: 500097, msg: 'unavailable', trace_id: 'chart-failure'})));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchOhlcv('solana', 'A')).toEqual([]);
    await expect(fetchOhlcv('solana', 'A')).rejects.toMatchObject({code: 500097, traceId: 'chart-failure'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests the real market host instead of a frontend rewrite', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      msg: 'success',
      data: {items: []},
    }), {status: 200, headers: {'content-type': 'application/json'}}));
    vi.stubGlobal('fetch', fetchMock);

    await fetchBoard('trending');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${MARKET_API_BASE}/v1/boards/trending`);
  });

  it('builds a direct WebSocket address from the market origin', () => {
    expect(getWsUrl()).toBe(`${MARKET_API_BASE.replace(/^http/, 'ws')}/ws`);
  });

  it('forwards cancellation to the token request and keeps real identity and artwork', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, data: {chain: 'base', address: '0xabc', name: 'Example', symbol: 'EX', logo: 'https://images.test/token.png', price: '0.125'},
    }), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const result = await fetchTokenMarket('base', '0xabc', 5, controller.signal);
    expect(result).toMatchObject({chain: 'base', address: '0xabc', name: 'Example', logo: 'https://images.test/token.png', price: 0.125});
    expect(fetchMock.mock.calls[0][0]).toBe(`${MARKET_API_BASE}/v1/tokens/base/0xabc/market`);
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('normalizes holder identity, address type, platform holding and top-holder metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {
      holders_count: 28307,
      top10_percent: 20.1699,
      items: [{
        wallet_address: '0xabc', token_amount: '123.4500', token_amount_usd: 456.7,
        percentage_of_total_supply: 1.2, first_held_time: 1785887867000, address_type: 1,
        identity: {identifier: 'user-1', username: 'alice', nickname: 'Alice', avatar_url: 'https://img/alice.png'},
        platform_holding: {status: 1, market_value_usd: '42.50', avg_cost_usd: '35', pnl_percent: '21.4285'},
        viewer: {following: true, remark: '老王'},
      }],
    }})));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHolderPage('ethereum', '0xabc', {limit: 100})).resolves.toMatchObject({
      holders_count: 28307,
      top10_percent: 20.1699,
      items: [{
        wallet_address: '0xabc', token_amount: '123.4500', address_type: 1,
        identity: {identifier: 'user-1', username: 'alice', nickname: 'Alice'},
        platform_holding: {status: 1, market_value_usd: '42.50', pnl_percent: '21.4285'},
        viewer: {following: true, remark: '老王'},
      }],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${MARKET_API_BASE}/v1/tokens/ethereum/0xabc/holders?limit=100&offset=0`);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({code: 200, data: {items: [{wallet_address: '0xabc', token_amount: '0', total_pnl_usd: 12.5}]}})));
    await expect(fetchTopTraders('ethereum', '0xabc', {limit: 3})).resolves.toMatchObject({items: [{token_amount: '0', total_pnl_usd: 12.5}]});
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${MARKET_API_BASE}/v1/tokens/ethereum/0xabc/top-traders?limit=3&offset=0`);
  });

  it('normalizes the on-chain trade board without reinterpreting human-readable amounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {
      token: {chain: 'solana', address: 'MintA', decimals: 6, symbol: 'ABC'},
      items: [{type: 'buy', date: 1789616411000, base_token_amount: '123.4500001', base_token_amount_usd: 9.99, price_usd: 0.081, market_cap_usd_estimated: '1000000.1234', tx_hash: 'sig', sender: 'wallet'}],
    }})));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchOnChainTradeBoard('solana', 'MintA', 50)).resolves.toMatchObject({
      token: {chain: 'solana', address: 'MintA', decimals: 6, symbol: 'ABC'},
      items: [{side: 'buy', occurredAt: 1789616411, tokenAmount: '123.4500001', usd: 9.99, executionPriceUSD: 0.081, marketCapUSDEstimated: '1000000.1234', txHash: 'sig', sender: 'wallet'}],
      coverage: [],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${MARKET_API_BASE}/v1/tokens/solana/MintA/trades?limit=50`);
  });

  it('does not turn a code-200 response without data into a false empty board', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, msg: 'success'})));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchOnChainTradeBoard('solana', 'MintA')).rejects.toThrow('Missing on-chain trade board response');
  });
});
