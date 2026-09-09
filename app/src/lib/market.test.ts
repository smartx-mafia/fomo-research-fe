import {afterEach, describe, expect, it, vi} from 'vitest';

import {fetchBoard, fetchTokenMarket, getWsUrl, MARKET_API_BASE} from './market';

describe('market API browser-direct transport', () => {
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
});
