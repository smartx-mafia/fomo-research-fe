// @vitest-environment jsdom
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {useTokenRisk} from './useTokenRisk';
import {normalizeTokenRisk} from '@/lib/token-risk';
import type {ReactNode} from 'react';
const {getMock} = vi.hoisted(() => ({getMock: vi.fn()}));
vi.mock('@/api/token-risk', () => ({getTokenRisk: getMock}));
function snapshot(address: string, version = 'v1') {
  return {chain: 'solana', address, risk: normalizeTokenRisk({assessment: {mode: 'enforce', grade: 4, buy_action: 'confirm', confirmation_version: version, items: [{code: 'goplus_mintable', grade: 4}]}})};
}
beforeEach(() => {getMock.mockReset();});
afterEach(cleanup);
function wrapper() {
  const cache = new Map();
  return function Wrapper({children}: {children: ReactNode}) {return <SWRConfig value={{provider: () => cache, dedupingInterval: 0}}>{children}</SWRConfig>;};
}
it('retains the last known risks after refresh failure', async () => {
  getMock.mockResolvedValue(snapshot('A'));
  const {result} = renderHook(() => useTokenRisk('solana', 'A'), {wrapper: wrapper()});
  await waitFor(() => expect(result.current.risk?.grade).toBe(4));
  getMock.mockRejectedValue(new Error('offline'));
  await act(async () => {await expect(result.current.refresh()).rejects.toThrow('offline');});
  expect(result.current.risk?.grade).toBe(4);
  expect(result.current.risk?.items).toHaveLength(1);
  expect(result.current.error).toBeInstanceOf(Error);
});
it('shares manual refresh failures with other consumers and clears them on success', async () => {
  getMock.mockResolvedValue(snapshot('A'));
  const {result} = renderHook(() => ({first: useTokenRisk('solana', 'A'), second: useTokenRisk('solana', 'A')}), {wrapper: wrapper()});
  await waitFor(() => expect(result.current.first.risk?.grade).toBe(4));
  getMock.mockRejectedValue(new Error('offline'));
  await act(async () => {await expect(result.current.first.refresh()).rejects.toThrow('offline');});
  expect(result.current.second.error).toBeInstanceOf(Error);
  expect(result.current.second.risk).toBe(result.current.first.risk);
  getMock.mockResolvedValue(snapshot('A'));
  await act(async () => {await result.current.second.refresh();});
  expect(result.current.first.error).toBeUndefined();
  expect(result.current.second.error).toBeUndefined();
});
it('refresh returns the fresh RPC object, never the prior render snapshot', async () => {
  getMock.mockResolvedValue(snapshot('A'));
  const {result} = renderHook(() => useTokenRisk('solana', 'A'), {wrapper: wrapper()});
  await waitFor(() => expect(result.current.risk?.confirmationVersion).toBe('v1'));
  const fresh = snapshot('A', 'v2');
  getMock.mockResolvedValue(fresh);
  await act(async () => {expect(await result.current.refresh()).toBe(fresh);});
  expect(result.current.risk?.confirmationVersion).toBe('v2');
});
it('does not carry token A risks into token B while its RPC is pending', async () => {
  getMock.mockResolvedValue(snapshot('A'));
  const {result, rerender} = renderHook(({address}) => useTokenRisk('solana', address), {initialProps: {address: 'A'}, wrapper: wrapper()});
  await waitFor(() => expect(result.current.risk?.grade).toBe(4));
  getMock.mockImplementation(() => new Promise(() => {}));
  rerender({address: 'B'});
  expect(result.current.risk).toBeUndefined();
});
it('a manual refresh started on A cannot publish its late result into B', async () => {
  getMock.mockResolvedValue(snapshot('A'));
  const {result, rerender} = renderHook(({address}) => useTokenRisk('solana', address), {initialProps: {address: 'A'}, wrapper: wrapper()});
  await waitFor(() => expect(result.current.risk?.confirmationVersion).toBe('v1'));
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  getMock.mockImplementationOnce(() => new Promise((r) => {resolve = r;}));
  let pending!: ReturnType<typeof result.current.refresh>;
  act(() => {pending = result.current.refresh();});
  getMock.mockResolvedValue(snapshot('B', 'B-version'));
  rerender({address: 'B'});
  await waitFor(() => expect(result.current.risk?.confirmationVersion).toBe('B-version'));
  await act(async () => {resolve(snapshot('A', 'A-late')); await pending;});
  expect(result.current.risk?.confirmationVersion).toBe('B-version');
});
it('out-of-order manual refreshes cannot replace a newer assessment in the cache', async () => {
  getMock.mockResolvedValue(snapshot('A'));
  const {result} = renderHook(() => useTokenRisk('solana', 'A'), {wrapper: wrapper()});
  await waitFor(() => expect(result.current.risk?.confirmationVersion).toBe('v1'));
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  getMock.mockImplementationOnce(() => new Promise((r) => {resolve = r;}));
  let pending!: ReturnType<typeof result.current.refresh>;
  act(() => {pending = result.current.refresh();});
  getMock.mockResolvedValue(snapshot('A', 'newest'));
  await act(async () => {await result.current.refresh();});
  await act(async () => {resolve(snapshot('A', 'older')); await pending;});
  expect(result.current.risk?.confirmationVersion).toBe('newest');
});
