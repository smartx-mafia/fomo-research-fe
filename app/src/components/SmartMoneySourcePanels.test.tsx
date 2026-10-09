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

it('offers only GMGN source-proven chains and account ALL while keeping actions chain-specific', async () => {
  const {fireEvent} = await import('@testing-library/react');
  const refs = [{chain:'bsc',window:'all'},{chain:'eth',window:'all'}];
  const accounting = {source:'gmgn',generation_id:'g1',publication_revision:'1',method:'source_snapshot',source_references:refs,total_status:'source_available'};
  const meta = {source:'gmgn',data_mode:'provider_snapshot',data_provider:'gmgn_baseline_ledger',coverage:'partial',ledger_verified:false,as_of:'2026-10-09T00:00:00Z',accounting};
  const ready = {enabled:true,state:'ready',reason:'data_mode=provider_snapshot;ledger_verified=false',poll_after_ms:30000};
  callMock.mockImplementation(async (path:string) => {
    if(path === '/v2/smartmoney/capabilities') return {data:{protocol_version:'2',epoch:'provider-snapshot-v1',supported_chains:['base','bsc','ethereum','robinhood'],surfaces:{positions:ready,pnl:ready,actions:ready}}};
    const q = new URL(path,'https://test.invalid').searchParams;
    if(path.startsWith('/v2/smartmoney/pnl?')) return {data:{meta,windows:[
      {window:'all',total_profit_usd:q.get('chain') === 'all' ? '9007199254740993.123456789' : '42',realized_profit_usd:'123',unrealized_profit_usd:'456',accounting},
      {window:'7d',total_profit_usd:'',realized_profit_usd:'0',unrealized_profit_usd:'0',accounting:{...accounting,window_status:'warming_up',effective_from:'2026-10-09T00:00:00Z',since_baseline_total:'0'}},
    ],daily_windows:[]}};
    if(path.startsWith('/v2/smartmoney/positions?')) return {data:{meta,snapshot:{wallet:{open:[{token_address:'native',chain:q.get('chain'),balance:'1.2',balance_quantity:'1.2',position_quantity:'',asset_role:'native_observation',performance_included:false,accu_cost:null,cost:'333',usd_value:null}],closed:[]}}}};
    if(path.startsWith('/v2/smartmoney/actions?')) return {data:{meta,classification:'provider_reported',snapshot:{list:[],next_cursor:''}}};
    throw new Error(path);
  });
  render(<SWRConfig value={{provider:()=>new Map()}}><SmartMoneySourcePanels route={{status:'wallet',namespace:'evm',walletAddress:'0xabc',sourceChain:'bsc'}} /></SWRConfig>);
  const all = await screen.findByRole('button',{name:'全部已纳入链'});
  expect(screen.queryByRole('button',{name:'base'})).toBeNull();
  expect(screen.queryByRole('button',{name:'robinhood'})).toBeNull();
  expect(screen.getByRole('button',{name:'ethereum'})).toBeTruthy();
  fireEvent.click(all);
  expect(await screen.findByText('总收益 $9007199254740993.123456789')).toBeTruthy();
  expect(screen.getByText('原生余额观察 · 未计入绩效')).toBeTruthy();
  expect(screen.getByText('成本 —')).toBeTruthy();
  expect(screen.queryByText(/\$333/)).toBeNull();
  expect(screen.getByText('总收益 —')).toBeTruthy();
  expect(screen.getByText('尚未发布每日收益，不代表每日收益为零。')).toBeTruthy();
  expect(callMock.mock.calls.some(([path])=>path.startsWith('/v2/smartmoney/actions?') && path.includes('chain=all'))).toBe(false);
  expect(callMock.mock.calls.filter(([path])=>path.startsWith('/v2/smartmoney/pnl?') && path.includes('chain=bsc'))).toHaveLength(1);
});
