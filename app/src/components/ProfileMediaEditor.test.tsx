// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ProfileMediaEditor} from './ProfileMediaEditor';
import {MAX_IMAGE_BYTES} from '@/lib/profile-image';
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
afterEach(cleanup);
async function open() {
  render(<ProfileMediaEditor bearer="jwt" user={user} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Edit images'}));
  await screen.findByRole('button', {name: 'Use recent avatar 1'});
}
describe('profile image editor', () => {
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
  it('rejects an oversized original before crop and keeps the previous image', async () => {
    await open();
    const file = new File(['x'], 'avatar.png', {type: 'image/png'});
    Object.defineProperty(file, 'size', {value: MAX_IMAGE_BYTES + 1});
    fireEvent.change(screen.getByLabelText('Choose avatar'), {target: {files: [file]}});
    await screen.findByText('Image is too large. Max 10MB.');
    expect(screen.queryByLabelText('Crop avatar')).toBeNull();
    expect(screen.getByRole('img', {name: 'avatar preview'}).getAttribute('src')).toBe(user.avatar_url);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
