// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ProfileMediaEditor} from './ProfileMediaEditor';
import * as profileImage from '@/lib/profile-image';
import {KEYS} from '@/session/storage';

const mocks = vi.hoisted(() => ({quota: vi.fn(), history: vi.fn(), apply: vi.fn(), upload: vi.fn(), success: vi.fn(), error: vi.fn()}));
vi.mock('@/api/profile-media', () => ({MEDIA_PURPOSES: ['avatar', 'background'], getMediaQuota: mocks.quota, getMediaHistory: mocks.history, applyMedia: mocks.apply, uploadMedia: mocks.upload}));
vi.mock('sonner', () => ({toast: {success: mocks.success, error: mocks.error}}));
const user = {identifier: 'me', avatar_url: 'https://images/old.png', background_url: ''};
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  localStorage.setItem(KEYS.jwt, 'jwt'); localStorage.setItem(KEYS.user, JSON.stringify(user));
  mocks.quota.mockResolvedValue({data: {upload_enabled: true, remaining: 5, limit: 5}});
  mocks.history.mockImplementation((_bearer, purpose) => Promise.resolve({data: {items: [{asset_id: `${purpose}-asset`, url: `https://images/${purpose}.png`}]}}));
  mocks.apply.mockResolvedValue({data: {user: {...user, avatar_url: 'https://images/avatar.png'}}});
});
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
async function open() {
  render(<ProfileMediaEditor bearer="jwt" user={user} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Edit images'}));
  await screen.findByRole('button', {name: 'Use recent avatar 1'});
}
describe('profile image editor', () => {
  it.each([
    {width: 1600, height: 900, left: 350, top: 0, side: 900},
    {width: 900, height: 1600, left: 0, top: 350, side: 900},
    {width: 80, height: 40, left: 20, top: 0, side: 40},
  ])('crops a $width × $height original into a square before uploading the avatar', async ({width, height, left, top, side}) => {
    const image = new Image();
    Object.defineProperties(image, {naturalWidth: {value: width}, naturalHeight: {value: height}});
    vi.spyOn(profileImage, 'readProfileImage').mockResolvedValue({image, url: 'blob:original'});
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage, clearRect: vi.fn()} as unknown as CanvasRenderingContext2D);
    const exports: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      exports.push([this.width, this.height]);
      callback(new Blob(['cropped pixels'], {type}));
    });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:cropped');
      static revokeObjectURL = vi.fn();
    });
    mocks.upload.mockResolvedValue({data: {status: 'approved', asset_id: 'cropped-asset', url: 'https://images/cropped.png'}});
    await open();
    const original = new File(['original pixels'], 'landscape-or-portrait.jpg', {type: 'image/jpeg'});
    fireEvent.change(screen.getByLabelText('Choose avatar'), {target: {files: [original]}});
    await screen.findByLabelText('Crop avatar');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenLastCalledWith(image, left, top, side, side, 0, 0, 600, 600);
    fireEvent.click(screen.getByRole('button', {name: 'Upload for review'}));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(exports).toEqual([[512, 512]]);
    expect(drawImage).toHaveBeenLastCalledWith(image, left, top, side, side, 0, 0, 512, 512);
    const uploaded = mocks.upload.mock.calls[0][2] as File;
    expect(uploaded).not.toBe(original);
    expect(uploaded.name).toBe('avatar.png');
    expect(uploaded.type).toBe('image/png');
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('disables new uploads when the switch is off but lets the user apply history', async () => {
    mocks.quota.mockResolvedValue({data: {upload_enabled: false, remaining: 5, limit: 5}});
    await open();
    expect((screen.getByLabelText('Choose avatar') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', {name: 'Use recent avatar 1'}));
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('keeps the selected draft when closing and reopening the editor', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', {name: 'Use recent avatar 1'}));
    fireEvent.click(screen.getByRole('button', {name: 'Close image editor'}));
    fireEvent.click(screen.getByRole('button', {name: 'Edit images'}));
    expect(screen.getByRole('img', {name: 'avatar preview'}).getAttribute('src')).toBe('https://images/avatar.png');
    expect((screen.getByRole('button', {name: 'Save changes'}) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('does not show an error when system file selection is cancelled', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Choose avatar'), {target: {files: []}});
    expect(mocks.error).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('allows a large original to reach the crop step without a frontend size check', async () => {
    const image = new Image();
    Object.defineProperties(image, {naturalWidth: {value: 800}, naturalHeight: {value: 400}});
    vi.spyOn(profileImage, 'readProfileImage').mockResolvedValue({image, url: 'blob:large'});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage: vi.fn(), clearRect: vi.fn()} as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('URL', class extends URL {static revokeObjectURL = vi.fn();});
    await open();
    const file = new File(['x'], 'avatar.png', {type: 'image/png'});
    Object.defineProperty(file, 'size', {value: 20 * 1024 * 1024});
    fireEvent.change(screen.getByLabelText('Choose avatar'), {target: {files: [file]}});
    await screen.findByLabelText('Crop avatar');
    fireEvent.change(screen.getByLabelText('Zoom multiplier'), {target: {value: '25'}});
    expect((screen.getByLabelText('Zoom multiplier') as HTMLInputElement).value).toBe('25');
    expect(screen.getByRole('img', {name: 'avatar preview'}).getAttribute('src')).toBe(user.avatar_url);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
