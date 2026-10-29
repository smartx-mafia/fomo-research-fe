import {afterEach, describe, expect, it, vi} from 'vitest';
import {getUserPortfolio} from './user-portfolio';
describe('Portfolio balance curve', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('fetches the requested window with JWT and preserves exact asset amounts', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {positions: [], balance: {d7: {curve: [{at: '2026-09-09T00:00:00Z', balance_usd: '9007199254740993.01'}], amount_usd: '0'}}}})));
    vi.stubGlobal('fetch', fetch);
    const result = await getUserPortfolio('user', 'jwt');
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/v1/users/user/portfolio');
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer jwt');
    expect(result.balance!.d7!.curve[0].balance_usd).toBe('9007199254740993.01');
    expect(result.balance!.d7!.amount_usd).toBe('0');
  });
  it('keeps missing current cash unavailable and malformed curve diagnostics traceable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"positions":[],"balance":{"all":{"curve":[],"amount_usd":""}}}}')));
    expect((await getUserPortfolio('user', 'jwt')).balance?.all?.amount_usd).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"positions":[],"balance":{"d1":{"curve":[{"at":"bad","balance_usd":"1"}]}}},"trace_id":"bad-balance"}')));
    await expect(getUserPortfolio('user', 'jwt')).rejects.toMatchObject({traceID: 'bad-balance'});
  });
});
