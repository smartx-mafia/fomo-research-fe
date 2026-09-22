import {beforeEach, expect, it, vi} from 'vitest';
const {call} = vi.hoisted(() => ({call: vi.fn()}));
vi.mock('@/api/envelope', () => ({call}));
import {getLeaderboardRemarks, leaderboardRemarkTarget} from './leaderboard-social';
import {setRemark} from '@/api/social';
import {leaderboardIdentityKey, type LeaderboardIdentity} from '@/api/leaderboard-new';

beforeEach(() => call.mockReset());
const identities: LeaderboardIdentity[] = [
  {type: 'smartx_user', id: 'local-1'},
  {type: 'external_user', id: 'subject:1'},
  {type: 'wallet', namespace: 'evm', address: '0xAbC'},
  {type: 'wallet', namespace: 'solana', address: 'SoLAddress'},
];

it('batches mixed identities and maps remarks in request order', async () => {
  call.mockResolvedValue({data: {users: [{remark: '本站'}], identities: [{remark: '外部'}, {remark: '钱包'}, {remark: ''}]}});
  const result = await getLeaderboardRemarks('jwt', identities);
  expect(call).toHaveBeenCalledWith('/v1/social/relations/batch', {
    method: 'POST', bearer: 'jwt', signal: undefined,
    body: {user_identifiers: ['local-1'], identities: [
      {type: 'user', user_id: 'subject:1'},
      {type: 'wallet', namespace: 'evm', address: '0xAbC'},
      {type: 'wallet', namespace: 'solana', address: 'SoLAddress'},
    ]},
  });
  expect(identities.map((identity) => result[leaderboardIdentityKey(identity)])).toEqual(['本站', '外部', '钱包', '']);
});

it('writes and clears remarks with mutually exclusive target_id and identity', async () => {
  call.mockResolvedValue({data: {remark: ''}});
  for (const identity of identities) {
    await setRemark('jwt', leaderboardRemarkTarget(identity), '');
    const body = call.mock.lastCall![1].body;
    expect(body.remark).toBe('');
    expect(body).not.toHaveProperty('chain');
    if (identity.type === 'smartx_user') expect(body).toEqual({target_type: 'user', target_id: 'local-1', remark: ''});
    else {
      expect(body.target_type).toBe('smart_money');
      expect(body).not.toHaveProperty('target_id');
      expect(body.identity).toEqual(identity.type === 'wallet'
        ? {type: 'wallet', namespace: identity.namespace, address: identity.address}
        : {type: 'user', user_id: identity.id});
    }
  }
});
