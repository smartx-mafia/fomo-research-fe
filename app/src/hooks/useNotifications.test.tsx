// @vitest-environment jsdom
import React from 'react';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {useNotifications} from './useNotifications';

const api = vi.hoisted(() => ({list: vi.fn(), unread: vi.fn(), read: vi.fn(), all: vi.fn()}));
vi.mock('@/api/notifications', () => ({getNotifications: api.list, getNotificationUnread: api.unread, markNotificationRead: api.read, markAllNotificationsRead: api.all}));
const row = {id: '1', code: 'new_followers', title: 'New follower', content: '', is_read: false, created_at: 1, presentation: null};
const page = (rows = [row]) => ({list: rows, page: 1, page_size: 20, total: rows.length});
function wrapper({children}: {children: React.ReactNode}) {
  return <SWRConfig value={{provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false}}>{children}</SWRConfig>;
}
beforeEach(() => {vi.resetAllMocks(); api.list.mockResolvedValue(page()); api.unread.mockResolvedValue({total: 1, tabs: {updates: 1}});});
afterEach(cleanup);

it('does not clear unread on load and preserves the dots when a read write fails', async () => {
  api.read.mockRejectedValue(new Error('offline'));
  const hook = renderHook(() => useNotifications('jwt', 'en'), {wrapper});
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  expect(api.read).not.toHaveBeenCalled(); expect(api.all).not.toHaveBeenCalled();
  await act(async () => {await hook.result.current.read('1');});
  expect(hook.result.current.items[0].is_read).toBe(false);
  expect(hook.result.current.mutationError).toBeInstanceOf(Error);
});

it('reconciles confirmed read-all with both list and authoritative count', async () => {
  api.all.mockImplementation(async () => {api.list.mockResolvedValue(page([{...row, is_read: true}])); api.unread.mockResolvedValue({total: 0, tabs: {updates: 0}});});
  const hook = renderHook(() => useNotifications('jwt', 'en'), {wrapper});
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  await act(async () => {await hook.result.current.read();});
  expect(hook.result.current.items[0].is_read).toBe(true);
  expect(hook.result.current.unread.data?.total).toBe(0);
});

it('does not reuse the previous account list after a session switch', async () => {
  api.list.mockImplementation((bearer: string) => Promise.resolve(page([{...row, id: bearer, title: bearer}])));
  const hook = renderHook(({bearer}) => useNotifications(bearer, 'en'), {wrapper, initialProps: {bearer: 'account-a'}});
  await waitFor(() => expect(hook.result.current.items[0]?.title).toBe('account-a'));
  hook.rerender({bearer: 'account-b'});
  expect(hook.result.current.items.some((item) => item.title === 'account-a')).toBe(false);
  await waitFor(() => expect(hook.result.current.items[0]?.title).toBe('account-b'));
});
