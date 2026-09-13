import {expect, it} from 'vitest';
import {normalizePortfolio} from '@/api/portfolio';
import {revaluePortfolio} from './portfolio-live';

const point = {at: '2026-09-12T00:00:00Z', pnl_usd: '1'};
const snapshot = normalizePortfolio({positions: [{asset: {chain: 'base', chain_id: '8453', kind: 'erc20', token_address: '0xabc'}, shares_raw: '200', decimals: 2, cycle_key: 'c1', opened_entry_id: 0, cycle_status: 'ready', price_usd: '2', price_as_of: {seconds: 100}, market_value_usd: '4', cost_basis_usd: '2', realized_pnl_usd: '1', buy_value_usd: '5'}], quantity_completeness: 'complete', total_value_usd: '4', cash_balance_usd: '10', total_assets_usd: '14', pnl: {d1: {amount_usd: '3', curve: [point]}}, balance: {d1: {amount_usd: '14', curve: [{at: point.at, balance_usd: '12'}]}}});
it('revalues only newer quotes, retaining historical values and exact costs', () => {
  expect(revaluePortfolio(snapshot, {'base:0xabc': {price: '3', at: 99000}})).toBe(snapshot);
  const next = revaluePortfolio(snapshot, {'base:0xabc': {price: '3', at: 101000}});
  expect(next.positions[0]).toMatchObject({market_value_usd: '6', unrealized_pnl_usd: '4', total_pnl_usd: '5', pnl_ratio: '1.000000000000', buy_value_usd: '5', realized_pnl_usd: '1'});
  expect(next.total_assets_usd).toBe('16'); expect(next.pnl?.d1?.amount_usd).toBe('5');
  expect(next.pnl?.d1?.curve).toEqual([point]); expect(next.balance?.d1?.curve).toEqual(snapshot.balance?.d1?.curve);
});
it('never turns incomplete quantities or missing cash into total assets', () => {
  const next = revaluePortfolio({...snapshot, quantity_completeness: 'partial', cash_balance_usd: undefined}, {'base:0xabc': {price: '3', at: 101000}});
  expect(next.total_value_usd).toBeUndefined(); expect(next.total_assets_usd).toBeUndefined();
  expect(next.balance?.d1?.amount_usd).toBeUndefined(); expect(next.balance?.d1?.curve).toEqual(snapshot.balance?.d1?.curve);
});
