import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  deletePushDevice,
  getAvatarHistory,
  getAvatarPresets,
  getNotificationSettings,
  getPreferences,
  getProfile,
  getSecuritySettings,
  getTradingSettings,
  importProfileFromX,
  listPushDevices,
  recordKeyExport,
  registerPushDevice,
  setAvatar,
  setBio,
  setCurrency,
  setDeviceEnabled,
  setFaceId,
  setFollowingEnabled,
  setPushEnabled,
  setSlippage,
  setTheme,
  setTradeConfirmation,
  setXAutoFollow,
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

describe('push devices (settings.md §2) + x_auto_follow (§1.4)', () => {
  beforeEach(() => callMock.mockReset());

  it('registerPushDevice posts the full body to /v1/settings/devices/register', async () => {
    callMock.mockResolvedValue({data: {id: 1024, created: true}});
    const input = {
      push_token: 'ExponentPushToken[a1b2c3d4e5f6g7h8i9j0]',
      platform: 'ios' as const,
      device_name: 'iPhone 15 Pro',
      manufacturer: 'Apple',
      model: 'iPhone16,1',
      os_version: '17.5',
      app_version: '1.2.0',
    };
    await registerPushDevice('jwt', input);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/devices/register', {
      method: 'POST',
      bearer: 'jwt',
      body: input,
    });
  });

  it('listPushDevices builds the query with cursor/limit/platform/status in order', async () => {
    callMock.mockResolvedValue({data: {list: [], next_cursor: 1024, has_more: true}});
    await listPushDevices('jwt', {cursor: 1024, limit: 100, platform: 'android', status: 'disabled'});
    expect(callMock).toHaveBeenCalledWith('/v1/settings/devices?cursor=1024&limit=100&platform=android&status=disabled', {
      bearer: 'jwt',
      signal: undefined,
    });
  });

  it('listPushDevices omits empty params, and status "all" is never sent (it is the server default)', async () => {
    callMock.mockResolvedValue({data: {list: [], has_more: false}});
    await listPushDevices('jwt', {status: 'all'});
    expect(callMock).toHaveBeenLastCalledWith('/v1/settings/devices', {bearer: 'jwt', signal: undefined});
    await listPushDevices('jwt');
    expect(callMock).toHaveBeenLastCalledWith('/v1/settings/devices', {bearer: 'jwt', signal: undefined});
    await listPushDevices('jwt', {limit: 50, status: 'enabled'});
    expect(callMock).toHaveBeenLastCalledWith('/v1/settings/devices?limit=50&status=enabled', {
      bearer: 'jwt',
      signal: undefined,
    });
  });

  it('setDeviceEnabled posts {id, enabled} and deletePushDevice posts {id}', async () => {
    callMock.mockResolvedValue({data: {id: 7, enabled: false}});
    await setDeviceEnabled('jwt', 7, false);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/devices/enabled', {
      method: 'POST',
      bearer: 'jwt',
      body: {id: 7, enabled: false},
    });
    callMock.mockResolvedValue({data: {deleted: true}});
    await deletePushDevice('jwt', 7);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/devices/delete', {
      method: 'POST',
      bearer: 'jwt',
      body: {id: 7},
    });
  });

  it('setXAutoFollow posts {enabled} and returns the whole preferences page', async () => {
    const page = {language: 'en', theme: 'dark', x_auto_follow: false};
    callMock.mockResolvedValue({data: page});
    const res = await setXAutoFollow('jwt', false);
    expect(callMock).toHaveBeenCalledWith('/v1/settings/preferences/x-auto-follow', {
      method: 'POST',
      bearer: 'jwt',
      body: {enabled: false},
    });
    expect(res.data).toEqual(page); // 回整页 —— 调用方直接覆盖本地状态
  });
});
