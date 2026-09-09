// @vitest-environment jsdom
import React, {act, useEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {control} = vi.hoisted(() => ({control: {loading: false, error: undefined as Error | undefined, mounted: 0, unmounted: 0}}));
vi.mock('@privy-io/react-auth', () => ({usePrivy: () => ({ready: true, authenticated: true, user: {id: 'did:test'}})}));
vi.mock('@/session/storage', () => ({useSession: () => ({jwt: 'test', user: {identifier: 'owner'}}), readSite: () => ({jwt: 'test'}), clearSite: vi.fn()}));
vi.mock('@/components/FiatDepositCard', () => ({FiatDepositCard: () => null}));
vi.mock('@/components/DepositAddresses', () => ({DepositAddresses: () => null}));
vi.mock('@/components/SweepDepositCard', () => ({SweepDepositCard: () => {
  useEffect(() => {control.mounted++; return () => {control.unmounted++;};}, []);
  return <div>Known sweep recovery available</div>;
}}));
vi.mock('swr', () => ({default: (key: string[]) => {
  if (key[0].startsWith('deposit-portfolio')) return {data: {positions: [], partial_errors: []}, error: control.error, isLoading: control.loading, mutate: vi.fn()};
  if (key[0] === 'deposit-addresses') return {data: [], isLoading: false};
  return {data: {identifier: 'owner', privy_did: 'did:test'}, isLoading: false};
}}));
import {DepositView} from './DepositView';

describe('Portfolio-independent sweep recovery', () => {
  let element: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    control.loading = true; control.error = undefined; control.mounted = 0; control.unmounted = 0;
    element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  });
  afterEach(async () => {await act(async () => root.unmount()); element.remove();});
  it('keeps the recovery component mounted through Portfolio loading and failure', async () => {
    await act(async () => root.render(<DepositView />));
    expect(element.textContent).toContain('Known sweep recovery available');
    control.loading = false; control.error = new Error('portfolio schema mismatch');
    await act(async () => root.render(<DepositView />));
    expect(element.textContent).toContain('Known sweep recovery available');
    expect(control.mounted).toBe(1); expect(control.unmounted).toBe(0);
  });
});
