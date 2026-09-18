// @vitest-environment jsdom
import React from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const control = vi.hoisted(() => ({jwt: 'jwt' as string | undefined, following: {} as Record<string, boolean>, list: vi.fn(), follow: vi.fn(), unfollow: vi.fn(), relations: vi.fn()}));
vi.mock('@/session/storage', () => ({useSession: () => control.jwt ? {jwt: control.jwt, user: {identifier: 'viewer'}} : null, clearSite: vi.fn()}));
vi.mock('next/image', () => ({default: ({unoptimized: _u, ...props}: React.ImgHTMLAttributes<HTMLImageElement> & {unoptimized?: boolean}) => <img {...props} />}));
vi.mock('@/api/social', () => ({getRelations: control.relations, followTarget: control.follow, unfollowTarget: control.unfollow}));
vi.mock('@/api/social-content', async (original) => ({...await original<typeof import('@/api/social-content')>(), listSquareFeedPage: control.list, getSquareFeedUpdates: vi.fn()}));
import {SquareFeed} from './SquareFeed';

function card(author: string, id: string) {
  return {type: 1, sourceID: id, actorIdentifier: author, actor: {identifier: author, nickname: author}, sortTime: {seconds: 100, nanos: 0}, content: {kind: 'opinion',
    opinion: {opinionID: id, authorIdentifier: author, latestVersion: {versionID: id, body: `${author} post ${id}`, items: [], viewerLike: false, likeCount: 0}},
    position: {asset: {chain: 'bsc', token_address: '0xtoken'}, shares_raw: '1', pnl_ratio: '0', symbol: 'TEST'},
  }};
}
beforeEach(() => {
  vi.clearAllMocks(); control.jwt = 'jwt'; control.following = {bob: true, alice: false, viewer: false};
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 1;});
  control.relations.mockImplementation(async (_jwt, {userIdentifiers}) => ({data: {users: userIdentifiers.map((identifier: string) => ({identifier, following: control.following[identifier] ?? false}))}}));
  control.follow.mockImplementation(async (_jwt, _type, id) => {control.following[id] = true; return {data: {following: true}};});
  control.unfollow.mockImplementation(async (_jwt, _type, id) => {control.following[id] = false; return {data: {following: false}};});
  control.list.mockImplementation(async (lane) => ({items: lane === 'SQUARE_LANE_FRIENDS'
    ? [card('bob', '1'), ...(control.following.alice ? [card('alice', '2')] : [])].filter((item) => control.following[item.actorIdentifier])
    : [card('alice', '2'), card('alice', '3'), card('viewer', '4')]}));
});
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('Square user follow integration', () => {
  it('updates every card for the author, hides self follow and refreshes cached Friends', async () => {
    render(<SquareFeed initialLane="friends" />);
    await screen.findByRole('button', {name: 'Unfollow bob'});
    fireEvent.click(screen.getByRole('tab', {name: 'Newest'}));
    await waitFor(() => expect(screen.getAllByRole('button', {name: 'Follow alice'}).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true));
    expect(screen.queryByRole('button', {name: 'Follow viewer'})).toBeNull();
    fireEvent.click(screen.getAllByRole('button', {name: 'Follow alice'})[0]);
    await waitFor(() => expect(screen.getAllByRole('button', {name: 'Unfollow alice'})).toHaveLength(2));
    await waitFor(() => expect(control.list.mock.calls.filter(([lane]) => lane === 'SQUARE_LANE_NEWEST')).toHaveLength(2));
    expect(control.follow).toHaveBeenCalledWith('jwt', 'user', 'alice');
    fireEvent.click(screen.getByRole('tab', {name: 'Friends'}));
    await screen.findByText('alice post 2');
    expect(control.list.mock.calls.filter(([lane]) => lane === 'SQUARE_LANE_FRIENDS')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', {name: 'Unfollow alice'}));
    await waitFor(() => expect(screen.queryByText('alice post 2')).toBeNull());
    expect(control.unfollow).toHaveBeenCalledWith('jwt', 'user', 'alice');
    fireEvent.click(screen.getByRole('tab', {name: 'Newest'}));
    await waitFor(() => expect(screen.getAllByRole('button', {name: 'Follow alice'})).toHaveLength(2));
    expect(control.list.mock.calls.filter(([lane]) => lane === 'SQUARE_LANE_NEWEST')).toHaveLength(3);
  });

  it('clears account-specific Newest cards when signing out even if refreshing fails', async () => {
    const {rerender} = render(<SquareFeed initialLane="newest" />);
    await screen.findByText('alice post 2');
    control.jwt = undefined;
    control.list.mockRejectedValue(new Error('offline'));
    rerender(<SquareFeed initialLane="newest" />);
    await waitFor(() => expect(screen.queryByText('alice post 2')).toBeNull());
    await screen.findByText('Square is temporarily unavailable. Your cached posts are still here.');
  });

  it('prompts anonymous visitors to sign in without dispatching a follow', async () => {
    control.jwt = undefined;
    render(<SquareFeed initialLane="newest" />);
    fireEvent.click((await screen.findAllByRole('button', {name: 'Follow alice'}))[0]);
    expect(screen.getByText('Sign in to follow this author and see their opinions in Friends.')).toBeTruthy();
    expect(screen.getByRole('link', {name: 'Go to login'})).toBeTruthy();
    expect(control.follow).not.toHaveBeenCalled();
    expect(control.relations).not.toHaveBeenCalled();
  });

  it('applies supported Opinions/Buys/Sells filters through the real query shape and keeps unsupported rows disabled', async () => {
    render(<SquareFeed initialLane="newest" />);
    await screen.findByText('alice post 2');
    fireEvent.click(screen.getByRole('button', {name: 'Open filters'}));
    expect(screen.getByRole('dialog', {name: 'Square filters'})).toBeTruthy();
    expect((screen.getByRole('checkbox', {name: /^PnL milestones/}) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', {name: /^Closed positions/}) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', {name: 'Sells'}));
    fireEvent.click(screen.getByRole('button', {name: 'Apply filters'}));
    await waitFor(() => expect(control.list.mock.calls.some(([, options]) => JSON.stringify(options?.filters) === JSON.stringify(['SQUARE_FILTER_OPINION', 'SQUARE_FILTER_BUY']))).toBe(true));
  });
});
