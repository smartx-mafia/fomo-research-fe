import {beforeEach, describe, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getLeaderboard, getLeaderboardMeta} from './leaderboard';

describe('leaderboard API', () => {
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
