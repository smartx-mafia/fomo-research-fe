// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
const {list, ensure, jwt} = vi.hoisted(() => ({list: vi.fn(), ensure: vi.fn(), jwt: {value: 'jwt' as string | undefined}}));
vi.mock('@/session/storage', () => ({useSession: () => jwt.value ? {jwt: jwt.value, user: {identifier: 'viewer'}} : null, clearSite: vi.fn()}));
vi.mock('@/hooks/useSquareAuthorRelations', () => ({useSquareAuthorRelations: () => ({entries: {}, ensure, toggle: vi.fn()})}));
vi.mock('@/components/TokenAvatar', () => ({TokenAvatar: () => <span />}));
vi.mock('next/image', () => ({default: ({unoptimized: _u, ...props}: React.ImgHTMLAttributes<HTMLImageElement> & {unoptimized?: boolean}) => <img {...props} />}));
vi.mock('@/api/social-content', async (original) => ({...await original<typeof import('@/api/social-content')>(), listSquareFeedPage: list, getSquareFeedUpdates: vi.fn()}));
vi.mock('next/dynamic', () => ({default: () => function Position({target, onClose}: {target: {identifier: string; kind: string; cycleKey?: string}; onClose: () => void}) {return <div role="dialog" aria-label="持仓详情"><output>{JSON.stringify(target)}</output><button onClick={onClose}>关闭</button></div>;}}));
import {SquareFeed} from './SquareFeed';
const token = {chain: 'bsc', address: '0xabc', symbol: 'COIN', name: 'Coin', decimals: 0, is_verify: false};
const platform = {type: 1, sourceID: '1', actorIdentifier: 'alice', actorType: 'user', actor: {identifier: 'alice', nickname: 'Alice'}, sortTime: {seconds: 100, nanos: 0}, content: {kind: 'opinion', token, position: {asset: {chain: 'bsc', token_address: '0xabc'}, cycle_key: 'original-cycle', shares_raw: '0'}, opinion: {latestVersion: {body: 'Original closed opinion', items: [], versionID: '1', likeCount: 0}}}};
const smart = {type: 2, sourceID: '2', actorIdentifier: '0xwallet', actorType: 'smart_money', actor: {identifier: ''}, smartMoney: {address: '0xwallet', subjectId: 'subject:42', chains: ['bsc']}, sortTime: {seconds: 100, nanos: 0}, content: {kind: 'trade', trade: {side: 'buy', chain: 'bsc', tokenAddress: '0xabc', token: {...token, symbol: 'SMART'}, occurredAt: {seconds: 100, nanos: 0}}}};
beforeEach(() => {
  jwt.value = 'jwt'; list.mockResolvedValue({items: [platform, smart]});
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 1;});
});
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks();});
it('wires platform opinions and explicit smart-money subjects into the shared position modal', async () => {
  render(<SquareFeed initialLane="newest" />);
  await screen.findByText('Original closed opinion');
  fireEvent.click(screen.getByRole('button', {name: '查看 COIN 持仓'}));
  expect(screen.getByRole('dialog').textContent).toContain('"cycleKey":"original-cycle"');
  expect(screen.getByRole('dialog').textContent).toContain('"identifier":"alice"');
  fireEvent.click(screen.getByRole('button', {name: '关闭'}));
  fireEvent.click(screen.getByRole('button', {name: '查看 SMART 持仓'}));
  expect(screen.getByRole('dialog').textContent).toContain('"kind":"external_user"');
  expect(screen.getByRole('dialog').textContent).toContain('"identifier":"subject:42"');
});
it('immediately closes the holder when the login session changes', async () => {
  const view = render(<SquareFeed initialLane="newest" />);
  await screen.findByText('Original closed opinion');
  fireEvent.click(screen.getByRole('button', {name: '查看 COIN 持仓'}));
  expect(screen.getByRole('dialog')).toBeTruthy();
  jwt.value = undefined;
  view.rerender(<SquareFeed initialLane="newest" />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
