// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {PortfolioProfile} from './PortfolioProfile';
import {KEYS} from '@/session/storage';
const api = vi.hoisted(() => ({getProfile: vi.fn()}));
vi.mock('@/api/settings', () => ({getProfile: api.getProfile}));
vi.mock('./ProfileMediaEditor', () => ({ProfileMediaEditor: ({onSaved}: {onSaved: (user: unknown) => void}) => <button onClick={() => onSaved({identifier: 'me', nickname: 'Saved user', avatar_url: 'https://images/new-avatar', background_url: 'https://images/new-background'})}>Save image test</button>}));
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(KEYS.jwt, 'jwt'); localStorage.setItem(KEYS.user, JSON.stringify({identifier: 'me'}));
  api.getProfile.mockResolvedValue({data: {user: {identifier: 'me', nickname: 'Current user', avatar_url: 'https://images/avatar', background_url: 'https://images/background'}}});
});
afterEach(cleanup);
it('loads current media, synchronizes shared user data and displays applied images', async () => {
  render(<PortfolioProfile bearer="jwt" initialUser={{identifier: 'me'}} />);
  await screen.findByText('Current user');
  expect(screen.getByRole('img', {name: 'Profile background'}).getAttribute('src')).toBe('https://images/background');
  expect(JSON.parse(localStorage.getItem(KEYS.user)!).background_url).toBe('https://images/background');
  fireEvent.click(screen.getByRole('button', {name: 'Save image test'}));
  expect(screen.getByRole('img', {name: 'Profile background'}).getAttribute('src')).toBe('https://images/new-background');
  expect(screen.getByRole('img', {name: 'Saved user avatar'}).getAttribute('src')).toBe('https://images/new-avatar');
});
