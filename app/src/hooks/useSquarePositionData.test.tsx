// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
const {current, cycle, capability, subject, snapshot, history} = vi.hoisted(() => ({current: vi.fn(), cycle: vi.fn(), capability: vi.fn(), subject: vi.fn(), snapshot: vi.fn(), history: vi.fn()}));
vi.mock('@/api/user-portfolio', () => ({getUserPortfolio: current, getUserPortfolioPosition: cycle}));
vi.mock('@/api/square-position', () => ({getSquarePositionCapability: capability, getSquareSmartMoneyPosition: snapshot, getSquarePositionTrades: history}));
import {useSquarePositionData} from './useSquarePositionData';
import {ApiError} from '@/api/envelope';
import type {SquarePositionTarget} from '@/lib/square-position';
const target: SquarePositionTarget = {kind: 'user', identifier: 'alice', name: 'Alice', chain: 'bsc', address: '0xabc', cycleKey: 'old-cycle'};
const position = {asset: {chain: 'bsc', token_address: '0xabc'}, shares_raw: '12', decimals: 0, cycle_key: 'old-cycle', realized_pnl_usd: '7', total_pnl_usd: '8'};
function Probe({target}: {target: SquarePositionTarget}) {
  const data = useSquarePositionData(target, 'jwt');
  return <output data-testid="result">{JSON.stringify(data)}</output>;
}
function mount(value = target) {return render(<SWRConfig value={{provider: () => new Map(), dedupingInterval: 0}}><Probe target={value} /></SWRConfig>);}
beforeEach(() => {
  current.mockResolvedValue({positions: [{...position, cycle_key: 'current-cycle'}]});
  cycle.mockResolvedValue({status: 'closed', position, completeness: 'complete', trades: [{side: 'sell', trade_value_usd: '7', execution_price_usd: undefined, created_at: '2026-10-11T00:00:00Z'}]});
  capability.mockResolvedValue({ready: true});
  subject.mockResolvedValue({data: {profile: {tags: ['FOMO']}}});
  snapshot.mockResolvedValue({holding: {state: 'open', quantity: '5', valueUSD: '10', pnlUSD: undefined}, coverage: 'partial', stale: false});
  history.mockResolvedValue({list: [{event: 'transfer_in', amountUSD: undefined}], coverage: 'partial'});
});
afterEach(() => {cleanup(); vi.useRealTimers(); vi.resetAllMocks();});
it('reads a known platform cycle directly, without current holdings or smart-money requests', async () => {
  mount({...target, closedHint: true});
  await waitFor(() => expect(screen.getByTestId('result').textContent).toContain('"state":"closed"'));
  expect(cycle.mock.calls[0].slice(0, 3)).toEqual(['alice', {chain: 'bsc', asset: '0xabc', cycle_key: 'old-cycle'}, 'jwt']);
  expect(current).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
});
it('resolves a missing platform cycle from the selected author before requesting detail', async () => {
  mount({...target, cycleKey: undefined});
  await waitFor(() => expect(cycle).toHaveBeenCalled());
  expect(current.mock.calls[0].slice(0, 3)).toEqual(['alice', 'jwt', false]);
  expect(cycle.mock.calls[0][1].cycle_key).toBe('current-cycle');
});
it('never resolves a closed card without a cycle from the current reopened position', async () => {
  mount({...target, cycleKey: undefined, closedHint: true});
  expect(screen.getByTestId('result').textContent).toContain('历史持仓未提供周期标识');
  expect(current).not.toHaveBeenCalled();
  expect(cycle).not.toHaveBeenCalled();
});
it('reads wallet snapshot and transaction facts independently without platform portfolio', async () => {
  mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await waitFor(() => expect(screen.getByTestId('result').textContent).toContain('transfer_in'));
  expect(snapshot).toHaveBeenCalled();
  expect(history).toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  expect(cycle).not.toHaveBeenCalled();
});
it('uses the explicit subject directly without relying on platform tags or its pool wallet', async () => {
  const value = {...target, kind: 'external_user', identifier: 'subject:3', cycleKey: undefined} as const;
  mount(value);
  await waitFor(() => expect(snapshot).toHaveBeenCalled());
  expect(subject).not.toHaveBeenCalled();
  expect(snapshot.mock.calls[0][0].identifier).toBe('subject:3');
  expect(history.mock.calls[0][0].identifier).toBe('subject:3');
  expect(current).not.toHaveBeenCalled();
});
it('aborts pending wallet requests when the modal closes', async () => {
  snapshot.mockReturnValue(new Promise(() => {}));
  history.mockReturnValue(new Promise(() => {}));
  const view = mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await waitFor(() => expect(snapshot).toHaveBeenCalled());
  const snapshotSignal = snapshot.mock.calls[0][1] as AbortSignal;
  const historySignal = history.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(snapshotSignal.aborted).toBe(true);
  expect(historySignal.aborted).toBe(true);
});
it('does not let complete history hide partial holding coverage', async () => {
  history.mockResolvedValue({list: [], coverage: 'complete'});
  mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await waitFor(() => expect(screen.getByTestId('result').textContent).toContain('"holding"'));
  expect(screen.getByTestId('result').textContent).toContain('"coverage":"partial"');
});
it.each(['pending', 'open'])('polls only the opened %s position while its source refresh is pending, then stops', async (state) => {
  vi.useFakeTimers();
  snapshot.mockResolvedValueOnce({holding: {state, observation: {status: 'pending_source_refresh'}}, stale: false})
    .mockResolvedValue({holding: {state: 'open', quantity: '5', observation: {status: 'source_reported'}}, stale: false});
  const view = mount({...target, kind: 'external_user', identifier: 'subject:3', cycleKey: undefined});
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(snapshot).toHaveBeenCalledTimes(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(10_000);});
  expect(snapshot).toHaveBeenCalledTimes(2);
  await act(async () => {await vi.advanceTimersByTimeAsync(30_000);});
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(history).toHaveBeenCalledTimes(1);
  view.unmount();
});
it('stops a pending position polling when the modal unmounts', async () => {
  vi.useFakeTimers();
  snapshot.mockResolvedValue({holding: {state: 'pending', observation: {status: 'pending_source_refresh'}}, stale: false});
  const view = mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(snapshot).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => {await vi.advanceTimersByTimeAsync(30_000);});
  expect(snapshot).toHaveBeenCalledTimes(1);
});
it('recovers automatically after one pending snapshot polling network failure', async () => {
  vi.useFakeTimers();
  snapshot.mockResolvedValueOnce({holding: {state: 'pending', observation: {status: 'pending_source_refresh'}}, stale: false})
    .mockRejectedValueOnce(new ApiError('network', 0, 'temporary outage'))
    .mockResolvedValue({holding: {state: 'open', quantity: '7', observation: {status: 'source_reported'}}, stale: false});
  mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await act(async () => {await vi.advanceTimersByTimeAsync(10_001);});
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('result').textContent).toContain('"positionError"');
  await act(async () => {await vi.advanceTimersByTimeAsync(10_000);});
  expect(snapshot).toHaveBeenCalledTimes(3);
  expect(screen.getByTestId('result').textContent).toContain('"quantity":"7"');
  expect(screen.getByTestId('result').textContent).not.toContain('"positionError"');
  await act(async () => {await vi.advanceTimersByTimeAsync(30_000);});
  expect(snapshot).toHaveBeenCalledTimes(3);
  expect(history).toHaveBeenCalledTimes(1);
});
it('bounds consecutive snapshot retries at three and retains the error for manual refresh', async () => {
  vi.useFakeTimers();
  snapshot.mockResolvedValueOnce({holding: {state: 'pending'}, stale: false}).mockRejectedValue(new ApiError('network', 0, 'offline'));
  mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await act(async () => {await vi.advanceTimersByTimeAsync(120_001);});
  expect(snapshot).toHaveBeenCalledTimes(5); // 首次成功、一次轮询失败、三次重试。
  expect(screen.getByTestId('result').textContent).toContain('"positionError"');
});
it('cancels an already scheduled snapshot retry when the dialog closes', async () => {
  vi.useFakeTimers();
  snapshot.mockResolvedValueOnce({holding: {state: 'pending'}, stale: false}).mockRejectedValue(new ApiError('network', 0, 'offline'));
  const view = mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await act(async () => {await vi.advanceTimersByTimeAsync(10_001);});
  expect(snapshot).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {await vi.advanceTimersByTimeAsync(60_000);});
  expect(snapshot).toHaveBeenCalledTimes(2);
});
it.each([new ApiError('business', 400000, 'expired'), new ApiError('business', 100101, 'invalid arguments'), new ApiError('transport', 401, 'unauthorized'), new ApiError('transport', 400, 'bad request')])('does not retry authentication or argument rejection %s', async (error) => {
  vi.useFakeTimers();
  snapshot.mockRejectedValue(error);
  mount({...target, kind: 'wallet', identifier: '0xwallet', cycleKey: undefined});
  await act(async () => {await vi.advanceTimersByTimeAsync(60_001);});
  expect(snapshot).toHaveBeenCalledTimes(1);
});
