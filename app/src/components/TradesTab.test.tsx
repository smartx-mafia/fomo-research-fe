// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchBoardMock, fetchOnChainMock, sessionMock } = vi.hoisted(() => ({
  fetchBoardMock: vi.fn(),
  fetchOnChainMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock('@/api/token-trade-boards', () => ({
  fetchTokenTradeBoard: fetchBoardMock,
}));
vi.mock('@/lib/market', async (original) => ({
  ...await original<typeof import('@/lib/market')>(),
  fetchOnChainTradeBoard: fetchOnChainMock,
}));
vi.mock('@/session/storage', () => ({
  useSession: sessionMock,
}));

import TradesTab from './TradesTab';

const token = {chain: 'bsc', address: '0xabc', decimals: 18, symbol: 'ABC', is_verify: false};

function page(items: unknown[] = [], coverage: string[] = []) {
  return {token, items, coverage};
}

function renderTab() {
  return render(<SWRConfig value={{provider: () => new Map()}}><TradesTab chain="bsc" address="0xabc" /></SWRConfig>);
}

describe('TradesTab token trade boards', () => {
  beforeEach(() => {
    fetchBoardMock.mockReset();
    fetchOnChainMock.mockReset();
    sessionMock.mockReturnValue(null);
    fetchBoardMock.mockResolvedValue(page([{
      side: 'buy', occurredAt: 1789616411, tokenAmount: '0', usd: '0', executionPriceUSD: '0.000008481375161447344',
      txHash: '0xtx', actorType: 'user', actorID: 'u1', user: {identifier: 'u1', nickname: 'Alice'},
    }]));
    fetchOnChainMock.mockResolvedValue(page([{
      side: 'sell', occurredAt: 1789616411, tokenAmount: '1.25', usd: 2.5, executionPriceUSD: 2,
      marketCapUSDEstimated: '1000000', txHash: '0xtx', sender: '0xwallet',
    }]));
  });

  afterEach(() => cleanup());

  it('loads SmartX all trades and keeps zero strings visible', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: undefined});
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    expect(screen.getByText(/\$0\.000008481375161447344/)).toBeTruthy();
    expect(screen.getByRole('link', {name: 'Tx'}).getAttribute('href')).toBe('https://bscscan.com/tx/0xtx');
  });

  it('uses dedicated smart-money and on-chain sources instead of filtering sender locally', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', {name: 'Smart Money'}));
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('smart-money', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: undefined}));
    fireEvent.click(screen.getByRole('tab', {name: 'On-Chain'}));
    await waitFor(() => expect(screen.getAllByText('0xwallet').length).toBeGreaterThan(0));
    expect(fetchOnChainMock).toHaveBeenCalledWith('bsc', '0xabc', 50);
  });

  it('does not request following trades anonymously and presents coverage separately from errors', async () => {
    fetchBoardMock.mockImplementation((source: string) => Promise.resolve(source === 'smart-money' ? page([], ['gmgn_not_configured']) : page([])));
    renderTab();
    fireEvent.click(screen.getByRole('tab', {name: 'Smart Money'}));
    await waitFor(() => expect(screen.getByText('Partial source result')).toBeTruthy());
    expect(screen.getByText(/GMGN is not configured/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Following'}));
    expect(screen.getByText('Sign in to see trades from people you follow.')).toBeTruthy();
    expect(fetchBoardMock).toHaveBeenCalledTimes(2);
  });

  it('passes an authenticated following scope and refreshes when the account changes', async () => {
    sessionMock.mockReturnValue({jwt: 'jwt-a', user: null, meta: null});
    const view = renderTab();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', {name: 'Following'}));
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'following', limit: 50, bearer: 'jwt-a'}));

    sessionMock.mockReturnValue({jwt: 'jwt-b', user: null, meta: null});
    view.rerender(<SWRConfig value={{provider: () => new Map()}}><TradesTab chain="bsc" address="0xabc" /></SWRConfig>);
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'following', limit: 50, bearer: 'jwt-b'}));
  });

  it('hides an endpoint error, keeps the empty state out of the UI, and retries explicitly', async () => {
    fetchBoardMock.mockReset();
    fetchBoardMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([{side: 'buy', occurredAt: 1789616411, usd: '1', actorType: 'user', actorID: 'u1', user: {identifier: 'u1', nickname: 'Alice'}}]));
    renderTab();
    await waitFor(() => expect(screen.getByText('Could not load trades right now.')).toBeTruthy());
    expect(screen.queryByText('No SmartX trades found.')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    expect(fetchBoardMock).toHaveBeenCalledTimes(2);
  });
});
