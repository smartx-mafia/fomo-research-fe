// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {NotificationsView} from './NotificationsView';
import {NotificationEntry} from './NotificationEntry';

const mocks = vi.hoisted(() => ({session: vi.fn(), useNotifications: vi.fn(), read: vi.fn(), refresh: vi.fn(), more: vi.fn()}));
vi.mock('@/session/storage', () => ({useSession: mocks.session}));
vi.mock('@/hooks/useNotifications', () => ({useNotifications: mocks.useNotifications}));
vi.mock('swr', () => ({default: () => ({data: {data: {language: 'en'}}, mutate: vi.fn()})}));

const row = {id: '123', code: 'withdrawal_failed', title: 'Withdrawal failed', content: '25 USDC · Refund pending', is_read: false, created_at: 1793000000,
  presentation: {version: 1, language: 'en', kind: 'withdrawal_failed', icon: 'wallet', badge: 'outgoing', actor: null, subtitle: '25 USDC', status: {code: 'refund_pending', text: 'Refund pending', tone: 'warning'}}};
function state(overrides = {}) {return {items: [row], list: {isLoading: false, isValidating: false}, unread: {data: {total: 1}}, hasMore: false, loadingMore: false, busy: false, read: mocks.read, refresh: mocks.refresh, loadMore: mocks.more, ...overrides};}
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockReturnValue({jwt: 'jwt', user: {identifier: 'me', language: 'en'}});
  mocks.useNotifications.mockReturnValue(state());
});
afterEach(cleanup);

it('renders the new subtitle and highlighted status once without a business link', () => {
  render(<NotificationsView />);
  expect(screen.getByText('Refund pending').parentElement?.textContent).toBe('25 USDC · Refund pending');
  expect(screen.getAllByText('Refund pending')).toHaveLength(1);
  expect(screen.getByText('Refund pending').className).toContain('text-yellow-400');
  expect(screen.queryByRole('link', {name: 'Withdrawal failed'})).toBe(null);
  fireEvent.click(screen.getByRole('button', {name: 'Mark as read: Withdrawal failed'}));
  expect(mocks.read).toHaveBeenCalledWith('123');
  fireEvent.click(screen.getByRole('button', {name: 'Mark all read'}));
  expect(mocks.read).toHaveBeenCalledWith();
});

it('uses the server unread count and never claims all-read when its request failed', () => {
  mocks.useNotifications.mockReturnValue(state({unread: {data: {total: 0}, error: new Error('offline')}}));
  render(<NotificationsView />);
  expect(screen.getByText('Unread count unavailable')).toBeTruthy();
  expect(screen.queryByText('All read')).toBe(null);
});

it('shows all-read and removes unread dots after acknowledged updates', () => {
  mocks.useNotifications.mockReturnValue(state({items: [{...row, is_read: true}], unread: {data: {total: 0}}}));
  render(<NotificationsView />);
  expect(screen.getByText('All read')).toBeTruthy();
  expect(screen.queryByLabelText('Unread')).toBe(null);
  expect(screen.getByRole('button', {name: 'Withdrawal failed'}).hasAttribute('disabled')).toBe(true);
});

it('offers retry and pagination without discarding the displayed list', () => {
  mocks.useNotifications.mockReturnValue(state({hasMore: true, list: {error: new Error('offline')}}));
  render(<NotificationsView />);
  expect(screen.getByText('Withdrawal failed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Load more'})); expect(mocks.more).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Retry'})); expect(mocks.refresh).toHaveBeenCalled();
});

it('does not fetch private notifications before login', () => {
  mocks.session.mockReturnValue(null);
  render(<NotificationsView />);
  expect(screen.getByRole('link', {name: '登录 / Sign in'}).getAttribute('href')).toBe('/login');
  expect(mocks.useNotifications).not.toHaveBeenCalled();
});

it('provides the profile entry independently of notification fetching', () => {
  render(<NotificationEntry language="zh-CN" />);
  expect(screen.getByRole('link', {name: '通知'}).getAttribute('href')).toBe('/notifications');
  expect(mocks.useNotifications).not.toHaveBeenCalled();
});

it('aligns controls with the actual backend display language when preferences are stale', () => {
  mocks.useNotifications.mockReturnValue(state({items: [{...row, presentation: {...row.presentation, language: 'zh-CN'}}]}));
  render(<NotificationsView />);
  expect(screen.getByRole('button', {name: '全部标为已读'})).toBeTruthy();
  expect(screen.getByRole('heading', {name: '通知'})).toBeTruthy();
});

it('places the unread indicator above the timestamp like the design', () => {
  render(<NotificationsView />);
  const dot = screen.getByLabelText('Unread');
  expect(dot.parentElement?.firstElementChild).toBe(dot);
  expect(dot.parentElement?.lastElementChild?.tagName).toBe('TIME');
});
