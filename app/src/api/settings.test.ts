import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  getAvatarHistory,
  getAvatarPresets,
  getNotificationSettings,
  getPreferences,
  getProfile,
  getSecuritySettings,
  getTradingSettings,
  importProfileFromX,
  recordKeyExport,
  setAvatar,
  setBio,
  setCurrency,
  setFaceId,
  setFollowingEnabled,
  setPushEnabled,
  setSlippage,
  setTheme,
  setTradeConfirmation,
  validateSlippage,
} from './settings';

describe('settings four pages', () => {
  beforeEach(() => callMock.mockReset());

  it('GET pages hit their canonical paths with bearer', async () => {
    const pages: Array<[string, () => unknown]> = [
      ['/v1/settings/trading', () => getTradingSettings('jwt')],
      ['/v1/settings/security', () => getSecuritySettings('jwt')],
      ['/v1/settings/notifications', () => getNotificationSettings('jwt')],
      ['/v1/settings/preferences', () => getPreferences('jwt')],
    ];
    for (const [path, fn] of pages) {
      callMock.mockResolvedValue({data: {}});
      await fn();
      expect(callMock).toHaveBeenLastCalledWith(path, {bearer: 'jwt', signal: undefined});
    }
  });

  it('every POST returns the whole page — callers overwrite local state instead of re-GETting', async () => {
    const page = {default_slippage: '0.020000', trade_confirmation: true, currency: 'USD', slippage_bps: 200};
    callMock.mockResolvedValue({data: page});
    await setSlippage('jwt', '0.02');
    expect(callMock).toHaveBeenCalledWith('/v1/settings/trading/slippage', {
      method: 'POST',
      bearer: 'jwt',
      body: {value: '0.02'},
    });
    await setTradeConfirmation('jwt', false);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/trading/confirmation', {
      method: 'POST',
      bearer: 'jwt',
      body: {enabled: false},
    });
    await setCurrency('jwt', 'cny');
    expect(callMock).toHaveBeenCalledWith('/v1/settings/trading/currency', {
      method: 'POST',
      bearer: 'jwt',
      body: {currency: 'cny'},
    });
    await setFaceId('jwt', true);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/security/face-id', {
      method: 'POST',
      bearer: 'jwt',
      body: {enabled: true},
    });
    await setPushEnabled('jwt', false);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/notifications/push', {
      method: 'POST',
      bearer: 'jwt',
      body: {enabled: false},
    });
    await setFollowingEnabled('jwt', true);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/notifications/following', {
      method: 'POST',
      bearer: 'jwt',
      body: {enabled: true},
    });
    await setTheme('jwt', 'DARK');
    expect(callMock).toHaveBeenCalledWith('/v1/settings/preferences/theme', {
      method: 'POST',
      bearer: 'jwt',
      body: {theme: 'DARK'},
    });
  });

  it('recordKeyExport sends only chain + address — never any key material', async () => {
    callMock.mockResolvedValue({data: {exported: true, count: 1}});
    await recordKeyExport('jwt', 'solana', 'SoLaddr');
    expect(callMock).toHaveBeenCalledWith('/v1/settings/security/key-export', {
      method: 'POST',
      bearer: 'jwt',
      body: {chain: 'solana', address: 'SoLaddr'},
    });
  });

  it('slippage validation mirrors the server: 0 rejected, bounds 0.0001..1, ≤6 decimals', () => {
    expect(validateSlippage('0.02')).toBeNull();
    expect(validateSlippage('0.0001')).toBeNull();
    expect(validateSlippage('1')).toBeNull();
    expect(validateSlippage('0')).toMatch(/不能为 0/);
    expect(validateSlippage('0.00001')).toMatch(/范围/);
    expect(validateSlippage('1.5')).toMatch(/范围/);
    expect(validateSlippage('0.0200001')).toMatch(/6 位小数/);
    expect(validateSlippage('abc')).toMatch(/数字/);
  });
});

describe('profile aggregate / avatar / bio / x-import', () => {
  beforeEach(() => callMock.mockReset());

  it('getProfile hits /v1/profile once per page entry', async () => {
    callMock.mockResolvedValue({data: {user: {identifier: 'id'}, x: {}, quota: {}}});
    await getProfile('jwt');
    expect(callMock).toHaveBeenCalledWith('/v1/profile', {bearer: 'jwt', signal: undefined});
  });

  it('avatar presets and history are separate GETs', async () => {
    callMock.mockResolvedValue({data: {presets: [{id: 'smartx-01', url: 'u'}]}});
    await getAvatarPresets('jwt');
    expect(callMock).toHaveBeenLastCalledWith('/v1/profile/avatar/presets', {bearer: 'jwt', signal: undefined});
    callMock.mockResolvedValue({data: {items: [{url: 'u'}]}});
    await getAvatarHistory('jwt');
    expect(callMock).toHaveBeenLastCalledWith('/v1/profile/avatar/history', {bearer: 'jwt', signal: undefined});
  });

  it('setAvatar sends exactly one of preset_id / url', async () => {
    callMock.mockResolvedValue({data: {user: {}, quota: {}}});
    await setAvatar('jwt', {presetId: 'smartx-01'});
    expect(callMock).toHaveBeenCalledWith('/v1/profile/avatar', {
      method: 'POST',
      bearer: 'jwt',
      body: {preset_id: 'smartx-01'},
    });
    await setAvatar('jwt', {url: 'https://static.smartx.io/avatars/smartx-01.png'});
    expect(callMock).toHaveBeenCalledWith('/v1/profile/avatar', {
      method: 'POST',
      bearer: 'jwt',
      body: {url: 'https://static.smartx.io/avatars/smartx-01.png'},
    });
  });

  it('setBio always includes the bio field — clearing sends empty string, never omits it', async () => {
    callMock.mockResolvedValue({data: {user: {}, quota: {}}});
    await setBio('jwt', '');
    expect(callMock).toHaveBeenCalledWith('/v1/profile/bio', {method: 'POST', bearer: 'jwt', body: {bio: ''}});
  });

  it('importProfileFromX sends field names only, never values', async () => {
    callMock.mockResolvedValue({data: {user: {}, skipped: [{field: 'bio', reason: 'empty'}]}});
    await importProfileFromX('jwt', ['nickname', 'bio']);
    expect(callMock).toHaveBeenCalledWith('/v1/profile/x/import', {
      method: 'POST',
      bearer: 'jwt',
      body: {fields: ['nickname', 'bio']},
    });
  });
});
