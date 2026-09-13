import {beforeEach, describe, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getLeaderboard, getLeaderboardMeta} from './leaderboard';

describe('leaderboard API', () => {
  it('preserves same-address entries across chains and server ranking in ALL', async () => {
    const list = [{rank: 1, chain: 'bsc', address: '0xabc'}, {rank: 2, chain: 'base', address: '0xabc'}];
    callMock.mockResolvedValue({data: {chain: 'all', window: '7d', metric: 'total_profit', list, count: 2}});
    expect((await getLeaderboard({chain: 'all', window: '7d', metric: 'total_profit'})).list).toEqual(list);
  });
  it('rejects missing chains on ALL rather than linking to all as a real chain', async () => {
    callMock.mockResolvedValue({data: {list: [{rank: 1, address: '0xabc'}]}});
    await expect(getLeaderboard({chain: 'all', window: '7d', metric: 'total_profit'})).rejects.toThrow('chain');
    expect((await getLeaderboard({chain: 'base', window: '7d', metric: 'total_profit'})).list[0].chain).toBe('base');
  });
  beforeEach(() => callMock.mockReset());
  it('loads server-owned filter options', async () => {
    callMock.mockResolvedValue({data: {chains: ['sol'], windows: ['1d'], metrics: ['total_profit']}});
    await expect(getLeaderboardMeta()).resolves.toEqual({chains: ['sol'], windows: ['1d'], metrics: ['total_profit']});
    expect(callMock).toHaveBeenCalledWith('/v1/leaderboard/meta', {signal: undefined});
  });
  it('encodes all required filters and preserves valid empty boards', async () => {
    callMock.mockResolvedValue({data: {chain: 'sol', window: '7d', metric: 'realized_profit', updated_at: '', count: 0}});
    await expect(getLeaderboard({chain: 'sol', window: '7d', metric: 'realized_profit'})).resolves.toMatchObject({count: 0, list: []});
    expect(callMock).toHaveBeenCalledWith('/v1/leaderboard?chain=sol&window=7d&metric=realized_profit', {signal: undefined});
  });
});
