import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', async (original) => ({...await original<typeof import('./envelope')>(), call: callMock}));
import {getSquarePositionCapability, getSquarePositionTrades, getSquareSmartMoneyPosition} from './square-position';
import type {SquarePositionTarget} from '@/lib/square-position';
const target: SquarePositionTarget = {kind: 'wallet', identifier: `0x${'ab'.repeat(20)}`, chain: 'bsc', address: `0x${'cd'.repeat(20)}`, name: 'Wallet'};
const row = (fields: Record<string, unknown> = {}) => ({status: 'open', chain: 'bsc', token_address: target.address, ...fields});
const page = (list: unknown[], extra: Record<string, unknown> = {}) => ({data: {list, snapshot_id: 'same-members', next_cursor: '', ...extra}});
beforeEach(() => {callMock.mockReset();});
afterEach(() => vi.resetAllMocks());
describe('Square smart-money exact position routes', () => {
  it.each(['wallet', 'external_user'] as const)('reads %s pending positions with an exact token filter and no invented financial values', async (kind) => {
    const selected = {...target, kind, identifier: kind === 'wallet' ? target.identifier : 'subject:42'};
    callMock.mockResolvedValue(page([row({status: 'pending', balance: '99', total_profit: '999', detail: {accu_cost: '0'}, observation: {status: 'pending_source_refresh', bought_amount: '7', bought_usd: '45.50', sold_amount: '', sold_usd: '', coverage: 'unknown'}})]));
    const result = await getSquareSmartMoneyPosition(selected);
    const url = new URL(callMock.mock.calls[0][0], 'https://test');
    expect(url.pathname).toBe('/v2/smartmoney/positions/page');
    expect(url.searchParams.get('chain')).toBe('bsc');
    expect(url.searchParams.get('token_address')).toBe(target.address);
    expect(url.searchParams.get('status')).toBe('all');
    expect(url.searchParams.get('include_details')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(result.holding).toEqual({state: 'pending', observation: {status: 'pending_source_refresh', boughtQuantity: '7', boughtUSD: '45.50', soldQuantity: undefined, soldUSD: undefined, coverage: 'unknown'}});
  });
  it('replaces pending with a source row, reads detail fields and keeps observation independent', async () => {
    callMock.mockResolvedValue(page([row({balance: '2', total_profit: '5', history_bought_cost: '80', detail: {accu_cost: '20', avg_bought_price: '3', avg_sold_price: '4', transfer_in_quantity: '0'}, observation: {status: 'source_reported', bought_usd: '50'}})]));
    expect((await getSquareSmartMoneyPosition(target)).holding).toMatchObject({state: 'open', quantity: '2', pnlUSD: '5', investedUSD: '80', avgBuyPrice: '3', avgSellPrice: '4', transferIn: '0', observation: {status: 'source_reported', boughtUSD: '50'}});
  });
  it('keeps the exact wallet identity and token scoped history, preserving zero and unknown', async () => {
    callMock.mockResolvedValueOnce(page([row({token_address: target.address.toUpperCase(), balance: '2.001', usd_value: '0', total_profit: '', history_bought_cost: '999'})], {coverage: 'partial'}))
      .mockResolvedValueOnce({data: {coverage: 'partial', list: [{event_type: 'transfer_in', occurred_at: '1780000000', token_amount: '2', cost_usd: '', price_usd: '', tx_hash: 'same'}, {event_type: 'buy', occurred_at: '1780000000', cost_usd: '0', tx_hash: 'same'}]}});
    const result = await getSquareSmartMoneyPosition(target);
    const query = new URL(callMock.mock.calls[0][0], 'https://test').searchParams;
    expect(query.get('identity.type')).toBe('wallet');
    expect(query.get('identity.address')).toBe(target.identifier);
    expect(query.get('identity.namespace')).toBe('evm');
    expect(result.holding).toMatchObject({state: 'open', valueUSD: '0', pnlUSD: undefined, quantity: '2.001', investedUSD: '999', avgBuyPrice: undefined});
    const history = await getSquarePositionTrades(target);
    expect(callMock.mock.calls[1][0]).toBe(`/v1/smartmoney/new-position-trades?subject_type=address&chain=bsc&address=${target.identifier}&token_address=${target.address}`);
    expect(history.list).toHaveLength(2);
    expect(history.list[0]).toMatchObject({event: 'transfer_in', amountUSD: undefined, priceUSD: undefined});
    expect(history.list[1].amountUSD).toBe('0');
  });
  it('requests an external subject on the actual chain and preserves Solana token case', async () => {
    const selected = {...target, kind: 'external_user', identifier: 'subject:42', chain: 'solana', address: 'CaseSensitiveMint'} as const;
    callMock.mockResolvedValueOnce(page([row({chain: 'sol', token_address: 'casesensitivemint', balance: '999'}), row({chain: 'sol', token_address: selected.address, balance: '1'})])).mockResolvedValueOnce({data: {list: []}});
    expect((await getSquareSmartMoneyPosition(selected)).holding?.quantity).toBe('1');
    const params = new URL(callMock.mock.calls[0][0], 'https://test').searchParams;
    expect(params.get('identity.user_id')).toBe('subject:42');
    expect(params.get('chain')).toBe('sol');
    expect(params.get('token_address')).toBe('CaseSensitiveMint');
    await getSquarePositionTrades(selected);
    expect(new URL(callMock.mock.calls[1][0], 'https://test').searchParams.get('position_id')).toBe('sol:CaseSensitiveMint');
  });
  it('uses open then closed then pending priority and does not interpret a trade hint as a source round', async () => {
    callMock.mockResolvedValue(page([row({status: 'pending'}), row({status: 'closed', realized_profit: '9'}), row({balance: '5'})]));
    expect((await getSquareSmartMoneyPosition({...target, closedHint: true})).holding).toMatchObject({state: 'open', quantity: '5'});
  });
  it('reads closed source fields and detail-only observation while hiding current valuation', async () => {
    callMock.mockResolvedValue(page([row({status: 'closed', balance: '0', usd_value: '99', price: '2', realized_profit: '-12', realized_profit_pnl: '-0.5', detail: {avg_bought_price: '1', avg_sold_price: '0.5', observation: {status: 'source_reported', bought_usd: '12'}}})]));
    expect((await getSquareSmartMoneyPosition(target)).holding).toMatchObject({state: 'closed', pnlUSD: '-12', ratio: '-0.5', avgBuyPrice: '1', avgSellPrice: '0.5', valueUSD: undefined, currentPrice: undefined, quantity: undefined, observation: {boughtUSD: '12'}});
  });
  it('leaves absent detail and unknown numeric fields unknown without reading obsolete flat detail aliases', async () => {
    callMock.mockResolvedValue(page([row({balance: '', total_profit: null, history_bought_cost: '', avg_bought_price: '999', accu_cost: '888', detail: null})]));
    expect((await getSquareSmartMoneyPosition(target)).holding).toMatchObject({state: 'open', quantity: undefined, pnlUSD: undefined, investedUSD: undefined, avgBuyPrice: undefined});
  });
  it('rejects old snapshot format instead of silently treating it as an empty page', async () => {
    callMock.mockResolvedValue({data: {snapshot: {wallet: {open: []}}}});
    await expect(getSquareSmartMoneyPosition(target)).rejects.toThrow('page list');
  });
  it('reads bounded continuation pages before selecting a position and checks membership version', async () => {
    callMock.mockResolvedValueOnce(page([row({status: 'closed', realized_profit: '-9'})], {next_cursor: 'page2'})).mockResolvedValueOnce(page([row({balance: '7'})]));
    expect((await getSquareSmartMoneyPosition(target)).holding).toMatchObject({state: 'open', quantity: '7'});
    expect(new URL(callMock.mock.calls[1][0], 'https://test').searchParams.get('cursor')).toBe('page2');
    callMock.mockReset().mockResolvedValueOnce(page([], {next_cursor: 'page2'})).mockResolvedValueOnce(page([], {snapshot_id: 'changed'}));
    await expect(getSquareSmartMoneyPosition(target)).rejects.toThrow('changed');
  });
  it('returns every closed source record for explicit selection instead of choosing or merging histories', async () => {
    callMock.mockResolvedValue(page([row({status: 'closed', position_id: 'same-asset', realized_profit: '12', detail: {end_holding_at: '1792422045', avg_sold_price: '3'}}), row({status: 'closed', position_id: 'same-asset', realized_profit: '-4', detail: {end_holding_at: '1791995586', avg_sold_price: ''}})]));
    const result = await getSquareSmartMoneyPosition(target);
    expect(result.holding).toBeUndefined();
    expect(result.closedRecords).toHaveLength(2);
    expect(result.closedRecords?.[0]).toMatchObject({at: '1792422045', holding: {state: 'closed', pnlUSD: '12', avgSellPrice: '3'}});
    expect(result.closedRecords?.[1]).toMatchObject({at: '1791995586', holding: {state: 'closed', pnlUSD: '-4', avgSellPrice: undefined}});
    expect(result.closedRecords?.[0].key).not.toBe(result.closedRecords?.[1].key);
  });
  it('uses source activity time when the wire closed timestamp is zero', async () => {
    callMock.mockResolvedValue(page([row({status: 'closed', last_active_at: '1792422045', detail: {end_holding_at: '0'}}), row({status: 'closed', last_active_at: '1791995586', detail: {end_holding_at: 0}})]));
    const result = await getSquareSmartMoneyPosition(target);
    expect(result.closedRecords?.map((record) => record.at)).toEqual(['1792422045', '1791995586']);
  });
  it('keeps ambiguous open rows rejected and gives undated closed records separate snapshot keys', async () => {
    callMock.mockResolvedValueOnce(page([row(), row()]));
    await expect(getSquareSmartMoneyPosition(target)).rejects.toThrow('Multiple position rounds');
    callMock.mockResolvedValue(page([row({status: 'closed'}), row({status: 'closed'})]));
    const result = await getSquareSmartMoneyPosition(target);
    expect(result.closedRecords?.[0].at).toBeUndefined();
    expect(result.closedRecords?.[0].key).not.toBe(result.closedRecords?.[1].key);
  });
  it('fails explicitly when the selected token history exceeds five pages', async () => {
    callMock.mockImplementation(async () => page([], {next_cursor: `page${callMock.mock.calls.length}`}));
    await expect(getSquareSmartMoneyPosition(target)).rejects.toThrow('exceeds');
    expect(callMock).toHaveBeenCalledTimes(5);
  });
  it('honors disabled capability but accepts an absent surface', async () => {
    callMock.mockResolvedValueOnce({data: {surfaces: {positions: {enabled: false, state: 'not_ready'}}}}).mockResolvedValueOnce({data: {}});
    expect((await getSquarePositionCapability()).ready).toBe(false);
    expect((await getSquarePositionCapability()).ready).toBe(true);
  });
});

it.each(['20', '0', ''])('keeps FOMO pure record buys %s separate from transfer-inclusive cost', async (amount) => {
  callMock.mockResolvedValue(page([row({history_bought_cost: '900', detail: {round_bought_amount: amount, transfer_in_amount: '880'}})], {meta: {source: 'fomo', calculation_version: 'fomo-profile-ledger-v1'}}));
  expect((await getSquareSmartMoneyPosition(target)).holding).toMatchObject({investedUSD: amount || undefined, buyAmountScope: 'record'});
});
it('keeps Codex lifetime buys when the identity originated from FOMO', async () => {
  callMock.mockResolvedValue(page([row({history_bought_cost: '900', detail: {round_bought_amount: ''}})], {meta: {source: 'fomo', calculation_version: 'codex-realized+own-unrealized-v3'}}));
  expect((await getSquareSmartMoneyPosition(target)).holding).toMatchObject({investedUSD: '900', buyAmountScope: 'history'});
});

it('keeps each FOMO windows closed record pure buy amount separate', async () => {
  callMock.mockResolvedValue(page([row({status: 'closed', history_bought_cost: '900', detail: {round_bought_amount: '20'}}), row({status: 'closed', history_bought_cost: '700', detail: {round_bought_amount: '0'}})], {meta: {source: 'fomo', calculation_version: 'fomo-profile-windows-v1'}}));
  const result = await getSquareSmartMoneyPosition(target);
  expect(result.holding).toBeUndefined();
  expect(result.closedRecords?.map((record) => [record.holding.investedUSD, record.holding.buyAmountScope])).toEqual([['20', 'record'], ['0', 'record']]);
});
