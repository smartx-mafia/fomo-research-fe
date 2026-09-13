import {afterEach, expect, it, vi} from 'vitest';
import {getUserPortfolio, getUserClosedPositions, getUserPortfolioPosition, getUserPortfolioTrades} from './user-portfolio';

const asset = {chain: 'base', chain_id: '8453', kind: 'erc20', token_address: '0xabc'};
const position = {asset, shares_raw: '1', opened_entry_id: '0', cycle_key: 'cycle+/=', cycle_status: 'ready', decimals: 0, buy_value_usd: '1', pending_shares: '-1', sellable_shares: '0'};
function respond(data: unknown) {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({code: 200, data, trace_id: 'unified-test'}))));
  vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it('targets a platform identifier and preserves new-cycle identity and pending shares', async () => {
  const fetch = respond({positions: [position], quantity_completeness: 'partial', balance: {d1: {amount_usd: '', curve: [{at: '2026-09-12T00:00:00Z', balance_usd: '100.1'}]}}});
  const data = await getUserPortfolio('user/one', 'jwt', true);
  const url = new URL(fetch.mock.calls[0][0]);
  expect(url.pathname).toBe('/v1/users/user%2Fone/portfolio'); expect(url.searchParams.get('force_refresh')).toBe('true');
  expect(data.positions[0]).toMatchObject({cycle_status: 'ready', opened_entry_id: '0', cycle_key: 'cycle+/=', pending_shares: '-1', sellable_shares: '0'});
  expect(data.quantity_completeness).toBe('partial'); expect(data.balance?.d1?.amount_usd).toBeUndefined();
  expect(data.balance?.d1?.curve[0].balance_usd).toBe('100.1');
});
it('keeps closed opaque cursors, cycles with zero ledger ids, and history quality', async () => {
  const fetch = respond({items: [{...position, status: 'closed', closed_entry_id: '0'}], next_cursor: 'next+/=', history_epoch: '3', completeness: 'partial'});
  const page = await getUserClosedPositions('user', 'cursor+/=');
  expect(page.items[0].cycle_key).toBe('cycle+/='); expect(page.next_cursor).toBe('next+/=');
  expect(page.history_epoch).toBe('3');
  const url = new URL(fetch.mock.calls[0][0]); expect(url.searchParams.get('cursor')).toBe('cursor+/='); expect(url.searchParams.get('limit')).toBe('20');
});
it('loads a complete scoped detail without a trade cursor and rejects mismatched cycles', async () => {
  const fetch = respond({status: 'closed', position: {...position, shares_raw: '0', market_value_usd: '10'}, trades: []});
  const scope = {chain: 'base', asset: '0xABC', cycle_key: 'cycle+/='};
  const detail = await getUserPortfolioPosition('user', scope);
  expect(detail.position.market_value_usd).toBeUndefined(); expect(detail.trades).toEqual([]);
  const url = new URL(fetch.mock.calls[0][0]); expect(url.searchParams.get('cycle_key')).toBe('cycle+/='); expect(url.searchParams.has('before_id')).toBe(false);
  await expect(getUserPortfolioPosition('user', {...scope, cycle_key: 'another'})).rejects.toMatchObject({traceID: 'unified-test'});
  expect(() => getUserPortfolioPosition('user', {chain: 'base', asset: '0xabc', opened_entry_id: '1'})).toThrow('cycle_key');
});
it('preserves integer trade cursors beyond safe integers and execution values verbatim', async () => {
  const trade = {trade_id: 't1', side: 'buy', chain: 'base', token: '0xabc', quote_token: 'usdc', created_at: '2026-09-12T00:00:00Z', status: 'SUCCESS', lifecycle: 'confirmed', cycle_opened_entry_id: '0', cycle_key: 'c1', execution_price_usd: '0.12345678901234567890', fee_total_usd: '1.00000000'};
  const fetch = respond({trades: [trade], next_cursor: '9007199254740999'});
  const page = await getUserPortfolioTrades('user', '9007199254740998');
  expect(page.next_cursor).toBe('9007199254740999'); expect(page.trades[0].execution_price_usd).toBe(trade.execution_price_usd);
  expect(page.trades[0].fee_total_usd).toBe('1.00000000'); expect(new URL(fetch.mock.calls[0][0]).searchParams.get('before_id')).toBe('9007199254740998');
});
