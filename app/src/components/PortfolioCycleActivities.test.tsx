// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/envelope';
const {read} = vi.hoisted(() => ({read: vi.fn()}));
vi.mock('@/api/user-portfolio', () => ({getUserPortfolioPosition: read}));
vi.mock('@/components/PortfolioActivity', () => ({TradeRow: ({trade}: {trade: {trade_id: string}}) => <tr><td>{trade.trade_id}</td></tr>}));
import {PortfolioCycleTrades} from './PortfolioCycles';

const scope = {chain: 'bsc', asset: 'USDT', cycle_key: 'cycle'};
const sell = {record_id: 'sell', side: 'sell', created_at: '2026-10-20T03:08:00Z', cycle_key: 'cycle', token_amount: '500', trade_value_usd: '498.433295', execution_price_usd: '0.99686659', time_basis: 'trade_confirmation', occurred_at: {seconds: 1792465689}};
const transfer = {record_id: 'transfer', side: 'transfer_in', created_at: '2026-10-20T03:01:30Z', cycle_key: 'cycle', token_amount: '500', trade_value_usd: '499.349887', execution_price_usd: '0.998699774', tx_hash: '0xabc', tx_chain: 'bsc', time_basis: 'transfer_time', occurred_at: {seconds: 1792465290}};
const page = (activities: unknown[], cursor = '') => ({status: 'closed', position: {symbol: 'USDT', realized_pnl_usd: '-0.916592'}, trades: [{trade_id: 'legacy-sell'}], activities_status: 'complete', activities, next_activity_cursor: cursor});
const panel = (cycle = 'cycle') => <PortfolioCycleTrades key={cycle} bearer="jwt" userIdentifier="user" scope={{...scope, cycle_key: cycle}} onClose={() => {}} />;
beforeEach(() => {read.mockReset();});
afterEach(cleanup);

it('paginates, deduplicates activities and never appends legacy trades', async () => {
  read.mockResolvedValueOnce(page([sell], 'cursor+/=')).mockResolvedValueOnce(page([sell, transfer]));
  render(panel());
  fireEvent.click(await screen.findByText('Load more activity'));
  await screen.findByText('Reference acquisition cost');
  expect(screen.queryByText('legacy-sell')).toBeNull();
  expect(screen.getAllByText('Sell')).toHaveLength(1);
  expect(screen.getByText('$499.349887')).toBeTruthy();
  expect(screen.getByText('History · 2 loaded')).toBeTruthy();
  expect(screen.getByText(new Date('2026-10-20T03:08:00Z').toLocaleString())).toBeTruthy();
  expect(screen.getByText('View transaction').getAttribute('href')).toBe('https://bscscan.com/tx/0xabc');
  expect(read.mock.calls[1][4]).toEqual({cursor: 'cursor+/='});
  expect(screen.queryByText('Load more activity')).toBeNull();
  fireEvent.click(screen.getByText('Refresh cycle'));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read.mock.calls[2][4]).toEqual({cursor: undefined});
});

it('shows missing valuation and observation time without fabricating amounts or links', async () => {
  read.mockResolvedValue(page([{...transfer, side: 'transfer_in', trade_value_usd: undefined, execution_price_usd: undefined, token_amount: undefined, tx_hash: undefined, time_basis: 'observed_time'}]));
  render(panel());
  await screen.findByText('Valuation pending');
  expect(screen.getByText('Observed time')).toBeTruthy();
  expect(screen.getByText('Transfer in')).toBeTruthy();
  expect(screen.getByText('On-chain balance sync')).toBeTruthy();
  expect(screen.getByText('Quantity unavailable')).toBeTruthy();
  expect(screen.queryByText('View transaction')).toBeNull();
  expect(screen.queryByText('$0')).toBeNull();
});

it.each(['unavailable', undefined])('falls back exclusively to legacy trades when status is %s', async status => {
  read.mockResolvedValue({...page([transfer], 'stale'), activities_status: status});
  render(panel());
  await screen.findByText('legacy-sell');
  expect(screen.getByText(/activity history is incomplete/)).toBeTruthy();
  expect(screen.queryByText('Reference acquisition cost')).toBeNull();
  expect(screen.queryByText('Load more activity')).toBeNull();
});

it('discards expired history and retries the first page only once', async () => {
  read.mockResolvedValueOnce(page([sell], 'expired'))
    .mockRejectedValueOnce(new ApiError('business', 430122, 'Expired'))
    .mockResolvedValueOnce(page([transfer]));
  render(panel());
  fireEvent.click(await screen.findByText('Load more activity'));
  await screen.findByText('Transfer in');
  expect(screen.queryByText('Sell')).toBeNull();
  expect(read.mock.calls[2][4]).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(3);
});

it('preserves loaded rows after a network failure and retries the failed cursor', async () => {
  read.mockResolvedValueOnce(page([sell], 'next')).mockRejectedValueOnce(new Error('Network failure')).mockResolvedValueOnce(page([transfer]));
  render(panel()); fireEvent.click(await screen.findByText('Load more activity'));
  await screen.findByText('Network failure');
  expect(screen.getByText('Sell')).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  await screen.findByText('Transfer in');
  expect(read.mock.calls[2][4]).toEqual({cursor: 'next'});
});

it('ignores a late response after changing cycle', async () => {
  let resolve!: (data: unknown) => void;
  read.mockImplementationOnce(() => new Promise(done => {resolve = done;})).mockResolvedValueOnce(page([transfer]));
  const view = render(panel()); view.rerender(panel('other'));
  await screen.findByText('Transfer in');
  resolve(page([sell]));
  await waitFor(() => expect(screen.queryByText('Sell')).toBeNull());
  expect(read.mock.calls[0][3].aborted).toBe(true);
});

it('keeps displayed rows if refresh fails, then replaces them with a fresh first page', async () => {
  read.mockResolvedValueOnce(page([sell], 'old')).mockRejectedValueOnce(new Error('Refresh failed')).mockResolvedValueOnce(page([transfer]));
  render(panel()); await screen.findByText('Sell');
  fireEvent.click(screen.getByText('Refresh cycle'));
  await screen.findByText('Refresh failed');
  expect(screen.getByText('Sell')).toBeTruthy();
  fireEvent.click(screen.getByText('Retry'));
  await screen.findByText('Transfer in');
  expect(screen.queryByText('Sell')).toBeNull();
});

it('stops automatic recovery when the new first page also reports expiry', async () => {
  read.mockResolvedValueOnce(page([sell], 'expired')).mockRejectedValue(new ApiError('business', 430122, 'Expired again'));
  render(panel()); fireEvent.click(await screen.findByText('Load more activity'));
  await screen.findByText('Expired again');
  expect(screen.queryByText('Sell')).toBeNull();
  expect(read).toHaveBeenCalledTimes(3);
});
