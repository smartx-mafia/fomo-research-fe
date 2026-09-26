// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';

const {board, meta, session} = vi.hoisted(() => ({board: vi.fn(), meta: vi.fn(), session: vi.fn()}));
vi.mock('@/api/leaderboard-new', () => ({getUnifiedLeaderboard: board, getUnifiedLeaderboardMeta: meta}));
vi.mock('@/session/storage', () => ({useSession: session}));
import {LeaderboardView} from './LeaderboardView';

afterEach(() => {cleanup(); vi.clearAllMocks();});

it('loads only Global external identities and links a subject without substituting its wallet', async () => {
  session.mockReturnValue(null);
  meta.mockResolvedValue({windows: ['1d', '7d', '30d', 'all'], dimensions: ['ALL', 'SmartX', 'Global']});
  board.mockResolvedValue({window: '7d', dimension: 'Global', updated_at: '1780000000', stale: false, count: 2, list: [
    {rank: 1, identity: {type: 'external_user', id: 'subject:123', user_type: 2}, profile: {display_name: 'Trader', x_handle: 'trader'}, platforms: ['FOMO', 'PUMP'], dimension: 'Global', pnl_basis: 'window_realized_plus_current_unrealized', total_profit_usd: '0', snapshot_at: '1779990000', chains: ['sol'], identity_revision: 'rev-1'},
    {rank: 2, identity: {type: 'wallet', namespace: 'evm', address: '0xabc', user_type: 2}, profile: {display_name: 'Wallet'}, platforms: ['GMGN'], dimension: 'Global', pnl_basis: 'window_realized_plus_current_unrealized', total_profit_usd: '-12.34', snapshot_at: '1779980000', chains: ['base', 'bsc'], identity_revision: 'rev-2'},
  ]});
  render(<SWRConfig value={{provider: () => new Map()}}><LeaderboardView /></SWRConfig>);
  await waitFor(() => expect(board).toHaveBeenCalledWith('7d', undefined));
  expect(screen.getByRole('link', {name: 'Trader'}).getAttribute('href')).toBe('/smart-money?subject_id=subject%3A123');
  expect(screen.getByRole('link', {name: 'Wallet'}).getAttribute('href')).toBe('/smart-money?namespace=evm&wallet_address=0xabc');
  expect(screen.getByText('当前收益仍来自 GMGN、FOMO、PUMP 的供应商快照聚合，尚未切换到新的链上交易账本。表内时间为参与该行收益的最旧观测时间；这不是全仓或完整用户 PnL。')).toBeTruthy();
  expect(screen.getByText('$0')).toBeTruthy();
  expect(screen.getByText('-$12.34')).toBeTruthy();
});

it('keys personalized board reads by the current session and forwards the JWT', async () => {
  session.mockReturnValue({jwt: 'viewer-jwt'});
  meta.mockResolvedValue({windows: ['1d', '7d'], dimensions: ['Global']});
  board.mockResolvedValue({window: '7d', dimension: 'Global', updated_at: 1780000000, stale: true, count: 0, list: []});
  render(<SWRConfig value={{provider: () => new Map()}}><LeaderboardView /></SWRConfig>);
  await waitFor(() => expect(board).toHaveBeenCalledWith('7d', 'viewer-jwt'));
  expect(await screen.findByText('榜单构建已延迟，请谨慎参考。')).toBeTruthy();
});
