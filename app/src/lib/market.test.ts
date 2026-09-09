import {afterEach, describe, expect, it, vi} from 'vitest';

import {fetchBoard, fetchOhlcv, fetchTokenMarket, getWsUrl, MARKET_API_BASE} from './market';

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
});
