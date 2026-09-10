// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {SWRConfig} from 'swr';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {normalizePortfolio, type PortfolioReply} from '@/api/portfolio';

const {control} = vi.hoisted(() => ({control: {jwt: 'A', fetch: vi.fn()}}));
vi.mock('@/api/portfolio', async (load) => ({...await load<typeof import('@/api/portfolio')>(), getPortfolio: control.fetch, getPortfolioBalanceCurve: async () => ({points: [], simulated: false})}));
vi.mock('@/session/storage', () => ({useSession: () => ({jwt: control.jwt}), clearSite: vi.fn(), readSite: () => ({jwt: control.jwt})}));
vi.mock('@/components/PortfolioActivity', () => ({PortfolioActivity: () => null}));
vi.mock('@/components/PortfolioCycles', () => ({ClosedPortfolioPositions: () => null, PortfolioCycleTrades: () => null}));
vi.mock('@/components/OpinionComposer', () => ({OpinionComposer: () => <div>Opinion dialog</div>}));
import {PortfolioView} from './PortfolioView';

function data(symbol: string): PortfolioReply {
  return normalizePortfolio({positions: [{asset: {chain: 'solana', chain_id: 792703809, kind: 'spl', token_address: 'mint-' + symbol}, symbol, shares_raw: '1000000', decimals: 6, opened_entry_id: '4', cycle_status: 'ready'}], partial_errors: []});
}

describe('Portfolio account lifecycle', () => {
  let element: HTMLDivElement, root: Root;
  let config: {provider: () => Map<string, never>};
  beforeEach(() => {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    control.jwt = 'A'; control.fetch.mockReset();
    element = document.createElement('div'); document.body.append(element); root = createRoot(element);
    const cache = new Map<string, never>(); config = {provider: () => cache};
  });
  afterEach(async () => {await act(async () => root.unmount()); element.remove();});
  const render = () => act(async () => root.render(<SWRConfig value={config}><PortfolioView /></SWRConfig>));

  it('drops old account data and open Opinion state when the session changes', async () => {
    control.fetch.mockImplementation((jwt: string) => jwt === 'A' ? Promise.resolve(data('TOKEN_A')) : new Promise(() => {}));
    await render(); expect(element.textContent).toContain('TOKEN_A');
    await act(async () => [...element.querySelectorAll('button')].find((button) => button.textContent === 'Opinion')!.click());
    expect(element.textContent).toContain('Opinion dialog');
    control.jwt = 'B'; await render();
    expect(element.textContent).not.toContain('TOKEN_A');
    expect(element.textContent).not.toContain('Opinion dialog');
  });

  it('ignores a late previous-account response', async () => {
    let resolveA!: (value: PortfolioReply) => void;
    control.fetch.mockImplementation((jwt: string) => jwt === 'A' ? new Promise<PortfolioReply>((resolve) => {resolveA = resolve;}) : Promise.resolve(data('TOKEN_B')));
    await render(); control.jwt = 'B'; await render();
    expect(element.textContent).toContain('TOKEN_B');
    await act(async () => resolveA(data('TOKEN_A')));
    expect(element.textContent).toContain('TOKEN_B');
    expect(element.textContent).not.toContain('TOKEN_A');
  });
});
