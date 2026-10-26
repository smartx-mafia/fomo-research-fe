import {expect, it} from 'vitest';
import {normalizePortfolioPart} from '@/api/portfolio-parts';
import {pairedPortfolioPoints} from './portfolio-parts';
const common = {meta: {read_id: 'r', snapshot_id: 's', expires_at: {seconds: 2000000000}}, window: '1d', window_context: 'ctx', pnl_rules_version: '1'};
const at = '2026-01-01T00:00:00Z';
const history = normalizePortfolioPart({...common, pnl: {curve: [{at, pnl_usd: '1', roi_ratio: '0.1'}]}, balance: {curve: [{at, balance_usd: '11'}]}}, 'history-curves');
it('replaces equal timestamps without mutating the history cache and keeps ROI', () => {
  const current = normalizePortfolioPart({...common, performance_status: 'complete', pnl_point: {at, pnl_usd: '2', roi_ratio: '0.2'}, balance_point: {at, balance_usd: '12'}}, 'current');
  expect(pairedPortfolioPoints(history, current)).toEqual([{at, pnl_usd: '2', balance_usd: '12', roi_ratio: '0.2'}]);
  expect(history.pnl?.curve[0].pnl_usd).toBe('1');
  expect(pairedPortfolioPoints(history, {...current, window_context: 'other'})[0].pnl_usd).toBe('1');
  expect(pairedPortfolioPoints(history, {...current, balance_point: undefined})[0].pnl_usd).toBe('1');
  expect(pairedPortfolioPoints(history, {...current, meta: {...current.meta, read_id: 'new'}})[0].pnl_usd).toBe('1');
});
