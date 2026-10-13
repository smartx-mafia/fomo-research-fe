// @vitest-environment jsdom
import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/envelope';
import {useProfileMedia} from './useProfileMedia';
import {KEYS} from '@/session/storage';

const api = vi.hoisted(() => ({quota: vi.fn(), history: vi.fn(), upload: vi.fn(), query: vi.fn(), apply: vi.fn(), user: vi.fn(), avatar: vi.fn(), success: vi.fn(), error: vi.fn()}));
vi.mock('@/api/profile-media', () => ({MEDIA_PURPOSES: ['avatar', 'background'], getMediaQuota: api.quota, getMediaHistory: api.history, uploadMedia: api.upload, getMediaUpload: api.query, applyMedia: api.apply}));
vi.mock('@/api/auth', () => ({getUserInfo: api.user}));
vi.mock('@/api/settings', () => ({setAvatar: api.avatar}));
vi.mock('sonner', () => ({toast: {success: api.success, error: api.error}}));
const file = () => new File(['image'], 'avatar.png', {type: 'image/png'});
const approved = {operation_id: 'operation-12345678', status: 'approved', asset_id: 'asset-a', url: 'https://image/a.png'};
const original = {identifier: 'me', avatar_url: 'https://image/old.png', background_url: ''};
async function setup() {
  const onSaved = vi.fn();
  const hook = renderHook(() => useProfileMedia('jwt', 'me', onSaved));
  await act(async () => {await hook.result.current.refresh();});
  return {...hook, onSaved};
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  localStorage.setItem(KEYS.jwt, 'jwt'); localStorage.setItem(KEYS.user, JSON.stringify(original));
  vi.stubGlobal('URL', Object.assign(URL, {createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn()}));
  api.quota.mockResolvedValue({data: {upload_enabled: true, limit: 5, remaining: 5}});
  api.history.mockResolvedValue({data: {items: []}});
  api.upload.mockResolvedValue({data: approved});
  api.apply.mockResolvedValue({data: {user: {...original, avatar_url: approved.url}}});
  api.user.mockResolvedValue({data: original});
});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('profile media recovery and saving', () => {
  it('does not apply or change the shared user until Save is requested', async () => {
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file());});
    expect(hook.result.current.drafts.avatar.status).toBe('approved');
    expect(api.apply).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(KEYS.user)!)).toEqual(original);
    await act(async () => {await hook.result.current.save();});
    expect(api.apply).toHaveBeenCalledWith('jwt', 'avatar', 'asset-a', expect.any(AbortSignal));
    expect(JSON.parse(localStorage.getItem(KEYS.user)!).avatar_url).toBe(approved.url);
    expect(api.success).toHaveBeenCalledWith('Profile updated', {duration: 3000});
  });
  it('keeps a rejected draft and never applies it or announces success', async () => {
    api.upload.mockResolvedValue({data: {status: 'rejected', charged: true}});
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file()); await hook.result.current.save();});
    expect(hook.result.current.drafts.avatar.status).toBe('rejected');
    expect(hook.result.current.drafts.avatar.file).toBeDefined();
    expect(api.apply).not.toHaveBeenCalled(); expect(api.success).not.toHaveBeenCalled();
  });
  it('queries the original operation after a network timeout instead of reuploading', async () => {
    api.upload.mockRejectedValue(new ApiError('network', 0, 'timeout'));
    api.query.mockResolvedValue({data: approved});
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file());});
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.query.mock.calls[0][2]).toBe(api.upload.mock.calls[0][3]);
    expect(hook.result.current.drafts.avatar.status).toBe('approved');
  });
  it('bounds pending polling and blocks new files until the operation is resolved', async () => {
    vi.useFakeTimers();
    api.upload.mockResolvedValue({data: {status: 'pending'}});
    api.query.mockResolvedValue({data: {status: 'pending'}});
    const hook = await setup();
    await act(async () => {
      const pending = hook.result.current.submit('avatar', file());
      await vi.advanceTimersByTimeAsync(20_000); await pending;
    });
    expect(api.query).toHaveBeenCalledTimes(8);
    expect(hook.result.current.busy).toBe(false);
    await act(async () => {await hook.result.current.submit('avatar', file());});
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.apply).not.toHaveBeenCalled();
  });
  it('replays the original file and key only after the operation lookup reports missing', async () => {
    api.upload.mockRejectedValueOnce(new ApiError('network', 0, 'timeout')).mockResolvedValue({data: approved});
    api.query.mockRejectedValue(new ApiError('business', 200117, 'not found'));
    const hook = await setup();
    const selected = file();
    await act(async () => {await hook.result.current.submit('avatar', selected);});
    expect(hook.result.current.drafts.avatar.missing).toBe(true);
    await act(async () => {await hook.result.current.submit('avatar', undefined, true);});
    expect(api.upload.mock.calls[1][2]).toBe(selected);
    expect(api.upload.mock.calls[1][3]).toBe(api.upload.mock.calls[0][3]);
    expect(hook.result.current.drafts.avatar.status).toBe('approved');
  });
  it('keeps an unresolved locator when checking fails rather than abandoning the operation', async () => {
    api.upload.mockRejectedValue(new ApiError('network', 0, 'offline'));
    api.query.mockRejectedValue(new ApiError('network', 0, 'offline'));
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file());});
    const locator = hook.result.current.drafts.avatar.operationID;
    act(() => hook.result.current.discard('avatar'));
    expect(hook.result.current.drafts.avatar.operationID).toBe(locator);
    expect(api.upload).toHaveBeenCalledTimes(1);
  });
  it('requires 30 seconds and a new operation ID after an explicit technical failure', async () => {
    vi.useFakeTimers(); api.upload.mockResolvedValue({data: {status: 'failed'}});
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file());});
    const oldKey = api.upload.mock.calls[0][3];
    await act(async () => {await hook.result.current.submit('avatar');});
    expect(api.upload).toHaveBeenCalledTimes(1);
    await act(async () => {await vi.advanceTimersByTimeAsync(30_000);});
    await act(async () => {await hook.result.current.submit('avatar');});
    expect(api.upload).toHaveBeenCalledTimes(2);
    expect(api.upload.mock.calls[1][3]).not.toBe(oldKey);
  });
  it('remembers partial success and retries only the failed application', async () => {
    const hook = await setup();
    act(() => {hook.result.current.choose('avatar', {asset_id: 'a', url: 'https://image/a'}); hook.result.current.choose('background', {asset_id: 'b', url: 'https://image/b'});});
    api.apply.mockResolvedValueOnce({data: {user: {...original, avatar_url: 'https://image/a'}}}).mockRejectedValueOnce(new ApiError('business', 500097, 'failure'));
    await act(async () => {await hook.result.current.save();});
    expect(hook.result.current.drafts.avatar.status).toBe('saved');
    expect(hook.result.current.drafts.background.status).toBe('approved');
    expect(api.success).not.toHaveBeenCalled();
    api.apply.mockResolvedValue({data: {user: {...original, avatar_url: 'https://image/a', background_url: 'https://image/b'}}});
    await act(async () => {await hook.result.current.save();});
    expect(api.apply.mock.calls.map((args) => args[1])).toEqual(['avatar', 'background', 'background']);
    expect(api.success).toHaveBeenCalledTimes(1); expect(api.upload).not.toHaveBeenCalled();
  });
  it('confirms a timed out apply from current user information without reuploading', async () => {
    const hook = await setup();
    act(() => hook.result.current.choose('avatar', {asset_id: 'a', url: approved.url}));
    api.apply.mockRejectedValue(new ApiError('network', 0, 'timeout'));
    api.user.mockResolvedValue({data: {...original, avatar_url: approved.url}});
    await act(async () => {await hook.result.current.save();});
    expect(hook.result.current.drafts.avatar.status).toBe('saved');
    expect(api.upload).not.toHaveBeenCalled(); expect(api.success).toHaveBeenCalledTimes(1);
  });
  it('uses the legacy avatar endpoint only for trusted returned history without asset_id', async () => {
    api.avatar.mockResolvedValue({data: {user: {...original, avatar_url: 'https://trusted/x'}}});
    const hook = await setup();
    act(() => hook.result.current.choose('avatar', {url: 'https://trusted/x'}));
    await act(async () => {await hook.result.current.save();});
    expect(api.avatar).toHaveBeenCalledWith('jwt', {url: 'https://trusted/x'}, expect.any(AbortSignal));
    expect(api.apply).not.toHaveBeenCalled();
  });
  it('allows history switching with uploads disabled', async () => {
    api.quota.mockResolvedValue({data: {upload_enabled: false, remaining: 5}});
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file());});
    expect(api.upload).not.toHaveBeenCalled();
    act(() => hook.result.current.choose('avatar', {asset_id: 'a', url: approved.url}));
    await act(async () => {await hook.result.current.save();});
    expect(api.apply).toHaveBeenCalledTimes(1);
  });
  it('restores operation locators across remounts and confirms noop against current profile', async () => {
    const hook = await setup();
    await act(async () => {await hook.result.current.submit('avatar', file());});
    const id = api.upload.mock.calls[0][3];
    hook.unmount();
    api.query.mockResolvedValue({data: {status: 'noop'}});
    const restored = await setup();
    expect(restored.result.current.drafts.avatar.operationID).toBe(id);
    await act(async () => {await restored.result.current.check('avatar');});
    expect(restored.onSaved).toHaveBeenCalledWith(original);
    expect(api.apply).not.toHaveBeenCalled();
  });
  it('ignores late responses after the editor unmounts', async () => {
    let resolve!: (value: unknown) => void;
    api.upload.mockImplementation(() => new Promise((done) => {resolve = done;}));
    const hook = await setup();
    let uploading!: Promise<void>;
    act(() => {uploading = hook.result.current.submit('avatar', file());});
    hook.unmount();
    await act(async () => {resolve({data: approved}); await uploading;});
    expect(hook.onSaved).not.toHaveBeenCalled(); expect(api.success).not.toHaveBeenCalled();
  });
});
