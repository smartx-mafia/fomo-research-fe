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
