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

  it('continues through short and empty pages using hasMore rather than page length', async () => {
    fetchBoardMock.mockReset();
    const alice = {side: 'buy', occurredAt: 1789616411, recordID: 'a', actorID: 'u1', user: {identifier: 'u1', nickname: 'Alice'}};
    const bob = {side: 'sell', occurredAt: 1789616400, recordID: 'b', actorID: 'u2', user: {identifier: 'u2', nickname: 'Bob'}};
    fetchBoardMock.mockResolvedValueOnce({...page([alice]), hasMore: true, nextCursor: 'c1'})
      .mockResolvedValueOnce({...page([]), hasMore: true, nextCursor: 'c2'})
      .mockResolvedValueOnce({...page([alice, bob]), hasMore: false});
    renderTab();
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));
    await waitFor(() => expect(fetchBoardMock.mock.calls[1][3].cursor).toBe('c1'));
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByText('Alice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));
    await screen.findByText('Bob');
    expect(fetchBoardMock.mock.calls[2][3].cursor).toBe('c2');
    expect(screen.getAllByText('Alice')).toHaveLength(1);
    expect(screen.queryByRole('button', {name: 'Load more'})).toBeNull();
    expect(screen.getByText('End of available history')).toBeTruthy();
  });

  it('keeps existing rows and retries the same cursor after a failed append', async () => {
    fetchBoardMock.mockReset();
    fetchBoardMock.mockResolvedValueOnce({...page([{side: 'buy', occurredAt: 1, actorID: 'u1', user: {identifier: 'u1', nickname: 'Alice'}}]), hasMore: true, nextCursor: 'retry-me'})
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({...page([]), hasMore: false});
    renderTab(); await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));
    await screen.findByText('Could not load trades right now.');
    expect(screen.getByText('Alice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    await screen.findByText('End of available history');
    expect(fetchBoardMock.mock.calls.slice(1).map(call => call[3].cursor)).toEqual(['retry-me', 'retry-me']);
  });

  it('aborts an old append and never mixes its response into another token', async () => {
    let finish!: (value: unknown) => void;
    fetchBoardMock.mockImplementation((_source, _chain, address, options) => options.cursor
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({...page([{side: 'buy', occurredAt: 1, actorID: address, user: {identifier: address, nickname: address}}]), hasMore: true, nextCursor: 'old-cursor'}));
    const view = renderTab(); await screen.findByText('0xabc');
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const signal = fetchBoardMock.mock.calls[1][3].signal as AbortSignal;
    view.rerender(<SWRConfig value={{provider: () => new Map()}}><TradesTab chain="bsc" address="0xdef" /></SWRConfig>);
    await screen.findByText('0xdef');
    expect(signal.aborted).toBe(true);
    finish({...page([{side: 'sell', occurredAt: 1, user: {identifier: 'stale', nickname: 'Stale response'}}]), hasMore: false});
    await waitFor(() => expect(screen.queryByText('Stale response')).toBeNull());
    expect(screen.queryByText('0xabc')).toBeNull();
  });

  it('rejects a nonadvancing cursor and preserves the rows for refresh', async () => {
    const result = {...page([{side: 'buy', occurredAt: 1, actorID: 'u1', user: {identifier: 'u1', nickname: 'Alice'}}]), hasMore: true, nextCursor: 'same'};
    fetchBoardMock.mockResolvedValue(result);
    renderTab(); await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));
    await screen.findByText('Could not load trades right now.');
    expect(screen.getAllByText('Alice')).toHaveLength(1);
    expect(screen.getByRole('button', {name: 'Refresh'})).toBeTruthy();
  });

  it('loads SmartX all trades and keeps zero strings visible', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: undefined, signal: expect.any(AbortSignal)});
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    expect(screen.getByText(/\$0\.000008481375161447344/)).toBeTruthy();
    expect(screen.getByRole('link', {name: 'Tx'}).getAttribute('href')).toBe('https://bscscan.com/tx/0xtx');
  });

  it('uses dedicated smart-money and on-chain sources instead of filtering sender locally', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', {name: 'Smart Money'}));
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('smart-money', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: undefined, signal: expect.any(AbortSignal)}));
    fireEvent.click(screen.getByRole('tab', {name: 'On-Chain'}));
    await waitFor(() => expect(screen.getAllByText('0xwallet').length).toBeGreaterThan(0));
    expect(fetchOnChainMock).toHaveBeenCalledWith('bsc', '0xabc', 50);
  });

  it('renders the resolved profile together with the executing wallet', async () => {
    const address = '0x000000000000000000000000000000000000000a';
    fetchBoardMock.mockResolvedValue(page([{side: 'buy', occurredAt: 1789616411, actorType: 'smart_money', actorID: address, actor: {identity: {type: 'wallet', namespace: 'evm', address}, name: 'Jack', avatarURL: 'https://static.smartx.io/jack.png', wallets: [{type: 'wallet', namespace: 'evm', address}], following: true, followingPrimary: true, followedSubjects: [{type: 'wallet', namespace: 'evm', address}]}}]));
    renderTab();
    fireEvent.click(screen.getByRole('tab', {name: 'Smart Money'}));
    expect(await screen.findByText('Jack')).toBeTruthy();
    expect(screen.getByText(address)).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://static.smartx.io/jack.png');
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
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'following', limit: 50, bearer: 'jwt-a', signal: expect.any(AbortSignal)}));

    sessionMock.mockReturnValue({jwt: 'jwt-b', user: null, meta: null});
    view.rerender(<SWRConfig value={{provider: () => new Map()}}><TradesTab chain="bsc" address="0xabc" /></SWRConfig>);
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'following', limit: 50, bearer: 'jwt-b', signal: expect.any(AbortSignal)}));
  });

  it('isolates personalized All trade metadata when switching accounts and logging out', async () => {
    sessionMock.mockReturnValue({jwt: 'jwt-a'});
    const cache = new Map();
    const element = () => <SWRConfig value={{provider: () => cache}}><TradesTab chain="bsc" address="0xabc" /></SWRConfig>;
    const view = render(element());
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: 'jwt-a', signal: expect.any(AbortSignal)}));
    sessionMock.mockReturnValue({jwt: 'jwt-b'}); view.rerender(element());
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: 'jwt-b', signal: expect.any(AbortSignal)}));
    sessionMock.mockReturnValue(null); view.rerender(element());
    await waitFor(() => expect(fetchBoardMock).toHaveBeenCalledWith('platform', 'bsc', '0xabc', {scope: 'all', limit: 50, bearer: undefined, signal: expect.any(AbortSignal)}));
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
