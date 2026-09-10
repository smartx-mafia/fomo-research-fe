import {afterEach, describe, expect, it, vi} from 'vitest';
import {getPortfolioBalanceCurve} from './portfolio';
describe('Portfolio balance curve', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('fetches the requested window with JWT and preserves exact asset amounts', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {points: [{at: '2026-09-09T00:00:00Z', balance_usd: '9007199254740993.01'}], now_usd: '0', as_of: '2026-09-09T01:00:00Z'}})));
    vi.stubGlobal('fetch', fetch);
    const result = await getPortfolioBalanceCurve('jwt', '7d');
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('window')).toBe('7d');
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer jwt');
    expect(result.points[0].balance_usd).toBe('9007199254740993.01');
    expect(result.now_usd).toBe('0');
  });
  it('keeps missing current cash unavailable and malformed curve diagnostics traceable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"points":[],"now_usd":""}}')));
    expect((await getPortfolioBalanceCurve('jwt', 'all')).now_usd).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"points":[{"at":"bad","balance_usd":"1"}]},"trace_id":"bad-balance"}')));
    await expect(getPortfolioBalanceCurve('jwt', '1d')).rejects.toMatchObject({traceID: 'bad-balance'});
  });
});
