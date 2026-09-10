import {afterEach, describe, expect, it, vi} from 'vitest';
import {getClosedPortfolioPositions, getPortfolioCycleTrades, normalizePortfolioClosedPage} from './portfolio';

const asset = {chain: 'solana', chain_id: 792703809, kind: 'spl', token_address: 'MintA'};
const cycle = {asset, opened_entry_id: '9007199254740993', closed_entry_id: '9007199254740994', status: 'closed', symbol: 'TEST', logo: 'https://images.test/test.png', decimals: 0, buy_amount_raw: '9007199254740995', realized_pnl_usd: '0', pnl_ratio: ''};
const scope = {chain: 'solana', asset: 'MintA', opened_entry_id: '9007199254740993'};
const trade = {trade_id: 'trade-1', side: 'buy', chain: 'solana', token: 'MintA', quote_token: 'USDC', status: 'SUCCESS', lifecycle: 'confirmed', created_at: '2026-09-09T00:00:00Z', cycle_opened_entry_id: scope.opened_entry_id};
function mockReply(data: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data, trace_id: 'cycle-test'})));
  vi.stubGlobal('fetch', fetch); return fetch;
}
describe('Portfolio cycle HTTP contracts', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('requests closed status and opaque pagination without user-supplied identity', async () => {
    const fetch = mockReply({items: [cycle], next_cursor: 'next+/='});
    const page = await getClosedPortfolioPositions('jwt', 'cursor+/=');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1/portfolio/history');
    expect(Object.fromEntries(url.searchParams)).toEqual({status: 'closed', limit: '20', cursor: 'cursor+/='});
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer jwt');
    expect(page.items[0]).toMatchObject({symbol: 'TEST', logo: 'https://images.test/test.png', decimals: 0, buy_amount_raw: '9007199254740995', realized_pnl_usd: '0', pnl_ratio: undefined});
    expect(page.next_cursor).toBe('next+/=');
  });
  it('decodes numeric int64 closed IDs without precision loss', async () => {
    const text = JSON.stringify({code: 200, data: {items: [cycle], next_cursor: ''}}).replace('"9007199254740993"', '9007199254740993').replace('"9007199254740994"', '9007199254740994');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text)));
    const page = await getClosedPortfolioPositions('jwt');
    expect(page.items[0].opened_entry_id).toBe('9007199254740993');
    expect(page.items[0].closed_entry_id).toBe('9007199254740994');
    expect(page.next_cursor).toBeUndefined();
  });
  it('preserves unknown values and rejects malformed or open history entries', () => {
    expect(normalizePortfolioClosedPage({items: [{...cycle, decimals: null, realized_pnl_usd: '', opened_at: {seconds: 0}}]}).items[0]).toMatchObject({decimals: undefined, realized_pnl_usd: undefined, opened_at: undefined});
    expect(() => normalizePortfolioClosedPage({items: [{...cycle, status: 'open'}]})).toThrow();
    expect(() => normalizePortfolioClosedPage({items: {}})).toThrow();
  });
  it('sends the complete cycle scope and an exact before_id', async () => {
    const fetch = mockReply({trades: [trade], next_cursor: '9007199254740997'});
    const page = await getPortfolioCycleTrades('jwt', scope, '9007199254740998');
    expect(Object.fromEntries(new URL(fetch.mock.calls[0][0]).searchParams)).toEqual({...scope, limit: '50', before_id: '9007199254740998'});
    expect(page.next_cursor).toBe('9007199254740997');
  });
  it('never falls back to global mode for missing scope or zero cycle', async () => {
    const fetch = mockReply({trades: []});
    for (const bad of [{...scope, asset: ''}, {...scope, chain: ''}, {...scope, opened_entry_id: '0'}]) await expect(getPortfolioCycleTrades('jwt', bad)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects wrong-cycle rows with a diagnostic trace, including differently cased Solana mints', async () => {
    mockReply({trades: [{...trade, token: 'minta'}]});
    await expect(getPortfolioCycleTrades('jwt', scope)).rejects.toMatchObject({name: 'PortfolioDataError', traceID: 'cycle-test'});
  });
  it('ends pagination only when the backend cursor ends and propagates auth errors', async () => {
    mockReply({trades: [], next_cursor: 0});
    expect(await getPortfolioCycleTrades('jwt', scope)).toEqual({trades: [], next_cursor: undefined});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":430114,"msg":"Invitation required","trace_id":"invite"}')));
    await expect(getClosedPortfolioPositions('jwt')).rejects.toMatchObject({code: 430114});
  });
});
