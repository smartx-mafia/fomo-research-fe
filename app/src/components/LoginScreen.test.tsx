// @vitest-environment jsdom
import React from 'react';
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {LoginScreen} from './LoginScreen';

const state = vi.hoisted(() => ({missing: [] as string[], renderLogin: vi.fn()}));
vi.mock('@/config', () => ({missingConfig: () => state.missing}));
vi.mock('@/components/LoginBench', () => ({LoginBench: () => {
  state.renderLogin();
  if (state.missing.length) throw new Error('OAuth hook called without PrivyProvider');
  return <button>登录</button>;
}}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows actionable configuration feedback without mounting provider-dependent login hooks', () => {
  state.missing = ['NEXT_PUBLIC_PRIVY_APP_ID'];
  render(<LoginScreen />);
  expect(screen.getByRole('alert').textContent).toContain('NEXT_PUBLIC_PRIVY_APP_ID');
  expect(screen.getByRole('alert').textContent).toContain('重新部署');
  expect(state.renderLogin).not.toHaveBeenCalled();
});

it('mounts the login UI when the provider configuration is present', () => {
  state.missing = [];
  render(<LoginScreen />);
  expect(screen.getByRole('button', {name: '登录'})).toBeTruthy();
  expect(state.renderLogin).toHaveBeenCalled();
});
