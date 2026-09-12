import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  getFollowCounts,
  getFollowers,
  getFollowSuggestions,
  getFollowing,
  getKnownFollowers,
  getMutualFollows,
  getTokenFollowHolders,
  listRemarks,
  setRemark,
  shortIdentifier,
  socialDisplayName,
} from './social';

describe('follow domain endpoints (social.md §5/§5.2/§5.3/§5.5)', () => {
  beforeEach(() => callMock.mockReset());

  it('follow lists build user_identifier/cursor/limit query; default = self (no param)', async () => {
    callMock.mockResolvedValue({data: {entries: []}});
    await getFollowing('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/social/following', {bearer: 'jwt', signal: undefined});

    await getFollowing('jwt', {userIdentifier: 'u1', cursor: 'c+/=', limit: 50});
    expect(callMock.mock.calls[1][0]).toBe('/v1/social/following?user_identifier=u1&cursor=c%2B%2F%3D&limit=50');

    await getFollowers('jwt', {userIdentifier: 'u1'});
    expect(callMock.mock.calls[2][0]).toBe('/v1/social/followers?user_identifier=u1');

    await getMutualFollows('jwt', {cursor: 'c'});
    expect(callMock.mock.calls[3][0]).toBe('/v1/social/mutual-follows?cursor=c');
  });

  it('suggestions take only limit; known-followers require user_identifier', async () => {
    callMock.mockResolvedValue({data: {suggestions: []}});
    await getFollowSuggestions('jwt', 10);
    expect(callMock).toHaveBeenCalledWith('/v1/social/follow-suggestions?limit=10', {bearer: 'jwt', signal: undefined});

    callMock.mockResolvedValue({data: {entries: [], total: 1}});
    await getKnownFollowers('jwt', 'target-id', {limit: 20});
    expect(callMock).toHaveBeenCalledWith('/v1/social/known-followers?user_identifier=target-id&limit=20', {
      bearer: 'jwt',
      signal: undefined,
    });
  });

  it('remarks: set posts target+remark (empty string clears); list builds query', async () => {
    callMock.mockResolvedValue({data: {remark: 'r', changed: true}});
    await setRemark('jwt', 'user', 'u1', '老王');
    expect(callMock).toHaveBeenCalledWith('/v1/social/remarks', {
      method: 'POST',
      bearer: 'jwt',
      body: {target_type: 'user', target_id: 'u1', remark: '老王'},
    });

    // 清除 = 空串（逻辑删除，可再设）
    await setRemark('jwt', 'smart_money', '0xABC', '');
    expect(callMock.mock.calls[1][1].body).toEqual({target_type: 'smart_money', target_id: '0xABC', remark: ''});

    callMock.mockResolvedValue({data: {entries: []}});
    await listRemarks('jwt', {cursor: 'c', limit: 20});
    expect(callMock.mock.calls[2][0]).toBe('/v1/social/remarks?cursor=c&limit=20');
  });

  it('follow-counts omits the query entirely for self', async () => {
    callMock.mockResolvedValue({data: {following_count: 0, follower_count: 0}});
    await getFollowCounts('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/social/follow-counts', {bearer: 'jwt', signal: undefined});
    await getFollowCounts('jwt', 'someone');
    expect(callMock.mock.calls[1][0]).toBe('/v1/social/follow-counts?user_identifier=someone');
  });

  it('token-follow-holders builds chain/address query; shares stay raw strings', async () => {
    callMock.mockResolvedValue({
      data: {
        token: {chain: 'bsc', address: '0x1', symbol: 'PEPE', decimals: 18},
        items: [{user: {identifier: 'u1'}, shares: '347000000000000000000', cost_usd: '1234', pnl_percent: '16.6700'}],
        total: 1,
      },
    });
    const res = await getTokenFollowHolders('jwt', 'bsc', '0x1', {cursor: 'c', limit: 100});
    expect(callMock).toHaveBeenCalledWith('/v1/social/token-follow-holders?chain=bsc&address=0x1&cursor=c&limit=100', {
      bearer: 'jwt',
      signal: undefined,
    });
    // 十进制串原样透传，绝不转 float
    expect(res.data.items?.[0]?.shares).toBe('347000000000000000000');
  });
});

describe('display name fallback (social.md §5: remark → nickname → username → 缩写)', () => {
  it('falls back in contract order and flags remark-sourced names', () => {
    expect(socialDisplayName({identifier: 'id', remark: '我起的', nickname: 'nick', username: 'user'})).toEqual({
      primary: '我起的',
      isRemark: true,
    });
    expect(socialDisplayName({identifier: 'id', nickname: 'nick', username: 'user'}).primary).toBe('nick');
    expect(socialDisplayName({identifier: 'id', username: 'user'}).primary).toBe('@user');
    expect(socialDisplayName({identifier: 'abcdefghijklmnopqrstuvwxyz'}).primary).toBe('abcdef…wxyz');
    expect(socialDisplayName({identifier: 'short'}).primary).toBe('short');
  });

  it('shortIdentifier keeps ≤12 chars intact', () => {
    expect(shortIdentifier('0x1234567890')).toBe('0x1234567890');
    expect(shortIdentifier('0x1234567890a')).toBe('0x1234…890a');
  });
});
