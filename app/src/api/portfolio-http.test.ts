import {afterEach, describe, expect, it, vi} from 'vitest';
import {getPortfolio} from './portfolio';

describe('Portfolio deployed wire contract', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('decodes numeric int64 identities exactly before normalizing real response fields', async () => {
    const response = '{"code":200,"data":{"cash_balance_usd":"20.00000000","total_assets_usd":"21.00000000","total_value_usd":"1.00000000","positions":[{"asset":{"chain":"solana","chain_id":792703809,"kind":"spl","token_address":"test-mint"},"shares_raw":"1000000","decimals":6,"opened_entry_id":9007199254740993,"cycle_status":"ready","cost_basis_usd":"2.00000000","market_value_usd":"1.00000000","total_pnl_usd":"-1.00000000"}],"partial_errors":[]},"trace_id":"wire-test"}';
    const fetchMock = vi.fn().mockResolvedValue(new Response(response));
    vi.stubGlobal('fetch', fetchMock);
    const data = await getPortfolio('test-session');
    expect(data.positions[0].opened_entry_id).toBe('9007199254740993');
    expect(data.positions[0].asset.chain_id).toBe('792703809');
    expect(data.total_assets_usd).toBe('21.00000000');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer test-session');
  });
  it('keeps the backend trace when a code=200 response violates the shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"positions":[{}]},"trace_id":"bad-shape"}')));
    await expect(getPortfolio('test-session')).rejects.toMatchObject({name: 'PortfolioDataError', traceID: 'bad-shape'});
  });
});
