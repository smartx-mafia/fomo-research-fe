import {beforeEach, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getUnifiedLeaderboard, getUnifiedLeaderboardMeta} from './leaderboard-new';
const external = {rank: 1, identity: {type: 'external_user', id: 'subject:42', user_type: 2}, dimension: 'Global', total_profit_usd: '9007199254740993.123456789'};
const internal = {rank: 2, identity: {type: 'smartx_user', id: 'user-1', user_type: 1}, dimension: 'SmartX', total_profit_usd: '-12.34'};
const reply = (list = [external, internal]) => ({window: '7d', dimension: 'ALL', list, count: list.length, updated_at: '1780000001', stale: false});
beforeEach(() => callMock.mockReset());
it('reads v1 directly and accepts mixed ALL identities with exact amounts', async () => {
  const signal = new AbortController().signal;
  callMock.mockResolvedValue({data: reply()});
  const result = await getUnifiedLeaderboard({window: '7d', dimension: 'ALL'}, 'jwt', signal);
  expect(callMock).toHaveBeenCalledWith('/v1/leaderboard-new?window=7d&dimension=ALL', {bearer: 'jwt', signal, preserveInt64Fields: ['updated_at', 'snapshot_at']});
  expect(result.list[0].total_profit_usd).toBe(external.total_profit_usd);
  expect(result.list[1].identity.type).toBe('smartx_user');
});
it('validates supported meta filters', async () => {
  callMock.mockResolvedValue({data: {windows: ['7d', 'unsupported'], dimensions: ['SmartX', 'unknown']}});
  await expect(getUnifiedLeaderboardMeta()).resolves.toEqual({windows: ['7d'], dimensions: ['SmartX']});
  callMock.mockResolvedValue({data: {windows: [], dimensions: ['Global']}});
  await expect(getUnifiedLeaderboardMeta()).rejects.toThrow(/supported filters/);
});
it('rejects response mismatches and invalid identity classifications', async () => {
  callMock.mockResolvedValue({data: reply()});
  await expect(getUnifiedLeaderboard({window: '30d', dimension: 'ALL'})).rejects.toThrow(/invalid response/);
  callMock.mockResolvedValue({data: reply([{...external, identity: {...external.identity, user_type: 0}}])});
  await expect(getUnifiedLeaderboard({window: '7d', dimension: 'ALL'})).rejects.toThrow(/identity user_type/);
  callMock.mockResolvedValue({data: {...reply([internal]), dimension: 'Global'}});
  await expect(getUnifiedLeaderboard({window: '7d', dimension: 'Global'})).rejects.toThrow(/outside its dimension/);
});
it.each([undefined, null, 12, '', 'NaN'])('rejects invalid profit %s without filling zero', async (profit) => {
  callMock.mockResolvedValue({data: reply([{...external, total_profit_usd: profit} as typeof external])});
  await expect(getUnifiedLeaderboard({window: '7d', dimension: 'ALL'})).rejects.toThrow(/non-decimal/);
});
