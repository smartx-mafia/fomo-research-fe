import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  INVITE_CODE_RE,
  bindInvite,
  checkInviteCode,
  getInviteDefault,
  getInviteInfo,
  getInviteStatus,
  listInvitees,
  normalizeCode,
  normalizeNextAction,
} from './invite';

describe('invite module contract (2026-09-11 breaking shape)', () => {
  beforeEach(() => callMock.mockReset());

  it('Optional-tier endpoints (default/check) never attach a bearer unless one is passed to check', async () => {
    callMock.mockResolvedValue({data: {enabled: true, invite_code: 'h1g51im1'}});
    await getInviteDefault();
    expect(callMock).toHaveBeenCalledWith('/v1/invite/default', {signal: undefined});

    // 匿名调用（落地页展示）：不带 JWT，「是你自己的码」判不出 —— 预期行为。
    callMock.mockResolvedValue({data: {status: 1, message: ''}});
    await checkInviteCode('c4w5dldu');
    expect(callMock).toHaveBeenCalledWith('/v1/invite/check?code=c4w5dldu', {bearer: undefined, signal: undefined});

    // 绑定页调用必须带 JWT：不带就判不出「这是你自己的码」（invite.md §3.3）。
    await checkInviteCode('c4w5dldu', 'jwt');
    expect(callMock).toHaveBeenLastCalledWith('/v1/invite/check?code=c4w5dldu', {bearer: 'jwt', signal: undefined});
  });

  it('check url-encodes the code', async () => {
    callMock.mockResolvedValue({data: {status: 2, message: 'does not exist'}});
    await checkInviteCode('ab cd+/');
    expect(callMock.mock.calls[0][0]).toBe('/v1/invite/check?code=ab%20cd%2B%2F');
  });

  it('status/info take bearer only; list builds cursor+limit query', async () => {
    // 2026-09-11 起的 /status：next_action / default_bind_enabled / bind_opens_at 恒在语义内。
    callMock.mockResolvedValue({
      data: {
        next_action: 'bind',
        default_bind_enabled: true,
        bind_opens_at: 0,
        phase: 'open',
        admitted: false,
        origin: '',
        inviter: {handle: '', avatar_url: '', pending: false},
      },
    });
    await getInviteStatus('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/invite/status', {bearer: 'jwt', signal: undefined});

    callMock.mockResolvedValue({data: {invite_code: 'zkp2etwm'}});
    await getInviteInfo('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/invite/info', {bearer: 'jwt', signal: undefined});

    callMock.mockResolvedValue({data: {items: []}});
    await listInvitees('jwt', 'opaque+/=', 30);
    expect(callMock.mock.calls[2][0]).toBe('/v1/invite/list?cursor=opaque%2B%2F%3D&limit=30');
    await listInvitees('jwt');
    expect(callMock.mock.calls[3][0]).toBe('/v1/invite/list');
    await listInvitees('jwt', undefined, 20);
    expect(callMock.mock.calls[4][0]).toBe('/v1/invite/list?limit=20');
  });

  it('bind omits inviter_code when absent (skip) and sends it when given', async () => {
    const info = {invite_code: 'zkp2etwm'};
    callMock.mockResolvedValue({data: info});
    await bindInvite('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/invite/bind', {method: 'POST', bearer: 'jwt', body: {}});
    await bindInvite('jwt', 'c4w5dldu');
    expect(callMock).toHaveBeenCalledWith('/v1/invite/bind', {
      method: 'POST',
      bearer: 'jwt',
      body: {inviter_code: 'c4w5dldu'},
    });
  });

  it('invite code regex is lowercase-36 8 chars: @handle, hyphens and 7/9 chars rejected', () => {
    expect(INVITE_CODE_RE.test('c4w5dldu')).toBe(true);
    expect(INVITE_CODE_RE.test('C4W5DLDU')).toBe(false);
    expect(INVITE_CODE_RE.test('@alice')).toBe(false);
    expect(INVITE_CODE_RE.test('c4w5dld')).toBe(false);
    expect(INVITE_CODE_RE.test('c4w5-dldu')).toBe(false);
    expect(normalizeCode('  C4W5DLDU ')).toBe('c4w5dldu');
  });

  it('normalizeNextAction branches only on known values; anything unknown falls to wait', () => {
    expect(normalizeNextAction('enter')).toBe('enter');
    expect(normalizeNextAction('bind')).toBe('bind');
    expect(normalizeNextAction('wait')).toBe('wait');
    // 服务端将来加新取值时，老前端落在不放行的一侧（invite.md §2.2 硬性要求）。
    expect(normalizeNextAction('gray_release_xyz')).toBe('wait');
    expect(normalizeNextAction(undefined)).toBe('wait');
  });
});
