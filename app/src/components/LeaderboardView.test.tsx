// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
const {board} = vi.hoisted(() => ({board: vi.fn()}));
vi.mock('@/api/leaderboard', () => ({getLeaderboardMeta: async () => ({chains: ['sol', 'all', 'base', 'bsc'], windows: ['1d', '7d'], metrics: ['realized_profit', 'total_profit']}), getLeaderboard: board}));
import {LeaderboardView} from './LeaderboardView';
afterEach(cleanup);
it('defaults to ALL/7D and links each mixed-chain wallet to its own chain', async () => {
  board.mockResolvedValue({chain: 'all', window: '7d', metric: 'total_profit', count: 2, list: [{rank: 1, chain: 'base', address: '0xabc'}, {rank: 2, chain: 'bsc', address: '0xabc'}]});
  render(<SWRConfig value={{provider: () => new Map()}}><LeaderboardView /></SWRConfig>);
  await waitFor(() => expect(board).toHaveBeenCalledWith({chain: 'all', window: '7d', metric: 'total_profit'}));
  expect(screen.getByRole('button', {name: 'ALL'}).getAttribute('aria-pressed')).toBe('true');
  expect((await screen.findAllByRole('link')).map((link) => link.getAttribute('href'))).toEqual(['/smart-money/base/0xabc', '/smart-money/bsc/0xabc']);
});
