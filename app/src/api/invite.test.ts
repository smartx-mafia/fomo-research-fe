import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  INVITE_CODE_RE,
  bindInvite,
  checkInviteCode,
  ENTRY_CODE_RE,
  getInviteDefault,
  getInviteInfo,
  getInviteStatus,
  listInvitees,
  normalizeCode,
} from './invite';

describe('invite module contract', () => {
  beforeEach(() => callMock.mockReset());

  it('Optional-tier endpoints (default/check) never attach a bearer', async () => {
    callMock.mockResolvedValue({data: {enabled: true, invite_code: 'h1g51im1'}});
    await getInviteDefault();
    expect(callMock).toHaveBeenCalledWith('/v1/invite/default', {signal: undefined});

    callMock.mockResolvedValue({data: {status: 1}});
    await checkInviteCode('c4w5dldu');
    expect(callMock).toHaveBeenCalledWith('/v1/invite/check?code=c4w5dldu', {signal: undefined});
    expect((callMock.mock.calls[1][1] as {bearer?: string}).bearer).toBeUndefined();
  });

  it('check url-encodes the code', async () => {
    callMock.mockResolvedValue({data: {status: 2}});
    await checkInviteCode('ab cd+/');
    expect(callMock.mock.calls[0][0]).toBe('/v1/invite/check?code=ab%20cd%2B%2F');
  });

  it('status/info take bearer only; list builds cursor+limit query', async () => {
    callMock.mockResolvedValue({data: {phase: 'open', admission_optional: true}});
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

  it('bind omits inviter_code when absent and sends it when given', async () => {
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

  it('code regexes are lowercase-36 only: 8 for invite, 16 for entry; @handle and hyphens rejected', () => {
    expect(INVITE_CODE_RE.test('c4w5dldu')).toBe(true);
    expect(INVITE_CODE_RE.test('C4W5DLDU')).toBe(false);
    expect(INVITE_CODE_RE.test('@alice')).toBe(false);
    expect(INVITE_CODE_RE.test('c4w5dld')).toBe(false);
    expect(INVITE_CODE_RE.test('c4w5-dldu')).toBe(false);
    expect(ENTRY_CODE_RE.test('abcdefghjkmnpq23')).toBe(true);
    expect(ENTRY_CODE_RE.test('c4w5dldu')).toBe(false);
    expect(normalizeCode('  C4W5DLDU ')).toBe('c4w5dldu');
  });
});
