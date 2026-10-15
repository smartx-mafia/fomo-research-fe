// @vitest-environment jsdom
import React from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/FavoritesProvider', () => ({useFavorites: () => ({ensureStatus: () => {}}), StarButton: () => null}));
vi.mock('@/session/storage', () => ({useSession: () => null}));
vi.mock('@/components/WatchlistPanel', () => ({default: () => <div>My watchlist</div>}));
import {TokenTable} from './TokenTable';
import {normalizeTokenMarket} from '@/lib/market';

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
const row = (chain: string, symbol: string) => ({chain, address: `0x${symbol.toLowerCase()}`, symbol, name: `${symbol} token`, price: 1});
const snapshot = (socket: Socket, topic: string, seq: number, chain: string, symbol: string) => act(() => socket.frame({topic, kind: 'snapshot', seq, data: {items: [row(chain, symbol)]}}));
const start = () => { const socket = Socket.instances.at(-1)!; act(() => socket.open()); return socket; };

beforeEach(() => { Socket.instances = []; vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket); });
afterEach(() => {
  cleanup();
  for (const socket of Socket.instances) act(() => socket.close());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('实验榜独立订阅，保留服务端顺序和FDV展示，切回原Trending', () => {
  render(<TokenTable initialTrending={null} />);
  const socket = start();
  snapshot(socket, 'board:trending', 50, 'bsc', 'OLD');
  fireEvent.click(screen.getByRole('button', {name: '机会榜 · 测试'}));
  expect(socket.sent.slice(-2)).toEqual([{op:'unsubscribe',topic:'board:trending'},{op:'subscribe',topic:'board:discovery_lab'}]);
  expect(screen.queryByText('OLD')).toBeNull();
  expect(screen.queryByLabelText('Chain')).toBeNull();
  act(() => socket.frame({topic:'board:discovery_lab',kind:'snapshot',seq:1,data:{items:[
    {...row('solana','FIRST'), market_cap:900000000, market_cap_diluted:1000000, volume_1h:30000},
    {...row('base','SECOND'), market_cap_diluted:2000000, volume_1h:900000},
  ]}}));
  expect(screen.getByRole('columnheader',{name:'FDV'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'Vol 1h'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'Risk'})).toBeTruthy();
  const rows = screen.getAllByRole('row');
  expect(rows[1].textContent).toContain('FIRST');
  expect(rows[1].textContent).not.toContain('900M');
  expect(rows[2].textContent).toContain('SECOND');
  fireEvent.click(screen.getByRole('button', {name:'Trending'}));
  expect(socket.sent.at(-1)).toEqual({op:'subscribe',topic:'board:trending'});
  expect(screen.queryByText('FIRST')).toBeNull();
  snapshot(socket, 'board:trending', 51, 'bsc', 'ORIGINAL');
  expect(screen.getByRole('columnheader',{name:'Market Cap'})).toBeTruthy();
});

it('实验专用页面仅订阅实验榜，不请求Trending', () => {
  render(<TokenTable initialTrending={null} initialBoard="discovery_lab" />);
  const socket = start();
  expect(socket.sent).toEqual([{op:'subscribe',topic:'board:discovery_lab'}]);
});

it('切到自选释放实验榜，迟到的实验帧不能进入Trending', () => {
  render(<TokenTable initialTrending={null} initialBoard="discovery_lab" />);
  const socket = start();
  snapshot(socket, 'board:discovery_lab', 10, 'base', 'LAB');
  fireEvent.click(screen.getByRole('button', {name:'★ Watchlist'}));
  expect(socket.sent.at(-1)).toEqual({op:'unsubscribe',topic:'board:discovery_lab'});
  fireEvent.click(screen.getByRole('button', {name:'Trending'}));
  snapshot(socket, 'board:discovery_lab', 11, 'base', 'LATE');
  expect(screen.queryByText('LATE')).toBeNull();
  snapshot(socket, 'board:trending', 1, 'base', 'CURRENT');
  expect(screen.getByText('CURRENT')).toBeTruthy();
});


it('完整无风险项和平台验证提供准确说明，不打开不可用提示', () => {
  render(<TokenTable initialTrending={null} initialBoard="discovery_lab" />);
  const socket = start();
  act(() => socket.frame({topic:'board:discovery_lab',kind:'snapshot',seq:1,data:{items:[
    {...row('base','CLEAR'), risk:{assessment:{grade:1,checks_complete:true,items:[],buy_action:'allow'}}},
    {...row('base','VERIFIED'), risk:{assessment:{grade:1,checks_complete:false,items:[],buy_action:'allow',verification:{eligible:true,suspended:false}}}},
  ]}}));
  fireEvent.click(screen.getByText('未报告风险项'));
  expect(screen.getByText('最近一次评估未列出风险项，不代表安全保证。交易前仍以最新风控为准。')).toBeTruthy();
  fireEvent.click(screen.getByText('平台已验证'));
  expect(screen.getByText('平台验证资格不代表无风险或已完成全部检查。交易前仍以最新风控为准。')).toBeTruthy();
  expect(screen.queryByText('Risk data is unavailable or incomplete. This does not mean the token is safe. Ordinary transaction checks still apply.')).toBeNull();
});
