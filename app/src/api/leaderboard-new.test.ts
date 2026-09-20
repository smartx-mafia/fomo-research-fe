import {expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getUnifiedLeaderboard, leaderboardIdentityKey} from './leaderboard-new';

it('only sends the two new filters, preserving case and exact amounts', async () => {
  const data = {list: [{total_profit_usd: '9007199254740993.12'}]};
  callMock.mockResolvedValue({data});
  const query = {window: '7d', dimension: 'SmartX', chain: 'all', metric: 'roi'};
  expect(await getUnifiedLeaderboard(query)).toBe(data);
  expect(callMock).toHaveBeenCalledWith('/v1/leaderboard-new?window=7d&dimension=SmartX', undefined);
});

it('passes the bearer only when given, so viewer rank and pnl can be resolved', async () => {
  callMock.mockResolvedValue({data: {list: []}});
  await getUnifiedLeaderboard({window: '7d', dimension: 'SmartX'}, 'jwt');
  expect(callMock).toHaveBeenLastCalledWith('/v1/leaderboard-new?window=7d&dimension=SmartX', {bearer: 'jwt'});
  await getUnifiedLeaderboard({window: '7d', dimension: 'SmartX'});
  expect(callMock).toHaveBeenLastCalledWith('/v1/leaderboard-new?window=7d&dimension=SmartX', undefined);
});

it('distinguishes identities across types and wallet namespaces', () => {
  const keys = [
    leaderboardIdentityKey({type: 'smartx_user', id: 'subject:1'}),
    leaderboardIdentityKey({type: 'external_user', id: 'subject:1'}),
    leaderboardIdentityKey({type: 'wallet', namespace: 'evm', address: 'abc'}),
    leaderboardIdentityKey({type: 'wallet', namespace: 'solana', address: 'abc'}),
  ];
  expect(new Set(keys).size).toBe(4);
});
