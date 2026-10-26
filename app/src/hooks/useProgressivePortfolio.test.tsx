// @vitest-environment jsdom
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/envelope';
import type {PartName, PartRequest, PortfolioPart} from '@/api/portfolio-parts';
const {read} = vi.hoisted(() => ({read: vi.fn()}));
vi.mock('@/api/portfolio-parts', async load => ({...await load<typeof import('@/api/portfolio-parts')>(), getPortfolioPart: read}));
import {useProgressivePortfolio} from './useProgressivePortfolio';
function reply(part: PartName, req: PartRequest): PortfolioPart {
  return {meta: {read_id: req.read_id, snapshot_id: 'snapshot', expires_at: {seconds: Math.floor(Date.now() / 1000) + 30}}, window: req.window, window_context: 'ctx', positions: [], partial_errors: [], next_cursor: part === 'positions' ? 'next+/=' : '', total_count: 45, page_expires_at: {seconds: Math.floor(Date.now() / 1000) + 120}};
}
beforeEach(() => read.mockReset().mockImplementation((_id, part, req) => Promise.resolve(reply(part, req))));
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it('starts four independent reads and displays cash while current is pending', async () => {
  read.mockImplementation((_id, part, req) => part === 'current' ? new Promise(() => {}) : Promise.resolve(reply(part, req)));
  const {result} = renderHook(() => useProgressivePortfolio('user', 'jwt'));
  await waitFor(() => expect(result.current.parts.cash.data).toBeDefined());
  expect(result.current.parts.current.loading).toBe(true);
  expect(read).toHaveBeenCalledTimes(4);
  expect(new Set(read.mock.calls.map(c => c[2].read_id)).size).toBe(1);
  expect(read.mock.calls.every(c => c[3] === 'jwt')).toBe(true);
});
it('uses the original page cursor after read expiry and locks duplicate load-more calls', async () => {
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  const {result} = renderHook(() => useProgressivePortfolio('user'));
  await waitFor(() => expect(result.current.parts.positions.data).toBeDefined());
  const original = result.current.parts.positions.data!;
  vi.mocked(Date.now).mockReturnValue(now + 45000);
  let finish!: (v: PortfolioPart) => void;
  read.mockImplementation(() => new Promise<PortfolioPart>(resolve => {finish = resolve;}));
  act(() => {void result.current.more(); void result.current.more();});
  expect(read).toHaveBeenCalledTimes(5);
  expect(read.mock.calls[4][2]).toMatchObject({read_id: original.meta.read_id, snapshot_id: 'snapshot', cursor: 'next+/='});
  await act(async () => finish({...original, next_cursor: ''}));
  await act(async () => result.current.more()); expect(read).toHaveBeenCalledTimes(5);
});
it('discards late previous-user responses', async () => {
  const pending: (() => void)[] = [];
  read.mockImplementation((id, part, req) => id === 'old' ? new Promise(resolve => pending.push(() => resolve({...reply(part, req), cash_balance_usd: '999'}))) : Promise.resolve({...reply(part, req), cash_balance_usd: '1'}));
  const {result, rerender} = renderHook(({id}) => useProgressivePortfolio(id), {initialProps: {id: 'old'}});
  rerender({id: 'new'});
  await waitFor(() => expect(result.current.parts.cash.data?.cash_balance_usd).toBe('1'));
  await act(async () => pending.forEach(f => f()));
  expect(result.current.parts.cash.data?.cash_balance_usd).toBe('1');
});
it('bounds invalid-snapshot recovery instead of looping on the same identifiers', async () => {
  read.mockRejectedValue(new ApiError('business', 430122, 'expired'));
  const {result} = renderHook(() => useProgressivePortfolio('user'));
  await waitFor(() => expect(result.current.parts.current.error).toBeDefined());
  expect(read).toHaveBeenCalledTimes(8);
  expect(new Set(read.mock.calls.map(c => c[2].read_id)).size).toBe(2);
});
it('does not downgrade an expired bearer to anonymous', async () => {
  read.mockRejectedValue(new ApiError('business', 400000, 'expired token'));
  const {result} = renderHook(() => useProgressivePortfolio('user', 'bad-jwt'));
  await waitFor(() => expect(result.current.parts.cash.error).toBeDefined());
  expect(read).toHaveBeenCalledTimes(4); expect(read.mock.calls.every(c => c[3] === 'bad-jwt')).toBe(true);
});
it('switches period inside a valid round, refresh creates a new one', async () => {
  const {result} = renderHook(() => useProgressivePortfolio('user'));
  await waitFor(() => expect(result.current.parts.current.data).toBeDefined());
  const id = result.current.parts.current.data!.meta.read_id;
  await act(async () => result.current.selectWindow('7d'));
  expect(read).toHaveBeenCalledTimes(6); expect(read.mock.calls[4][2]).toMatchObject({read_id: id, window: '7d'});
  expect(read.mock.calls[4][2].window_context).toBeUndefined();
  await act(async () => result.current.refresh());
  expect(read.mock.calls[6][2].read_id).not.toBe(id);
  expect(read.mock.calls.slice(6).every(c => c[2].force_refresh)).toBe(true);
});
it('loads 45 positions as 20/20/5 and stops without changing server totals', async () => {
  const expires = Math.floor(Date.now() / 1000) + 120;
  read.mockImplementation((_id, part, req) => {
    const data = {...reply(part, req), total_assets_usd: '999', page_expires_at: {seconds: expires}};
    if (part === 'positions') {
      const offset = req.cursor === 'p2' ? 20 : req.cursor === 'p3' ? 40 : 0;
      data.positions = Array.from({length: Math.min(20, 45 - offset)}, (_, i) => ({asset: {chain: 'solana', chain_id: '1', kind: 'spl', token_address: `mint-${offset + i}`}, shares_raw: '1', opened_entry_id: '0', cycle_key: `cycle-${offset + i}`, cycle_status: 'ready' as const}));
      data.next_cursor = offset === 0 ? 'p2' : offset === 20 ? 'p3' : '';
    }
    return Promise.resolve(data);
  });
  const {result} = renderHook(() => useProgressivePortfolio('user'));
  await waitFor(() => expect(result.current.parts.positions.data?.positions).toHaveLength(20));
  await act(async () => result.current.more()); expect(result.current.parts.positions.data?.positions).toHaveLength(40);
  await act(async () => result.current.more()); expect(result.current.parts.positions.data?.positions).toHaveLength(45);
  await act(async () => result.current.more()); expect(read).toHaveBeenCalledTimes(6);
  expect(result.current.parts.current.data?.total_assets_usd).toBe('999');
});
it('retries a failed next page with the same cursor, and resets after page expiry', async () => {
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  const {result} = renderHook(() => useProgressivePortfolio('user'));
  await waitFor(() => expect(result.current.parts.positions.data).toBeDefined());
  const initial = result.current.parts.positions.data!;
  read.mockRejectedValueOnce(new Error('offline'));
  await act(async () => result.current.more());
  expect(result.current.parts.positions.data?.next_cursor).toBe('next+/=');
  read.mockResolvedValueOnce({...initial, next_cursor: 'third'});
  await act(async () => result.current.more());
  expect(read.mock.calls[4][2].cursor).toBe(read.mock.calls[5][2].cursor);
  vi.mocked(Date.now).mockReturnValue(now + 121000);
  await act(async () => result.current.more());
  expect(read.mock.calls[6][2].read_id).not.toBe(initial.meta.read_id);
  expect(read.mock.calls[8][2].cursor).toBeUndefined();
});
it('ignores a late response for the previous period within the same round', async () => {
  const pending: (() => void)[] = [];
  read.mockImplementation((_id, part, req) => req.window === '1d' ? new Promise(resolve => pending.push(() => resolve(reply(part, req)))) : Promise.resolve(reply(part, req)));
  const {result} = renderHook(() => useProgressivePortfolio('user'));
  await waitFor(() => expect(result.current.parts.cash.data).toBeDefined());
  await act(async () => result.current.selectWindow('7d'));
  await act(async () => pending.forEach(resolve => resolve()));
  expect(result.current.parts.current.data?.window).toBe('7d');
  expect(result.current.parts['history-curves'].data?.window).toBe('7d');
});
