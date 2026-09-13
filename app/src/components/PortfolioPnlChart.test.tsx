// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PortfolioPnlChart} from './PortfolioPnlChart';
import type {PortfolioPnl} from '@/api/portfolio';
import {ApiError} from '@/api/envelope';
import {SWRConfig} from 'swr';
const {balanceMock} = vi.hoisted(() => ({balanceMock: vi.fn()}));
vi.mock('@/api/portfolio', async (load) => ({...await load<typeof import('@/api/portfolio')>(), getPortfolioBalanceCurve: balanceMock}));
const pnl: PortfolioPnl = {
  d1: {amount_usd: '5', baseline_as_of: '2026-09-07T23:00:00Z', curve: [{at: '2026-09-09T00:00:00Z', pnl_usd: '-2'}, {at: '2026-09-09T01:00:00Z', pnl_usd: '5'}]},
  d7: {amount_usd: '-7', baseline_as_of: '2026-09-02T00:00:00Z', curve: [{at: '2026-09-09T00:00:00Z', pnl_usd: '-7'}], simulated: true},
  all_usd: '20',
};
const props = {pnl, loading: false, refreshing: false, stale: false, onRefresh: vi.fn()};
describe('Portfolio PnL chart', () => {
  it('shows balance history independently when current assets and PnL are unavailable', () => {
    render(<PortfolioPnlChart {...props} pnl={undefined} balance={{d1: {curve: [{at: '2026-09-09T00:00:00Z', balance_usd: '123.45'}], simulated: false}}} />);
    fireEvent.click(screen.getByRole('button', {name: 'Total assets'}));
    expect(screen.getByRole('img')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', {name: 'PnL sample'}), {target: {value: '22'}});
    expect(screen.getByTestId('pnl-assets').textContent).toBe('$123.45');
    expect(screen.getByTestId('pnl-total').textContent).toBe('—');
  });
  it('uses the overview balance windows without fetching a separate curve', () => {
    render(<PortfolioPnlChart {...props} balance={{d1: {curve: [{at: '2026-09-09T00:00:00Z', balance_usd: '123.45'}], amount_usd: '999', simulated: false}}} />);
    expect(screen.getByTestId('pnl-assets').textContent).toBe('$999');
    fireEvent.change(screen.getByRole('slider', {name: 'PnL sample'}), {target: {value: '22'}});
    expect(screen.getByTestId('pnl-assets').textContent).toBe('$123.45');
    fireEvent.click(screen.getByRole('button', {name: '7D'}));
    expect(screen.getByTestId('pnl-assets').textContent).toBe('—');
    expect(balanceMock).not.toHaveBeenCalled();
  });
  beforeEach(() => {vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-09T01:04:00Z'));});
  afterEach(() => vi.restoreAllMocks());
  it('uses a fluid SVG without a minimum width or a scrolling chart region', () => {
    const curve = Array.from({length: 100}, (_, i) => ({at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), pnl_usd: String(i)}));
    render(<PortfolioPnlChart {...props} pnl={{all: {amount_usd: '99', curve}}} />);
    fireEvent.click(screen.getByRole('button', {name: 'All'}));
    expect(screen.getAllByTestId('pnl-tick')).toHaveLength(101);
    expect(screen.getByRole('img').getAttribute('style')).toBeNull();
    expect(screen.getByRole('img').getAttribute('viewBox')).toBe('0 0 960 300');
    expect(screen.getByRole('region', {name: 'PnL samples chart'}).className).not.toContain('overflow-x-auto');
    expect(screen.getAllByTestId('pnl-tick').at(-1)?.textContent).toContain('NOW');
    expect(screen.getByTestId('pnl-sample').textContent).toBe('$99');
  });
  afterEach(cleanup);
  it('switches windows and shows the true baseline, negative returns, simulation and unavailable history', () => {
    render(<PortfolioPnlChart {...props} />);
    expect(screen.getByTestId('pnl-total').textContent).toBe('$5');
    expect(screen.getByText(/since 2026-09-08 07:00:00 UTC/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '7D'}));
    expect(screen.getByTestId('pnl-total').textContent).toBe('$-7');
    expect(screen.getByText('Includes simulated data')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: '30D'}));
    expect(screen.getByTestId('pnl-total').textContent).toBe('—');
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'All'}));
    expect(screen.getByTestId('pnl-total').textContent).toBe('$20');
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('explores exact sample values and resets selection on period changes', () => {
    render(<PortfolioPnlChart {...props} />);
    fireEvent.change(screen.getByRole('slider', {name: 'PnL sample'}), {target: {value: '22'}});
    expect(screen.getByTestId('pnl-sample').textContent).toBe('$-2');
    fireEvent.click(screen.getByRole('button', {name: '7D'}));
    expect(screen.getAllByTestId('pnl-tick')).toHaveLength(43);
    expect(screen.getByTestId('pnl-sample').textContent).toBe('$-7');
  });
  it('shows loading and stale snapshots distinctly, and uses the parent refresh action', () => {
    const refresh = vi.fn();
    const view = render(<PortfolioPnlChart {...props} loading onRefresh={refresh} />);
    expect(screen.getByText('Loading PnL history…')).toBeTruthy();
    expect((screen.getByRole('button', {name: 'Refresh PnL'}) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<PortfolioPnlChart {...props} stale onRefresh={refresh} />);
    expect(screen.getByText(/last available PnL snapshot/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Refresh PnL'}));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('renders 24 whole hours plus NOW with NOW last and one continuous line', () => {
    const curve = [0, 1].map((hour) => ({at: `2026-09-09T0${hour}:00:00Z`, pnl_usd: '0'}));
    render(<PortfolioPnlChart {...props} pnl={{d1: {amount_usd: '0', curve}}} />);
    expect(screen.getByTestId('pnl-total').textContent).toBe('$0');
    expect(screen.getAllByTestId('pnl-segment')).toHaveLength(1);
    expect(screen.getAllByTestId('pnl-tick')).toHaveLength(25);
    expect(screen.getAllByTestId('pnl-tick').at(-1)?.textContent).toContain('NOW');
    expect(screen.getByTestId('pnl-segment').getAttribute('points')?.split(' ')).toHaveLength(curve.length + 1);
    expect(screen.queryByText(/history is unavailable/)).toBeNull();
  });
  it('discards the old account selection and samples when the parent account key changes', () => {
    const view = render(<PortfolioPnlChart key="A" {...props} />);
    fireEvent.click(screen.getByRole('button', {name: '7D'}));
    view.rerender(<PortfolioPnlChart key="B" {...props} pnl={undefined} loading />);
    expect(screen.queryByTestId('pnl-sample')).toBeNull();
    expect(screen.getByRole('button', {name: '24H'}).getAttribute('aria-pressed')).toBe('true');
  });
});
