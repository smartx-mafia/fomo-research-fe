// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('@/api/envelope', () => ({call: callMock}));

import {SmartMoneySourcePanels} from './SmartMoneySourcePanels';
import {parseSmartMoneyIdentityRoute} from '@/lib/smartmoney-identity';

afterEach(() => { cleanup(); callMock.mockReset(); });

it('lands a BSC leaderboard wallet on its published BSC snapshot', async () => {
  const route = parseSmartMoneyIdentityRoute('/smart-money',
    new URLSearchParams('namespace=evm&wallet_address=0xabc&source_chain=bsc'));
  if (route.status !== 'wallet') throw new Error('Expected wallet route.');
  callMock.mockImplementation(async (path: string) => {
    if (path === '/v2/smartmoney/capabilities') return {data: {
      protocol_version: '2', epoch: 'provider-snapshot-v1', supported_chains: ['base', 'bsc', 'ethereum'],
      surfaces: {positions: {enabled: true, state: 'ready', reason: 'data_mode=provider_snapshot;ledger_verified=false', poll_after_ms: 30000}},
    }};
    if (path.startsWith('/v2/smartmoney/positions?')) return {data: {
      meta: {source: 'wallet', data_mode: 'provider_snapshot', data_provider: 'gmgn', as_of: '2026-08-01T00:00:00Z', coverage: 'unknown', ledger_verified: false},
      snapshot: {wallet: {open: [{chain: 'bsc', token_address: '0xtoken', symbol: 'TOKEN', balance: '0.000000000000000001'}], closed: []}},
    }};
    throw new Error(`Unexpected source read: ${path}`);
  });
  render(<SWRConfig value={{provider: () => new Map()}}><SmartMoneySourcePanels route={route} /></SWRConfig>);
  await waitFor(() => expect(callMock.mock.calls.some(([path]) => path ===
    '/v2/smartmoney/positions?identity.type=wallet&identity.namespace=evm&identity.address=0xabc&chain=bsc')).toBe(true));
  expect(screen.getByRole('button', {name: 'bsc'}).getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByText('0.000000000000000001', {exact: false})).toBeTruthy();
});

function renderSourceFixture(open: unknown[], windows: unknown[], accounting?: Record<string, unknown>) {
  const route = parseSmartMoneyIdentityRoute('/smart-money', new URLSearchParams('subject_id=subject:119'));
  if (route.status !== 'subject') throw new Error('subject');
  const meta = {source: 'fomo', data_mode: 'provider_snapshot', data_provider: 'fomo_profile_ledger', coverage: 'partial', as_of: '2026-10-08T11:23:16Z', ledger_verified: false, accounting};
  callMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/capabilities')) return {data: {protocol_version: '2', epoch: 'provider-snapshot-v1', supported_chains: ['solana'], surfaces: Object.fromEntries(['positions', 'pnl'].map(key => [key, {enabled: true, state: 'ready', reason: 'data_mode=provider_snapshot;ledger_verified=false', poll_after_ms: 0}]))}};
    if (path.startsWith('/v2/smartmoney/positions?')) return {data: {meta, snapshot: {user: {open, closed: []}}}};
    if (path.startsWith('/v2/smartmoney/pnl?')) return {data: {meta, windows}};
    throw new Error(path);
  });
  render(<SWRConfig value={{provider: () => new Map()}}><SmartMoneySourcePanels route={route} /></SWRConfig>);
}

it('keeps old source quantity when protobuf emits empty new fields', async () => {
  renderSourceFixture([{symbol: 'LEGACY', balance: '123.456', position_quantity: '', balance_quantity: ''}], []);
  expect(await screen.findByText('数量 123.456')).toBeTruthy();
  expect(screen.queryByText(/盈亏仓位数量/)).toBeNull();
  expect(screen.queryByText(/余额数量/)).toBeNull();
});

it('preserves authoritative ALL, balance/performance distinction, warmup and pending provenance', async () => {
  const accounting = {method: 'source_snapshot', total_status: 'partial', decomposition_status: 'partial', continuation_status: 'pending_replay', as_of: '2026-10-08T11:23:16Z', balance_as_of: '2026-10-08T11:20:00Z', stale: true, current_round_realized: '10.3918', realized_since_baseline: '0', other_account_baseline: '162090.99953871226', perpetual_baseline: '0'};
  renderSourceFixture([{symbol: 'SOL', position_quantity: '0.0783464', balance_quantity: '0.0757309', balance_market_value: '8.5939206743961802', usd_value: '8.8907268595053392', total_profit: '0.8720511659053392', position_pnl_basis: 'baseline_current_round_plus_since_baseline', current_round_realized: '0', realized_since_baseline: '0'}], [
    {window: 'all', total_profit_usd: '399268.43760006993517281991', realized_profit_usd: '', unrealized_profit_usd: '237167.04626135767517281991', coverage: 'partial', as_of: accounting.as_of, accounting},
    {window: '7d', total_profit_usd: '', realized_profit_usd: '0', unrealized_profit_usd: '', coverage: 'partial', accounting: {...accounting, window_status: 'warming_up', since_baseline_total: '13.5', effective_from: '2026-10-08T11:00:00Z'}},
  ], accounting);
  expect(await screen.findByText('总收益 $399268.43760006993517281991')).toBeTruthy();
  for (const text of ['总收益 —', '盈亏仓位数量 0.0783464', '盈亏仓位估值 $8.8907268595053392']) expect(screen.getByText(text)).toBeTruthy();
  for (const pattern of [/完整历史已实现 —/, /接入以来收益 \$13.5；开始时间/, /余额数量 0.0757309 · 余额估值 \$8.5939206743961802/, /162090.99953871226（归属未拆分，不是历史已实现）/]) expect(screen.getByText(pattern)).toBeTruthy();
  for (const pattern of [/身份来源：FOMO · 数据提供方：FOMO_PROFILE_LEDGER/, /余额观测时间：2026-10-08T11:20:00Z/, /当前展示保留时点的数据，最新结果待核对。/]) expect(screen.getAllByText(pattern).length).toBeGreaterThan(0);
});
