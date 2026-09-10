import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {login, probeRegistration} from './auth';
import {
  BIO_MAX_CHARS,
  checkUsernameAvailable,
  charLength,
  deleteAccount,
  setLanguage,
  setNickname,
  setUsername,
  validateNickname,
} from './user';

describe('auth login / probe contract', () => {
  beforeEach(() => callMock.mockReset());

  it('login sends only the three base fields when no codes are given', async () => {
    callMock.mockResolvedValue({data: {token: 't', user: {identifier: 'i'}}});
    await login('AUTH_METHOD_EMAIL', 'idt');
    expect(callMock).toHaveBeenCalledWith('/v1/auth/login', {
      method: 'POST',
      body: {
        auth_channel: 'AUTH_CHANNEL_PRIVY',
        auth_method: 'AUTH_METHOD_EMAIL',
        identity_token: 'idt',
      },
    });
  });

  it('login carries invite_code / entry_code exactly when provided (never both silently dropped)', async () => {
    callMock.mockResolvedValue({data: {token: 't', user: {identifier: 'i'}}});
    await login('AUTH_METHOD_GOOGLE', 'idt', {inviteCode: 'c4w5dldu'});
    expect(callMock.mock.calls[0][1].body).toEqual({
      auth_channel: 'AUTH_CHANNEL_PRIVY',
      auth_method: 'AUTH_METHOD_GOOGLE',
      identity_token: 'idt',
      invite_code: 'c4w5dldu',
    });

    await login('AUTH_METHOD_APPLE', 'idt2', {entryCode: 'abcdefghjkmnpq23'});
    expect(callMock.mock.calls[1][1].body).toEqual({
      auth_channel: 'AUTH_CHANNEL_PRIVY',
      auth_method: 'AUTH_METHOD_APPLE',
      identity_token: 'idt2',
      entry_code: 'abcdefghjkmnpq23',
    });
  });

  it('login never attaches a bearer (Optional tier: bad token would 400000, never anonymous)', () => {
    callMock.mockResolvedValue({data: {token: 't', user: {identifier: 'i'}}});
    void login('AUTH_METHOD_EMAIL', 'idt');
    const opts = callMock.mock.calls[0][1];
    expect(opts.bearer).toBeUndefined();
    expect(opts.method).toBe('POST');
  });

  it('probe posts identity_token only, no bearer', async () => {
    callMock.mockResolvedValue({data: {phase: 'exclusive', requires: 2}});
    await expect(probeRegistration('idt')).resolves.toEqual({data: {phase: 'exclusive', requires: 2}});
    expect(callMock).toHaveBeenCalledWith('/v1/auth/probe', {method: 'POST', body: {identity_token: 'idt'}});
  });
});

describe('user profile endpoints', () => {
  beforeEach(() => callMock.mockReset());

  it('setUsername / setNickname / setLanguage each post a single field and return UserInfo', async () => {
    const userInfo = {identifier: 'id', username: 'Satoshi_2009'};
    callMock.mockResolvedValue({data: userInfo});
    await setUsername('jwt', 'Satoshi_2009');
    expect(callMock).toHaveBeenCalledWith('/v1/user/username', {method: 'POST', bearer: 'jwt', body: {username: 'Satoshi_2009'}});
    await setNickname('jwt', '中本聪');
    expect(callMock).toHaveBeenCalledWith('/v1/user/nickname', {method: 'POST', bearer: 'jwt', body: {nickname: '中本聪'}});
    await setLanguage('jwt', 'zh-cn');
    expect(callMock).toHaveBeenCalledWith('/v1/user/language', {method: 'POST', bearer: 'jwt', body: {language: 'zh-cn'}});
  });

  it('checkUsernameAvailable url-encodes and rejects status outside 1/2', async () => {
    callMock.mockResolvedValueOnce({data: {status: 2}});
    await expect(checkUsernameAvailable('jwt', 'Satoshi_2009')).resolves.toEqual({status: 2});
    expect(callMock).toHaveBeenCalledWith('/v1/user/username/available?username=Satoshi_2009', {
      bearer: 'jwt',
      signal: undefined,
    });

    callMock.mockResolvedValueOnce({data: {status: 3}});
    await expect(checkUsernameAvailable('jwt', 'x')).rejects.toThrow(/status=3/);
  });

  it('deleteAccount posts an empty object (id is taken from the JWT)', async () => {
    callMock.mockResolvedValue({data: {}});
    await deleteAccount('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/user/delete', {method: 'POST', bearer: 'jwt', body: {}});
  });
});

describe('local validation mirrors user.md §3.1', () => {
  it('nickname counts characters (CJK = 1), rejects blank / control chars / >64', () => {
    expect(validateNickname('  中本聪  ')).toBeNull();
    expect(validateNickname('a'.repeat(64))).toBeNull();
    expect(validateNickname(`${'a'.repeat(64)}汉`)).toMatch(/最多/);
    expect(validateNickname('   ')).toMatch(/不能为空/);
    expect(validateNickname('a\nb')).toMatch(/控制字符/);
    expect(charLength('😀😀')).toBe(2);
    expect(BIO_MAX_CHARS).toBe(512);
  });
});
