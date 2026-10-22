import {expect, it} from 'vitest';
import {normalizeActivities} from './portfolio-activities';

const scope = {chain: 'bsc', asset: '0xabc', cycle_key: 'cycle'};
const transfer = {record_id: 'external:1', side: 'transfer_in', chain: 'bsc', token: '0xABC', cycle_key: 'cycle', created_at: '2026-10-20T03:01:30Z', token_amount: '500', trade_value_usd: '499.34988700', execution_price_usd: '0.99869977400000000000', trade_id: '', status: '', lifecycle: '', confirmed_at: '', asset_decimals: null};
const parse = (rows: unknown[]) => normalizeActivities({activities_status: 'complete', activities: rows}, scope);

it('uses aligned fields exclusively and accepts transfers without platform order fields', () => {
  const result = parse([{...transfer, type: 'buy', acquisition_cost_usd: '999', reference_price_usd: '999', occurred_at: {seconds: 1}}]);
  expect(result.activities?.[0]).toMatchObject({side: 'transfer_in', created_at: transfer.created_at, trade_value_usd: transfer.trade_value_usd, execution_price_usd: transfer.execution_price_usd, asset_decimals: undefined});
  expect(result.activities?.[0]).not.toHaveProperty('acquisition_cost_usd');
});
it('keeps unknown costs distinct from true zero and ignores legacy aliases', () => {
  expect(parse([{...transfer, trade_value_usd: '', acquisition_cost_usd: '999'}]).activities?.[0].trade_value_usd).toBeUndefined();
  expect(parse([{...transfer, trade_value_usd: '0.00000000'}]).activities?.[0].trade_value_usd).toBe('0.00000000');
});
it.each([{chain: 'solana'}, {token: '0xdef'}, {cycle_key: 'other'}])('rejects mismatched identity %j', mismatch => {
  expect(() => parse([{...transfer, ...mismatch}])).toThrow('mismatched');
});
it('validates platform order identity only for buys and sells', () => {
  expect(() => parse([{...transfer, side: 'buy'}])).toThrow('platform');
  expect(parse([{...transfer, side: 'sell', trade_id: 't1', status: 'SUCCESS', lifecycle: 'confirmed'}]).activities?.[0].side).toBe('sell');
});
it('falls back for the previous deployed schema', () => {
  expect(parse([{record_id: 'old', type: 'holding_adjustment'}])).toEqual({activities_status: 'unavailable'});
});
it('preserves unknown directions and server ordering', () => {
  const rows = parse([{...transfer, side: 'future_type'}, {...transfer, record_id: 'external:2', created_at: '2026-10-21T03:01:30Z'}]).activities!;
  expect(rows.map(r => r.record_id)).toEqual(['external:1', 'external:2']);
  expect(rows[0].side).toBe('future_type');
});
