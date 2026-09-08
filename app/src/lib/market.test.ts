import {afterEach, describe, expect, it, vi} from 'vitest';

import {fetchBoard, getWsUrl, MARKET_API_BASE} from './market';

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
});
