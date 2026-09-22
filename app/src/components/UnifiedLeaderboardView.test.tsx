// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
const {board, sessionState, clearSiteMock} = vi.hoisted(() => ({board: vi.fn(), sessionState: {value: null as {jwt: string} | null}, clearSiteMock: vi.fn()}));
const {relations, saveRemark} = vi.hoisted(() => ({relations: vi.fn(), saveRemark: vi.fn()}));
vi.mock('@/api/social', () => ({getRelations: relations, setRemark: saveRemark}));
vi.mock('@/api/leaderboard-new', async (original) => ({...await original<object>(), getUnifiedLeaderboardMeta: async () => ({windows: ['1d', '7d', 'all'], dimensions: ['ALL', 'SmartX', 'Global']}), getUnifiedLeaderboard: board}));
vi.mock('@/session/storage', () => ({useSession: () => sessionState.value, readSite: () => sessionState.value, clearSite: clearSiteMock}));
import {UnifiedLeaderboardView} from './UnifiedLeaderboardView';
import {ApiError} from '@/api/envelope';

const row = {rank: 1, identity: {type: 'external_user', id: 'subject:1'}, profile: {display_name: 'Alice', username: 'alice', avatar_url: '', x_handle: 'alice_x'}, platforms: ['FOMO'], source_tags: [{code: 'FOMO', logo_url: 'https://static.smartx.io/app/branding/smsource/fomo.png'}], dimension: 'Global', pnl_basis: 'window_realized_plus_current_unrealized', total_profit_usd: '9007199254740993.12', snapshot_at: 1789536543, chains: ['sol', 'base'], identity_revision: 'v1'};
const reply = {window: '7d', dimension: 'ALL', updated_at: 1789536583, count: 1, list: [row], stale: false};
function mount() {render(<SWRConfig value={{provider: () => new Map(), dedupingInterval: 0}}><UnifiedLeaderboardView /></SWRConfig>);}
beforeEach(() => {board.mockReset(); sessionState.value = null; clearSiteMock.mockReset(); relations.mockReset(); saveRemark.mockReset();});
afterEach(cleanup);

it('loads defaults, renders exact amounts and seconds, and changes new filters', async () => {
  board.mockImplementation(async (query) => ({...reply, ...query}));
  mount();
  await screen.findByText('Alice');
  expect(board).toHaveBeenCalledWith({window: '7d', dimension: 'ALL'}, undefined);
  expect(screen.getByText('$9,007,199,254,740,993.12')).toBeTruthy();
  expect(screen.getByText(new Date(row.snapshot_at * 1000).toLocaleString())).toBeTruthy();
  expect(screen.getByRole('link', {name: '@alice_x'}).getAttribute('href')).toBe('https://x.com/alice_x');
  expect(screen.getByRole('link', {name: 'Alice'}).getAttribute('href')).toBe('/leaderboard/detail?type=external_user&id=subject%3A1&platform=fomo');
  expect(screen.getByRole('link', {name: '查看 Alice 的持仓'}).getAttribute('href')).toBe(screen.getByRole('link', {name: 'Alice'}).getAttribute('href'));
  expect(screen.getByText('FOMO').closest('span')?.querySelector('img')?.getAttribute('src')).toBe(row.source_tags[0].logo_url);
  fireEvent.click(screen.getByRole('button', {name: 'SmartX'}));
  await waitFor(() => expect(board).toHaveBeenLastCalledWith({window: '7d', dimension: 'SmartX'}, undefined));
  fireEvent.click(screen.getByRole('button', {name: '24H'}));
  await waitFor(() => expect(board).toHaveBeenLastCalledWith({window: '1d', dimension: 'SmartX'}, undefined));
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

it('shows viewer rank, pnl and participant count when the board returns them', async () => {
  board.mockResolvedValue({...reply, dimension: 'SmartX', viewer_rank: 3, viewer_profit_usd: '4.03840757', participant_count: 49});
  mount();
  await screen.findByText('Alice');
  const summary = screen.getByText(/共 49 位用户参与本期排名/);
  expect(summary.textContent).toContain('我的排名 #3');
  expect(summary.textContent).toContain('我的盈亏 $4.04');
});

it('hides the viewer summary when rank and participant count are zero or absent', async () => {
  board.mockResolvedValue({...reply, viewer_rank: 0, viewer_profit_usd: '', participant_count: 0});
  mount();
  await screen.findByText('Alice');
  expect(screen.queryByText(/参与本期排名/)).toBeNull();
  expect(screen.queryByText(/我的排名/)).toBeNull();
});

it('clears a stale session on 400000 so the board refetches anonymously', async () => {
  sessionState.value = {jwt: 'stale'};
  board.mockRejectedValue(new ApiError('business', 400000, 'invalid token'));
  mount();
  await waitFor(() => expect(clearSiteMock).toHaveBeenCalled());
  expect(board).toHaveBeenCalledWith({window: '7d', dimension: 'ALL'}, 'stale');
});

it('loads, edits and clears a private external-user remark', async () => {
  sessionState.value = {jwt: 'jwt'};
  board.mockResolvedValue(reply);
  relations.mockResolvedValue({data: {identities: [{remark: '聪明钱'}]}});
  saveRemark.mockImplementation(async (_jwt, _target, remark) => ({data: {remark}}));
  mount();
  await screen.findByText('聪明钱');
  fireEvent.click(screen.getByRole('button', {name: '编辑备注'}));
  fireEvent.change(screen.getByRole('textbox', {name: '备注'}), {target: {value: '重点关注'}});
  fireEvent.click(screen.getByRole('button', {name: '保存'}));
  await screen.findByText('重点关注');
  expect(saveRemark).toHaveBeenLastCalledWith('jwt', {target_type: 'smart_money', identity: {type: 'user', user_id: 'subject:1'}}, '重点关注');
  expect(screen.getByRole('link', {name: 'Alice'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: '编辑备注'}));
  fireEvent.click(screen.getByRole('button', {name: '清除备注'}));
  await screen.findByRole('button', {name: '添加备注'});
  expect(saveRemark).toHaveBeenLastCalledWith('jwt', {target_type: 'smart_money', identity: {type: 'user', user_id: 'subject:1'}}, '');
  expect(screen.queryByText('重点关注')).toBeNull();
});

it('validates Unicode length and keeps the draft after a failed save', async () => {
  sessionState.value = {jwt: 'jwt'};
  board.mockResolvedValue(reply);
  relations.mockResolvedValue({data: {identities: [{remark: ''}]}});
  saveRemark.mockRejectedValue(new ApiError('business', 430106, 'limit'));
  mount();
  fireEvent.click(await screen.findByRole('button', {name: '添加备注'}));
  const input = screen.getByRole('textbox', {name: '备注'});
  fireEvent.change(input, {target: {value: '😀'.repeat(65)}});
  fireEvent.click(screen.getByRole('button', {name: '保存'}));
  await screen.findByText('备注最多 64 个字符，不能包含换行或控制字符。');
  expect(saveRemark).not.toHaveBeenCalled();
  fireEvent.change(input, {target: {value: '😀'.repeat(64)}});
  fireEvent.click(screen.getByRole('button', {name: '保存'}));
  await screen.findByText('备注已达 1000 条上限，请先清理不用的备注。');
  expect((input as HTMLInputElement).value).toBe('😀'.repeat(64));
});

it('does not fetch or expose private remarks anonymously', async () => {
  board.mockResolvedValue(reply);
  mount();
  await screen.findByText('Alice');
  expect(relations).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', {name: '添加备注'})).toBeNull();
});
