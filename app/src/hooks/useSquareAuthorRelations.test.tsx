// @vitest-environment jsdom
import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/envelope';

const api = vi.hoisted(() => ({read: vi.fn(), follow: vi.fn(), unfollow: vi.fn()}));
vi.mock('@/api/social', () => ({getRelations: api.read, followTarget: api.follow, unfollowTarget: api.unfollow}));
import {useSquareAuthorRelations} from './useSquareAuthorRelations';
const callbacks = () => ({onError: vi.fn(), onMutation: vi.fn()});
const reply = (following: boolean) => ({data: {users: [{identifier: 'alice', following, remark: 'Friend'}]}});
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('Square author follow state', () => {
  it('batches duplicate authors once and aligns rows by identifier, not response order', async () => {
    api.read.mockResolvedValue({data: {users: [{identifier: 'bob', following: false}, {identifier: 'alice', following: true, remark: 'Friend'}]}});
    const {result} = renderHook(() => useSquareAuthorRelations('jwt', callbacks()));
    await act(() => result.current.ensure(['alice', 'bob', 'alice']));
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.read.mock.calls[0][1]).toEqual({userIdentifiers: ['alice', 'bob'], addresses: []});
    expect(result.current.entries.alice).toEqual({phase: 'ready', following: true, remark: 'Friend'});
    expect(result.current.entries.bob.following).toBe(false);
    await act(() => result.current.ensure(['alice']));
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('waits for confirmed writes, prevents double submit, and supports unfollow', async () => {
    api.read.mockResolvedValue(reply(false));
    let resolve!: (value: unknown) => void;
    api.follow.mockImplementation(() => new Promise((done) => {resolve = done;}));
    api.unfollow.mockResolvedValue({data: {following: false}});
    const handlers = callbacks();
    const {result} = renderHook(() => useSquareAuthorRelations('jwt', handlers));
    await act(() => result.current.ensure(['alice']));
    let work!: Promise<void>;
    act(() => {work = result.current.toggle('alice'); void result.current.toggle('alice');});
    expect(api.follow).toHaveBeenCalledTimes(1);
    expect(api.follow).toHaveBeenCalledWith('jwt', 'user', 'alice');
    expect(result.current.entries.alice).toMatchObject({phase: 'saving', following: false});
    await act(async () => {resolve({data: {following: true}}); await work;});
    expect(result.current.entries.alice.following).toBe(true);
    expect(handlers.onMutation).toHaveBeenLastCalledWith('alice', true);
    await act(() => result.current.toggle('alice'));
    expect(api.unfollow).toHaveBeenCalledWith('jwt', 'user', 'alice');
    expect(result.current.entries.alice.following).toBe(false);
  });

  it('recovers an uncertain write by GET without submitting a second follow', async () => {
    api.read.mockResolvedValueOnce(reply(false)).mockResolvedValueOnce(reply(true));
    api.follow.mockRejectedValue(new ApiError('network', 0, 'Unknown result'));
    const handlers = callbacks();
    const {result} = renderHook(() => useSquareAuthorRelations('jwt', handlers));
    await act(() => result.current.ensure(['alice']));
    await act(() => result.current.toggle('alice'));
    expect(result.current.entries.alice).toMatchObject({phase: 'failed', following: undefined});
    await act(() => result.current.toggle('alice'));
    expect(api.follow).toHaveBeenCalledTimes(1);
    expect(result.current.entries.alice.following).toBe(true);
    expect(handlers.onMutation).toHaveBeenLastCalledWith('alice', true);
  });

  it('hides old private state on account switch and ignores late write responses', async () => {
    api.read.mockResolvedValue(reply(false));
    let resolve!: (value: unknown) => void;
    api.follow.mockImplementation(() => new Promise((done) => {resolve = done;}));
    const handlers = callbacks();
    const {result, rerender} = renderHook(({jwt}) => useSquareAuthorRelations(jwt, handlers), {initialProps: {jwt: 'a'}});
    await act(() => result.current.ensure(['alice']));
    let work!: Promise<void>;
    act(() => {work = result.current.toggle('alice');});
    rerender({jwt: 'b'});
    expect(result.current.entries).toEqual({});
    await act(() => result.current.ensure(['alice']));
    await act(async () => {resolve({data: {following: true}}); await work;});
    expect(result.current.entries.alice.following).toBe(false);
    expect(handlers.onMutation).not.toHaveBeenCalled();
  });

  it('does not treat missing relationship fields as unfollowed or call APIs anonymously', async () => {
    api.read.mockResolvedValue({data: {users: [{identifier: 'alice'}]}});
    const {result, rerender} = renderHook(({jwt}) => useSquareAuthorRelations(jwt, callbacks()), {initialProps: {jwt: 'a' as string | undefined}});
    await act(() => result.current.ensure(['alice']));
    expect(result.current.entries.alice.phase).toBe('failed');
    expect(result.current.entries.alice.following).toBeUndefined();
    rerender({jwt: undefined});
    await act(() => result.current.ensure(['alice']));
    await act(() => result.current.toggle('alice'));
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.follow).not.toHaveBeenCalled();
  });
});
