// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
const {board} = vi.hoisted(() => ({board: vi.fn()}));
vi.mock('@/api/leaderboard-new', async (original) => ({...await original<object>(), getUnifiedLeaderboardMeta: async () => ({windows: ['1d', '7d', 'all'], dimensions: ['ALL', 'SmartX', 'Global']}), getUnifiedLeaderboard: board}));
import {UnifiedLeaderboardView} from './UnifiedLeaderboardView';
import {ApiError} from '@/api/envelope';

const row = {rank: 1, identity: {type: 'external_user', id: 'subject:1'}, profile: {display_name: 'Alice', username: 'alice', avatar_url: '', x_handle: 'alice_x'}, platforms: ['FOMO'], source_tags: [{code: 'FOMO', logo_url: 'https://static.smartx.io/app/branding/smsource/fomo.png'}], dimension: 'Global', pnl_basis: 'window_realized_plus_current_unrealized', total_profit_usd: '9007199254740993.12', snapshot_at: 1789536543, chains: ['sol', 'base'], identity_revision: 'v1'};
const reply = {window: '7d', dimension: 'ALL', updated_at: 1789536583, count: 1, list: [row], stale: false};
function mount() {render(<SWRConfig value={{provider: () => new Map(), dedupingInterval: 0}}><UnifiedLeaderboardView /></SWRConfig>);}
beforeEach(() => {board.mockReset();});
afterEach(cleanup);

it('loads defaults, renders exact amounts and seconds, and changes new filters', async () => {
  board.mockImplementation(async (query) => ({...reply, ...query}));
  mount();
  await screen.findByText('Alice');
  expect(board).toHaveBeenCalledWith({window: '7d', dimension: 'ALL'});
  expect(screen.getByText('$9,007,199,254,740,993.12')).toBeTruthy();
  expect(screen.getByText(new Date(row.snapshot_at * 1000).toLocaleString())).toBeTruthy();
  expect(screen.getByRole('link', {name: '@alice_x'}).getAttribute('href')).toBe('https://x.com/alice_x');
  expect(screen.getByRole('link', {name: 'Alice'}).getAttribute('href')).toBe('/leaderboard/detail?type=external_user&id=subject%3A1&platform=fomo');
  expect(screen.getByRole('link', {name: '查看 Alice 的持仓'}).getAttribute('href')).toBe(screen.getByRole('link', {name: 'Alice'}).getAttribute('href'));
  expect(screen.getByText('FOMO').closest('span')?.querySelector('img')?.getAttribute('src')).toBe(row.source_tags[0].logo_url);
  fireEvent.click(screen.getByRole('button', {name: 'SmartX'}));
  await waitFor(() => expect(board).toHaveBeenLastCalledWith({window: '7d', dimension: 'SmartX'}));
  fireEvent.click(screen.getByRole('button', {name: '24H'}));
  await waitFor(() => expect(board).toHaveBeenLastCalledWith({window: '1d', dimension: 'SmartX'}));
});

it('preserves server order, zero and negative amounts, and warns about stale data', async () => {
  board.mockResolvedValue({...reply, stale: true, count: 2, list: [{...row, rank: 4, total_profit_usd: '0'}, {...row, rank: 7, identity: {type: 'wallet', namespace: 'evm', address: '0xabc'}, profile: {...row.profile, display_name: 'Wallet', x_handle: ''}, total_profit_usd: '-12.34'}]});
  mount();
  await screen.findByText('$0');
  expect(screen.getByText('-$12.34')).toBeTruthy();
  expect(screen.getByText(/后台更新延迟/)).toBeTruthy();
  const rows = screen.getAllByRole('row');
  expect(rows[1].textContent).toContain('Alice');
  expect(rows[2].textContent).toContain('Wallet');
});

it('skips the platform logo when the URL is missing or not http(s)', async () => {
  board.mockResolvedValue({...reply, count: 2, list: [{...row, source_tags: [{code: 'FOMO', logo_url: 'not-a-url'}]}, {...row, rank: 2, identity: {type: 'wallet', namespace: 'evm', address: '0xabc'}, profile: {...row.profile, display_name: 'Wallet', x_handle: ''}, platforms: ['GMGN'], source_tags: undefined}]});
  mount();
  await screen.findByText('Alice');
  for (const platform of ['FOMO', 'GMGN']) expect(screen.getByText(platform).closest('span')?.querySelector('img')).toBeNull();
});

it('shows successful empty results separately from service errors', async () => {
  board.mockResolvedValue({...reply, count: 0, list: []});
  mount();
  await screen.findByText('该筛选组合暂无符合条件的用户或钱包。');
  expect(screen.queryByRole('alert')).toBeNull();
  board.mockRejectedValue(new ApiError('business', 500102, 'internal', undefined, 'trace-test'));
  fireEvent.click(screen.getByRole('button', {name: 'Global'}));
  await screen.findByRole('alert');
  expect(screen.getByText(/榜单暂不可用/)).toBeTruthy();
  expect(screen.getByText('Trace trace-test')).toBeTruthy();
  expect(screen.queryByText('该筛选组合暂无符合条件的用户或钱包。')).toBeNull();
});
