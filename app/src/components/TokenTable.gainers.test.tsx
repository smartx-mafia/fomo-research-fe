// @vitest-environment jsdom
import React from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('@/components/FavoritesProvider', () => ({useFavorites: () => ({ensureStatus: () => {}}), StarButton: () => null}));
vi.mock('@/session/storage', () => ({useSession: () => null}));
vi.mock('@/components/WatchlistPanel', () => ({default: () => null}));
import {TokenTable} from './TokenTable';
import {boardTopic} from '@/lib/ws';
import {fetchBoard, MARKET_API_BASE} from '@/lib/market';
class Socket {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0;
  sent: {op: string; topic: string}[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void;
  onmessage?: (event: {data: string}) => void;
  constructor(_url: string) { Socket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  frame(data: unknown) { this.onmessage?.({data: JSON.stringify(data)}); }
}
const row = (symbol: string, change: unknown = 19.47, chain = 'base') => ({chain, address: `0x${symbol}`, symbol, name: `${symbol} token`, price_change_1h: change, price_change_24h: -50});
const snapshot = (socket: Socket, topic: string, seq: number, items: unknown[]) => act(() => socket.frame({topic, kind: 'snapshot', seq, data: {items}}));
const start = () => { const socket = Socket.instances.at(-1)!; act(() => socket.open()); return socket; };
const fetchMock = vi.fn();
const response = (items: unknown[], seq = 1) => new Response(JSON.stringify({code: 200, data: {seq, items}}));
beforeEach(() => {
  Socket.instances = []; vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  fetchMock.mockReset().mockImplementation(() => new Promise(() => {})); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup(); for (const socket of Socket.instances) act(() => socket.close());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
describe('Gainers board contract', () => {
  it('scopes only Gainers while preserving the mainline cross-chain contracts of existing boards', async () => {
    fetchMock.mockImplementation(async () => response([]));
    await fetchBoard('gainers', {chain: 'solana,base,base'});
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`${MARKET_API_BASE}/v1/boards/gainers?chain=base%2Csolana`);
    await fetchBoard('trending', {chain: 'base'});
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`${MARKET_API_BASE}/v1/boards/trending`);
    expect(boardTopic('trending', 'base')).toBe('board:trending');
    expect(boardTopic('discovery_lab', 'base')).toBe('board:discovery_lab');
  });
  it('uses canonical multi-chain server views and discards late old-scope data', () => {
    render(<TokenTable initialTrending={null} />); const socket = start();
    fireEvent.click(screen.getByRole('button', {name: 'Gainers'}));
    snapshot(socket, 'board:gainers', 90, [row('GLOBAL')]);
    fireEvent.click(screen.getByRole('checkbox', {name: 'SOL'}));
    fireEvent.click(screen.getByRole('checkbox', {name: 'BASE'}));
    expect(socket.sent.slice(-2)).toEqual([{op: 'unsubscribe', topic: 'board:gainers:solana'}, {op: 'subscribe', topic: 'board:gainers:base,solana'}]);
    expect(screen.queryByText('GLOBAL')).toBeNull();
    snapshot(socket, 'board:gainers', 91, [row('LATE_GLOBAL')]);
    snapshot(socket, 'board:gainers:base,solana', 1, [row('LOCAL')]);
    expect(screen.queryByText('LATE_GLOBAL')).toBeNull(); expect(screen.getByText('LOCAL')).toBeTruthy();
    expect(boardTopic('gainers', 'solana,base,base')).toBe('board:gainers:base,solana');
    fireEvent.click(screen.getByRole('button', {name: '清除筛选'}));
    expect(socket.sent.at(-1)).toEqual({op: 'subscribe', topic: 'board:gainers'});
  });
  it('keeps snapshot order, displays percent once, hides invalid/downward updates immediately', () => {
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    snapshot(socket, 'board:gainers', 1, [row('FIRST', 19.47), row('SECOND', 50), row('ZERO', 0), row('NEGATIVE', -1), row('UNKNOWN', null), row('INVALID', 'bad'), row('BOOLEAN', true), row('ARRAY', [10])]);
    expect(screen.getAllByRole('row')[1].textContent).toContain('FIRST');
    expect(screen.getByText('+19.47%')).toBeTruthy();
    expect(screen.queryByRole('columnheader', {name: '24h'})).toBeNull();
    for (const symbol of ['ZERO', 'NEGATIVE', 'UNKNOWN', 'INVALID', 'BOOLEAN', 'ARRAY']) expect(screen.queryByText(symbol)).toBeNull();
    act(() => socket.frame({topic: 'board:gainers', kind: 'update', seq: 2, data: [row('FIRST', -4)]}));
    expect(screen.queryByText('FIRST')).toBeNull();
    snapshot(socket, 'board:gainers', 3, [row('NEW_FIRST', 80), row('SECOND', 50)]);
    expect(screen.getAllByRole('row')[1].textContent).toContain('NEW_FIRST');
    fireEvent.click(screen.getByRole('button', {name: 'Trending'}));
    expect(screen.queryByRole('group', {name: 'Gainers chains'})).toBeNull();
    snapshot(socket, 'board:trending', 1, [row('TRENDING', -4)]);
    expect(screen.getByRole('columnheader', {name: '24h'})).toBeTruthy();
    expect(screen.getByText('TRENDING')).toBeTruthy();
  });
  it('shows selected-chain empty state only after a successful snapshot', () => {
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    fireEvent.click(screen.getByRole('checkbox', {name: 'BASE'}));
    expect(screen.queryByText('所选链近 1h 暂无符合条件的代币')).toBeNull();
    snapshot(socket, 'board:gainers:base', 1, []);
    expect(screen.getByText('所选链近 1h 暂无符合条件的代币')).toBeTruthy();
    expect(screen.getByRole('button', {name: '清除筛选'})).toBeTruthy();
  });
  it('polls the selected server scope before WS baseline and stops replacing it once WS is live', async () => {
    fetchMock.mockImplementation(async () => response([row('HTTP')]));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    await act(async () => {});
    expect(screen.getByText('HTTP')).toBeTruthy(); expect(screen.getByText('Polling')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', {name: 'SOL'}));
    fireEvent.click(screen.getByRole('checkbox', {name: 'BASE'}));
    await act(async () => {});
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/v1/boards/gainers?chain=base%2Csolana');
    snapshot(socket, 'board:gainers:base,solana', 2, [row('WS')]);
    const calls = fetchMock.mock.calls.length;
    await act(async () => {vi.advanceTimersByTime(15_000);});
    expect(fetchMock).toHaveBeenCalledTimes(calls); expect(screen.queryByText('HTTP')).toBeNull();
    act(() => socket.close());
    fetchMock.mockImplementation(async () => response([row('HTTP')], 3));
    await act(async () => {vi.advanceTimersByTime(15_000);});
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls); expect(screen.getByText('HTTP')).toBeTruthy();
  });
  it('ignores an in-flight HTTP response after a WS snapshot', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {finish = resolve;}));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    snapshot(socket, 'board:gainers', 10, [row('WS')]);
    await act(async () => {finish(response([row('STALE_HTTP')]));});
    expect(screen.getByText('WS')).toBeTruthy(); expect(screen.queryByText('STALE_HTTP')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', {name: 'BASE'}));
    expect(screen.queryByText('WS')).toBeNull();
  });
  it('ignores HTTP from the prior chain scope and recovers from a Gainers sequence gap', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {finish = resolve;}));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    fireEvent.click(screen.getByRole('checkbox', {name: 'BASE'}));
    await act(async () => {finish(response([row('OLD_SCOPE')]));});
    expect(screen.queryByText('OLD_SCOPE')).toBeNull();
    snapshot(socket, 'board:gainers:base', 1, [row('BASELINE')]);
    act(() => socket.frame({topic: 'board:gainers:base', kind: 'update', seq: 3, data: [row('GAP')]}));
    expect(screen.queryByText('BASELINE')).toBeNull(); expect(screen.queryByText('GAP')).toBeNull();
    expect(socket.sent.slice(-2)).toEqual([{op: 'unsubscribe', topic: 'board:gainers:base'}, {op: 'subscribe', topic: 'board:gainers:base'}]);
    snapshot(socket, 'board:gainers:base', 3, [row('RECOVERED')]);
    snapshot(socket, 'board:gainers:base', 2, [row('STALE')]);
    expect(screen.getByText('RECOVERED')).toBeTruthy(); expect(screen.queryByText('STALE')).toBeNull();
  });
  it('shows fetch failures distinctly from successful empty results and retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network')).mockImplementation(async () => response([]));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); start();
    await act(async () => {});
    expect(screen.getByText('榜单暂时无法更新，正在重试。')).toBeTruthy();
    expect(screen.queryByText('近 1h 暂无符合条件的代币')).toBeNull();
    await act(async () => {vi.advanceTimersByTime(15_000);});
    expect(screen.getByText('近 1h 暂无符合条件的代币')).toBeTruthy();
  });
  it('retains short-lived data with an error notice but expires it after 90 seconds of silence', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    snapshot(socket, 'board:gainers', 1, [row('CACHED')]);
    act(() => socket.close());
    await act(async () => {vi.advanceTimersByTime(89_999);});
    expect(screen.getByText('CACHED')).toBeTruthy();
    expect(screen.getByText(/以下为最近一次结果/)).toBeTruthy();
    await act(async () => {vi.advanceTimersByTime(1);});
    expect(screen.queryByText('CACHED')).toBeNull();
    expect(screen.getByText('榜单暂时无法更新，正在重试。')).toBeTruthy();
    expect(screen.queryByText('近 1h 暂无符合条件的代币')).toBeNull();
  });
  it('clears stale cached rows immediately when HTTP reports backend not-ready 500304', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({code: 500304, msg: 'board not ready'})));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    snapshot(socket, 'board:gainers', 1, [row('EXPIRED')]);
    await act(async () => {});
    act(() => socket.close());
    await act(async () => {vi.advanceTimersByTime(15_000);});
    expect(screen.queryByText('EXPIRED')).toBeNull();
    expect(screen.getByText('榜单暂时无法更新，正在重试。')).toBeTruthy();
    expect(screen.queryByText('近 1h 暂无符合条件的代币')).toBeNull();
  });
  it('handles WS not-ready as retryable failure and fresh snapshots renew the expiry timer', async () => {
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    snapshot(socket, 'board:gainers', 1, [row('FIRST')]);
    act(() => socket.frame({topic: 'board:gainers', op: 'error', reason: '500304'}));
    expect(screen.queryByText('FIRST')).toBeNull();
    expect(screen.getByText('榜单暂时无法更新，正在重试。')).toBeTruthy();
    snapshot(socket, 'board:gainers', 2, [row('FRESH')]);
    await act(async () => {vi.advanceTimersByTime(60_000);});
    snapshot(socket, 'board:gainers', 3, [row('RENEWED')]);
    await act(async () => {vi.advanceTimersByTime(60_000);});
    expect(screen.getByText('RENEWED')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Trending'}));
    snapshot(socket, 'board:trending', 1, [row('TRENDING')]);
    const count = socket.sent.length;
    await act(async () => {vi.advanceTimersByTime(90_000);});
    expect(screen.getByText('TRENDING')).toBeTruthy();
    expect(socket.sent).toHaveLength(count);
  });
  it('does not renew stale age from periodic identical snapshots or resurrect expired rows', async () => {
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); const socket = start();
    snapshot(socket, 'board:gainers', 10, [row('CACHED')]);
    await act(async () => {vi.advanceTimersByTime(60_000);});
    snapshot(socket, 'board:gainers', 10, [row('CACHED')]);
    await act(async () => {vi.advanceTimersByTime(30_000);});
    expect(screen.queryByText('CACHED')).toBeNull();
    snapshot(socket, 'board:gainers', 10, [row('CACHED')]);
    snapshot(socket, 'board:gainers', 9, [row('OLDER')]);
    expect(screen.queryByText('CACHED')).toBeNull(); expect(screen.queryByText('OLDER')).toBeNull();
    expect(screen.getByText('榜单暂时无法更新，正在重试。')).toBeTruthy();
    snapshot(socket, 'board:gainers', 11, [row('RECOVERED')]);
    expect(screen.getByText('RECOVERED')).toBeTruthy();
  });
  it('rejects cached HTTP snapshots after expiry until a newer timestamp is returned', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({code: 200, data: {seq: 4, updated_at: 1000, items: [row('HTTP_CACHED')]}})));
    render(<TokenTable initialTrending={null} initialBoard="gainers" />); start();
    await act(async () => {});
    expect(screen.getByText('HTTP_CACHED')).toBeTruthy();
    for (let i = 0; i < 6; i++) await act(async () => {vi.advanceTimersByTime(15_000);});
    expect(screen.queryByText('HTTP_CACHED')).toBeNull();
    expect(screen.getByText('榜单暂时无法更新，正在重试。')).toBeTruthy();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({code: 200, data: {seq: 4, updated_at: 2000, items: [row('HTTP_NEW')]}})));
    await act(async () => {vi.advanceTimersByTime(15_000);});
    expect(screen.getByText('HTTP_NEW')).toBeTruthy();
  });
});
