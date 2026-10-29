// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, cleanup} from '@testing-library/react';
import {SWRConfig} from 'swr';
const {fetchMock, session} = vi.hoisted(() => ({fetchMock: vi.fn(), session: {value: null as null | {jwt: string}}}));
vi.mock('@/api/token-holder-list', () => ({fetchHolderList: fetchMock, fetchFollowedHolderList: fetchMock}));
vi.mock('@/session/storage', () => ({useSession: () => session.value}));
import HoldersTab from './HoldersTab';
import {ApiError} from '@/api/envelope';
const wrap = (chain = 'bsc', address = 'coin') => <SWRConfig value={{provider: () => new Map(), dedupingInterval: 0}}><HoldersTab chain={chain} address={address} /></SWRConfig>;
beforeEach(() => {cleanup();fetchMock.mockReset();session.value = null;fetchMock.mockResolvedValue({items: [], total: 0, totalIsExact: true, coverage: []});});
describe('unified holders UI', () => {
  it('selects backend sources instead of filtering an onchain slice', async () => {
    render(wrap());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('bsc', 'coin', expect.objectContaining({source: 'smartx', scope: 'all'})));
    fireEvent.click(screen.getByRole('tab', {name: 'Smart Money'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('bsc', 'coin', expect.objectContaining({source: 'smart_money', scope: 'all'})));
    fireEvent.click(screen.getByRole('tab', {name: 'Followed'}));
    expect(screen.getByRole('link', {name: 'Sign in'})).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => c[2]?.scope === 'following')).toBe(false);
  });
  it('requests all followed identity types with the current session', async () => {
    session.value = {jwt: 'jwt-a'};
    render(wrap());fireEvent.click(screen.getByRole('tab', {name: 'Followed'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('bsc', 'coin', {source: 'all', scope: 'following', bearer: 'jwt-a', cursor: ''}));
  });
  it('restarts from a fresh first page when revisiting a source', async () => {
    render(wrap());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', {name: 'Smart Money'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('tab', {name: 'SmartX'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
  it('drops old pages after cursor expiration and reloads the first page', async () => {
    fetchMock.mockImplementation((_c, _a, opts) => opts.cursor ? Promise.reject(new ApiError('business', 100103, 'expired')) : Promise.resolve({items: [], total: 20, totalIsExact: true, coverage: [], nextCursor: 'c1'}));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', {name: 'Load more'}));
    expect(await screen.findByText('Holdings or follows changed. Reload this list.')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Load more'})).toBeNull();
    fetchMock.mockResolvedValue({items: [], total: 0, totalIsExact: true, coverage: []});
    fireEvent.click(screen.getByRole('button', {name: 'Reload'}));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock.mock.calls.at(-1)?.[2].cursor).toBe('');
  });
  it('uses a new request and resets the cursor when the account changes', async () => {
    session.value = {jwt: 'jwt-a'};
    const {rerender} = render(wrap());
    fireEvent.click(screen.getByRole('tab', {name: 'Followed'}));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('bsc', 'coin', expect.objectContaining({bearer: 'jwt-a', scope: 'following'})));
    session.value = {jwt: 'jwt-b'};rerender(wrap());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('bsc', 'coin', expect.objectContaining({bearer: 'jwt-b', scope: 'following', cursor: ''})));
  });

});
