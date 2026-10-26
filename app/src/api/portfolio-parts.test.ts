import {afterEach, describe, expect, it, vi} from 'vitest';
import {getPortfolioPart, normalizePortfolioPart} from './portfolio-parts';
const meta = {read_id: 'r', snapshot_id: 's', expires_at: {seconds: 2000000000, nanos: 0}};
afterEach(() => vi.unstubAllGlobals());
describe('progressive portfolio wire contract', () => {
  it('requires actual pagination support rather than accepting an old 200 response', () => {
    expect(() => normalizePortfolioPart({meta, positions: []}, 'positions')).toThrow('pagination');
    expect(normalizePortfolioPart({meta, positions: [], total_count: 0, page_expires_at: {seconds: 2000000100}}, 'positions').total_count).toBe(0);
  });
  it('keeps unknown amounts distinct from zero and validates paired historical timestamps', () => {
    const data = normalizePortfolioPart({meta, window: '1d', total_assets_usd: '', cash_balance_usd: '0', balance_point: {at: '', balance_usd: ''}}, 'current');
    expect(data.total_assets_usd).toBeUndefined(); expect(data.cash_balance_usd).toBe('0'); expect(data.balance_point).toBeUndefined();
    expect(() => normalizePortfolioPart({meta, window: '1d', pnl: {curve: [{at: '2026-01-01T00:00:00Z', pnl_usd: '0'}]}, balance: {curve: []}}, 'history-curves')).toThrow('do not match');
  });
  it('encodes opaque cursors and sends the shared read identity and bearer', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: {meta, positions: [], total_count: 0, page_expires_at: {seconds: 2000000100}}})));
    vi.stubGlobal('fetch', fetch);
    await getPortfolioPart('user/one', 'positions', {read_id: 'r', snapshot_id: 's', cursor: 'opaque+/=', force_refresh: true, sort: 'value_desc'}, 'jwt');
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toContain('user%2Fone'); expect(url.searchParams.get('cursor')).toBe('opaque+/='); expect(url.searchParams.get('limit')).toBe('20');
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer jwt');
  });
  it('preserves business error action and trace without anonymous fallback', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 400000, msg: 'expired', error: 'bad_token', action: {type: 'login'}, trace_id: 'trace'})));
    vi.stubGlobal('fetch', fetch);
    await expect(getPortfolioPart('user', 'cash', {read_id: 'r', force_refresh: false}, 'jwt')).rejects.toMatchObject({code: 400000, action: {type: 'login'}, traceID: 'trace'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
