// @vitest-environment jsdom
import React, {StrictMode} from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
import type {UnifiedLeaderboardQuery, UnifiedLeaderboardReply} from '@/api/leaderboard-new';
import {ApiError} from '@/api/envelope';
const {board, meta, session} = vi.hoisted(() => ({board: vi.fn(), meta: vi.fn(), session: vi.fn()}));
vi.mock('@/api/leaderboard-new', () => ({getUnifiedLeaderboard: board, getUnifiedLeaderboardMeta: meta}));
vi.mock('@/session/storage', () => ({useSession: session}));
import {LeaderboardView} from './LeaderboardView';
import {loadLeaderboardMeta} from '@/lib/leaderboard-meta';
function data(query: UnifiedLeaderboardQuery, name = 'Trader'): UnifiedLeaderboardReply {
  const internal = query.dimension === 'SmartX';
  return {...query, updated_at: 1780000000, stale: false, count: 1, viewer_rank: 12, participant_count: 101, viewer_profit_usd: '-5', list: [{rank: 1,
    identity: internal ? {type: 'smartx_user', id: 'user-1', user_type: 1} : {type: 'external_user', id: 'subject:123', user_type: 2},
    profile: {display_name: name}, platforms: internal ? [] : ['FOMO'], dimension: internal ? 'SmartX' : 'Global', pnl_basis: 'snapshot_delta', total_profit_usd: '-12.34', snapshot_at: 1780000000, chains: [], identity_revision: 'rev',
  }]};
}
function mount() {
  const cache = new Map();
  const tree = () => <StrictMode><SWRConfig value={{provider: () => cache}}><LeaderboardView /></SWRConfig></StrictMode>;
  return {...render(tree()), tree, cache};
}
beforeEach(() => {
  localStorage.clear();
  session.mockReturnValue(null);
  meta.mockResolvedValue({windows: ['1d', '7d', '30d', 'all'], dimensions: ['ALL', 'SmartX', 'Global']});
  board.mockImplementation((query: UnifiedLeaderboardQuery) => Promise.resolve(data(query)));
});
afterEach(async () => {cleanup(); await new Promise((resolve) => setTimeout(resolve, 5)); vi.resetAllMocks();});
it('waits for meta and loads once in Strict Mode', async () => {
  let resolve!: (value: unknown) => void;
  meta.mockReturnValue(new Promise((done) => {resolve = done;}));
  mount();
  expect(board).not.toHaveBeenCalled();
  await act(async () => resolve({windows: ['7d'], dimensions: ['ALL', 'Global']}));
  expect((await screen.findByRole('link', {name: 'Trader'})).getAttribute('href')).toBe('/smart-money?subject_id=subject%3A123');
  expect(board).toHaveBeenCalledTimes(1);
  expect(board).toHaveBeenCalledWith({window: '7d', dimension: 'ALL'}, undefined, expect.any(AbortSignal));
});
it('uses fresh preloaded filters without waiting for another meta round trip', async () => {
  await loadLeaderboardMeta();
  meta.mockImplementation(() => new Promise(() => {}));
  mount();
  await screen.findByRole('link', {name: 'Trader'});
  expect(meta).toHaveBeenCalledTimes(1);
  expect(board).toHaveBeenCalledTimes(1);
});
it('refreshes cached meta after a rejected filter instead of repeatedly using it', async () => {
  await loadLeaderboardMeta();
  meta.mockResolvedValue({windows: ['all'], dimensions: ['Global']});
  board.mockRejectedValueOnce(new ApiError('business', 100109, 'invalid'));
  mount();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', {name: '重试'}));
  await screen.findByRole('link', {name: 'Trader'});
  expect(meta).toHaveBeenCalledTimes(2);
  expect(board.mock.calls[1][0]).toEqual({window: 'all', dimension: 'Global'});
  expect(board).toHaveBeenCalledTimes(2);
});
it('reads once per change and revalidates a cached filter', async () => {
  mount();
  await screen.findByRole('link', {name: 'Trader'});
  fireEvent.click(screen.getByRole('button', {name: '30D'}));
  await waitFor(() => expect(board).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', {name: '7D'}));
  await waitFor(() => expect(board).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole('button', {name: '7D'}));
  expect(board).toHaveBeenCalledTimes(3);
  expect(meta).toHaveBeenCalledTimes(1);
});
it('keeps the previous filter visible and labels it until the new response arrives', async () => {
  let settle!: (value: UnifiedLeaderboardReply) => void;
  board.mockImplementation((query: UnifiedLeaderboardQuery) => query.window === '30d'
    ? new Promise((done) => {settle = done;}) : Promise.resolve(data(query, 'Seven day trader')));
  mount();
  await screen.findByRole('link', {name: 'Seven day trader'});
  fireEvent.click(screen.getByRole('button', {name: '30D'}));
  await waitFor(() => expect(board).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('link', {name: 'Seven day trader'})).toBeTruthy();
  expect(screen.getByText(/暂时显示.*7D/)).toBeTruthy();
  await act(async () => settle(data({window: '30d', dimension: 'ALL'}, 'Thirty day trader')));
  expect(screen.getByRole('link', {name: 'Thirty day trader'})).toBeTruthy();
  expect(screen.queryByText(/暂时显示/)).toBeNull();
});
it('cancels old filters, ignores late data, and shares an in-flight refresh', async () => {
  let settle!: (value: UnifiedLeaderboardReply) => void;
  board.mockImplementation((query: UnifiedLeaderboardQuery) => query.window === '30d' ? new Promise((done) => {settle = done;}) : Promise.resolve(data(query)));
  mount();
  await screen.findByRole('link', {name: 'Trader'});
  fireEvent.click(screen.getByRole('button', {name: '30D'}));
  await waitFor(() => expect(board).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', {name: '刷新中…'}));
  await act(async () => {await Promise.resolve();});
  expect(board).toHaveBeenCalledTimes(2);
  const signal = board.mock.calls[1][2] as AbortSignal;
  fireEvent.click(screen.getByRole('button', {name: '24H'}));
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () => settle(data({window: '30d', dimension: 'ALL'}, 'Late trader')));
  expect(screen.queryByText('Late trader')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(board).toHaveBeenCalledTimes(3);
});
it('renders SmartX profile and viewer ranking together', async () => {
  session.mockReturnValue({jwt: 'test-jwt', user: {identifier: 'viewer'}});
  mount();
  await screen.findByRole('link', {name: 'Trader'});
  fireEvent.click(screen.getByRole('button', {name: 'SmartX'}));
  await waitFor(() => expect(screen.getByRole('link', {name: 'Trader'}).getAttribute('href')).toBe('/user?identifier=user-1'));
  expect(screen.getByText('我的排名：#12')).toBeTruthy();
  expect(screen.getByText('我的收益：-$5')).toBeTruthy();
});
it('does not label a previous SmartX period rank as the new period', async () => {
  session.mockReturnValue({jwt: 'test-jwt', user: {identifier: 'viewer'}});
  mount();
  await screen.findByRole('link', {name: 'Trader'});
  fireEvent.click(screen.getByRole('button', {name: 'SmartX'}));
  await screen.findByText('我的排名：#12');
  board.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', {name: '30D'}));
  await waitFor(() => expect(board).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('我的排名：#12')).toBeNull();
  expect(screen.getByText(/暂时显示.*7D/)).toBeTruthy();
});
it('isolates account caches without JWT keys or previous private data', async () => {
  session.mockReturnValue({jwt: 'secret-one', user: {identifier: 'one'}});
  board.mockImplementation((query: UnifiedLeaderboardQuery, jwt: string) => jwt === 'secret-one' ? Promise.resolve(data(query, 'Private one')) : new Promise(() => {}));
  const view = mount();
  await screen.findByText('Private one');
  session.mockReturnValue({jwt: 'secret-two', user: {identifier: 'two'}});
  view.rerender(view.tree());
  await waitFor(() => expect(board).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Private one')).toBeNull();
  expect([...view.cache.keys()].join()).not.toContain('secret-');
});
it('uses valid defaults and labels retained data after refresh failure', async () => {
  meta.mockResolvedValue({windows: ['all'], dimensions: ['Global']});
  mount();
  await screen.findByRole('link', {name: 'Trader'});
  expect(board.mock.calls[0][0]).toEqual({window: 'all', dimension: 'Global'});
  board.mockRejectedValue(new ApiError('business', 500102, 'internal message'));
  fireEvent.click(screen.getByRole('button', {name: '刷新'}));
  expect(await screen.findByText('更新失败，当前显示上次成功获取的数据。')).toBeTruthy();
  expect(screen.getByRole('link', {name: 'Trader'})).toBeTruthy();
  expect(screen.queryByText(/internal message/)).toBeNull();
});

it('cancels hidden-page work and reads once when visible again', async () => {
  let visibility = 'visible';
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});
  try {
    board.mockImplementation(() => new Promise(() => {}));
    mount();
    await waitFor(() => expect(board).toHaveBeenCalledTimes(1));
    const signal = board.mock.calls[0][2] as AbortSignal;
    visibility = 'hidden';
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(signal.aborted).toBe(true));
    fireEvent(window, new Event('online'));
    expect(board).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(board).toHaveBeenCalledTimes(2));
    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('online'));
    await act(async () => {await Promise.resolve();});
    expect(board).toHaveBeenCalledTimes(2);
  } finally {
    if (original) Object.defineProperty(document, 'visibilityState', original);
    else Reflect.deleteProperty(document, 'visibilityState');
  }
});
