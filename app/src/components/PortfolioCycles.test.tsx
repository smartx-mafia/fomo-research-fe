// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {SWRConfig} from 'swr';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {normalizePortfolio, type PortfolioTradePage} from '@/api/portfolio';
const {control} = vi.hoisted(() => ({control: {jwt: 'A', portfolio: vi.fn(), closed: vi.fn(), trades: vi.fn()}}));
vi.mock('@/api/portfolio', async (load) => ({...await load<typeof import('@/api/portfolio')>(), getPortfolio: control.portfolio, getClosedPortfolioPositions: control.closed, getPortfolioCycleTrades: control.trades}));
vi.mock('@/session/storage', () => ({useSession: () => ({jwt: control.jwt}), clearSite: vi.fn(), readSite: () => ({jwt: control.jwt})}));
vi.mock('@/components/PortfolioActivity', () => ({PortfolioActivity: () => null, TradeRow: ({trade}: {trade: {trade_id: string}}) => <tr><td>{trade.trade_id}</td></tr>}));
vi.mock('@/components/OpinionComposer', () => ({OpinionComposer: () => null}));
import {PortfolioView} from './PortfolioView';
const asset = {chain: 'solana', chain_id: '792703809', kind: 'spl', token_address: 'MintA'};
const closed = (id: string) => ({asset, symbol: 'CLOSED', opened_entry_id: id, closed_entry_id: '99', status: 'closed' as const, decimals: 0, realized_pnl_usd: '5', pnl_ratio: '0.25'});
describe('Holding cycle navigation', () => {
  let element: HTMLDivElement, root: Root, cache: Map<string, never>;
  beforeEach(() => {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    control.jwt = 'A'; control.portfolio.mockReset(); control.closed.mockReset(); control.trades.mockReset();
    control.portfolio.mockResolvedValue(normalizePortfolio({positions: [{asset, symbol: 'OPEN', shares_raw: '1', opened_entry_id: '10', cycle_status: 'ready'}]}));
    control.closed.mockResolvedValue({items: [closed('2'), closed('3')]});
    control.trades.mockResolvedValue({trades: []});
    element = document.createElement('div'); document.body.append(element); root = createRoot(element); cache = new Map<string, never>();
  });
  afterEach(async () => {await act(async () => root.unmount()); element.remove();});
  const render = () => act(async () => root.render(<SWRConfig value={{provider: () => cache, dedupingInterval: 0}}><PortfolioView /></SWRConfig>));
  const click = (label: string, index = 0) => act(async () => [...element.querySelectorAll('button')].filter((button) => button.textContent === label)[index]!.click());
  it('opens exact current and closed cycles, keeps repeated tokens separate and resets pagination', async () => {
    control.trades.mockImplementation((_jwt, scope, cursor) => Promise.resolve(scope.opened_entry_id === '10' && cursor === '0' ? {trades: [{trade_id: 'open-trade'}], next_cursor: '50'} : {trades: []}));
    await render();
    expect(element.textContent).toContain('25%');
    expect(element.querySelectorAll('section[aria-label="Closed positions"] tbody tr')).toHaveLength(2);
    await click('Cycle trades', 0);
    expect(control.trades).toHaveBeenLastCalledWith('A', {chain: 'solana', asset: 'MintA', opened_entry_id: '10'}, '0');
    await click('Load more cycle trades');
    expect(control.trades.mock.calls.some((args) => args[2] === '50')).toBe(true);
    await click('Cycle trades', 2);
    expect(control.trades).toHaveBeenLastCalledWith('A', {chain: 'solana', asset: 'MintA', opened_entry_id: '3'}, '0');
    expect(element.querySelector('section[aria-label="Holding cycle trades"]')?.textContent).not.toContain('open-trade');
  });
  it('disables a pending current cycle but still loads closed positions', async () => {
    control.portfolio.mockResolvedValue(normalizePortfolio({positions: [{asset, shares_raw: '1', opened_entry_id: 0, cycle_status: 'pending'}]}));
    await render();
    const button = [...element.querySelectorAll('button')].find((button) => button.textContent === 'Cycle trades')!;
    expect(button.disabled).toBe(true);
    expect(element.textContent).toContain('CLOSED');
  });
  it('does not show a failed history request as an empty closed portfolio', async () => {
    control.closed.mockRejectedValue(new Error('History unavailable'));
    await render();
    expect(element.textContent).toContain('History unavailable');
    expect(element.textContent).not.toContain('No closed holding cycles');
  });
  it('drops selected cycle and closed data on account change, ignoring late responses', async () => {
    let resolve!: (value: PortfolioTradePage) => void;
    control.trades.mockImplementation(() => new Promise<PortfolioTradePage>((done) => {resolve = done;}));
    await render(); await click('Cycle trades');
    control.jwt = 'B'; control.closed.mockImplementation(() => new Promise(() => {}));
    await render();
    await act(async () => resolve({trades: [{trade_id: 'old-account-trade'}] as PortfolioTradePage['trades']}));
    expect(element.textContent).not.toContain('Holding cycle trades');
    expect(element.textContent).not.toContain('CLOSED');
    expect(element.textContent).not.toContain('old-account-trade');
  });
  it('paginates closed cycles with the opaque cursor', async () => {
    control.closed.mockImplementation((_jwt, cursor) => Promise.resolve(cursor === '' ? {items: [closed('2')], next_cursor: 'opaque+/='} : {items: [closed('3')]}));
    await render(); await click('Load more closed');
    expect(control.closed.mock.calls.some((args) => args[1] === 'opaque+/=')).toBe(true);
  });
});
