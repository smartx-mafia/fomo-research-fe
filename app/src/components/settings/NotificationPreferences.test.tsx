// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
import {NotificationPreferences, validNotificationMinimum} from './NotificationPreferences';
import {ApiError} from '@/api/envelope';

const mocks = vi.hoisted(() => ({settings: vi.fn(), people: vi.fn(), toggle: vi.fn(), minimum: vi.fn(), person: vi.fn()}));
vi.mock('@/api/settings', () => ({getNotificationSettings: mocks.settings, getNotificationPeople: mocks.people,
  setNotificationToggle: mocks.toggle, setMinimumTradeUSD: mocks.minimum, setPersonNotifications: mocks.person}));
vi.mock('@/components/ErrorPanel', () => ({ErrorPanel: ({err}: {err: Error}) => <p role="alert">{err.message}</p>}));
const values = {push: true, following: true, friend_trades: true, friend_opinions: true, new_followers: false, deposits_withdrawals: true, announcements: true, minimum_trade_usd: '500.000000'};
const person = {target: {type: 'smart_money_user', id: 'subject:20'}, display_name: 'Alpha', username: '', avatar_url: '', remark: '', trades: true, opinions: false};
function mount() {render(<SWRConfig value={{provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0}}><NotificationPreferences bearer="jwt" /></SWRConfig>);}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({data: values});
  mocks.people.mockResolvedValue({data: {people: [person], total: 1, page: 1, page_size: 20}});
  mocks.person.mockResolvedValue({data: {matched: 1}});
});
afterEach(cleanup);

it('saves the shared Friends switch and keeps the old selection on a failed write', async () => {
  mount(); const toggle = await screen.findByRole('switch', {name: 'Friends 买卖'});
  mocks.toggle.mockRejectedValueOnce(new ApiError('network', 0, '保存失败'));
  fireEvent.click(toggle);
  await screen.findByText('保存失败');
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(mocks.toggle).toHaveBeenCalledWith('jwt', 'friend_trades', false);
  mocks.toggle.mockResolvedValueOnce({data: {...values, friend_trades: false}});
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
});

it('sends a subject target without turning off the other saved preference', async () => {
  mount();
  fireEvent.click(await screen.findByRole('switch', {name: '交易通知'}));
  await waitFor(() => expect(mocks.person).toHaveBeenCalledWith('jwt', person.target, {trades: false}));
  expect(mocks.person.mock.calls[0][2]).not.toHaveProperty('opinions');
});

it('retains selected people while parent notifications are paused and hides address trade controls', async () => {
  mocks.settings.mockResolvedValue({data: {...values, push: false}});
  mocks.people.mockResolvedValue({data: {people: [person, {...person, target: {type: 'smart_money', id: 'wallet'}, display_name: 'Wallet'}], total: 2}});
  mount(); await screen.findByText('Alpha');
  expect(screen.getAllByRole('switch', {name: '交易通知'})).toHaveLength(1);
  expect(screen.getByRole('switch', {name: '交易通知'}).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('交易通知仅支持用户级关注，请关注对应的聪明钱主体。')).toBeTruthy();
});

it('validates exact decimal boundaries and sends the amount as a string', async () => {
  for (const value of ['1', '1.000001', '1000000000']) expect(validNotificationMinimum(value)).toBe(true);
  for (const value of ['', '0.999999', '1000000000.000001', '1e3', '-1', '1.1234567']) expect(validNotificationMinimum(value)).toBe(false);
  mount(); const field = await screen.findByLabelText('最低交易金额（USD）');
  fireEvent.change(field, {target: {value: '10.123456'}});
  mocks.minimum.mockResolvedValue({data: {...values, minimum_trade_usd: '10.123456'}});
  fireEvent.click(screen.getByRole('button', {name: '保存金额'}));
  await waitFor(() => expect(mocks.minimum).toHaveBeenCalledWith('jwt', '10.123456'));
});

it('searches on the server and resets pagination', async () => {
  mocks.people.mockResolvedValue({data: {people: [person], total: 41}});
  mount(); await screen.findByText('Alpha');
  fireEvent.click(screen.getByRole('button', {name: '下一页'}));
  await waitFor(() => expect(mocks.people).toHaveBeenCalledWith('jwt', '', 2));
  fireEvent.change(screen.getByLabelText('搜索关注的人'), {target: {value: 'Alpha'}});
  fireEvent.click(screen.getByRole('button', {name: '搜索'}));
  await waitFor(() => expect(mocks.people).toHaveBeenCalledWith('jwt', 'Alpha', 1));
});
