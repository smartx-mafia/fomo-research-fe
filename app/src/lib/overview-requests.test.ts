import {afterEach, describe, expect, it, vi} from 'vitest';
import {createOverviewRequests} from './overview-requests';
import type {TokenOverview} from './token-overview';

describe('Overview shared request ownership', () => {
  afterEach(() => vi.useRealTimers());

  it('settles cancellation immediately even when the underlying transport never settles', async () => {
    vi.useFakeTimers();
    const pool = createOverviewRequests(() => new Promise<TokenOverview>(() => {}));
    const leave = pool.retain('solana', 'A');
    let outcome = 'pending';
    void pool.run('solana', 'A').catch((error: Error) => {outcome = error.name;});
    await Promise.resolve();
    leave();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('AbortError');
  });

  it('deduplicates concurrent consumers and does not abort while one still owns it', async () => {
    vi.useFakeTimers();
    let resolve!: (value: TokenOverview) => void;
    const fetcher = vi.fn((_chain: string, _address: string, _signal: AbortSignal) => new Promise<TokenOverview>((done) => {resolve = done;}));
    const pool = createOverviewRequests(fetcher);
    const leaveA = pool.retain('solana', 'A');
    const leaveB = pool.retain('solana', 'A');
    const first = pool.run('solana', 'A');
    const second = pool.run('solana', 'A');
    await Promise.resolve();
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    leaveA();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls[0][2].aborted).toBe(false);
    resolve({address: 'A'} as TokenOverview);
    await expect(first).resolves.toMatchObject({address: 'A'});
    leaveB();
    await vi.runAllTimersAsync();
  });

  it('aborts on last-owner departure and refuses late results for a different token', async () => {
    vi.useFakeTimers();
    let settleA!: (value: TokenOverview) => void;
    const fetcher = vi.fn((_chain: string, address: string, _signal: AbortSignal) => address === 'A'
      ? new Promise<TokenOverview>((done) => {settleA = done;}) : Promise.resolve({address: 'B'} as TokenOverview));
    const pool = createOverviewRequests(fetcher);
    const leaveA = pool.retain('solana', 'A');
    const first = pool.run('solana', 'A');
    const rejected = expect(first).rejects.toMatchObject({name: 'AbortError'});
    await Promise.resolve();
    leaveA();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls[0][2].aborted).toBe(true);
    const leaveB = pool.retain('solana', 'B');
    await expect(pool.run('solana', 'B')).resolves.toMatchObject({address: 'B'});
    settleA({address: 'A'} as TokenOverview);
    await rejected;
    leaveB();
    await vi.runAllTimersAsync();
  });

  it('keeps an in-flight request during Strict Mode cleanup/remount', async () => {
    vi.useFakeTimers();
    let settle!: (value: TokenOverview) => void;
    const fetcher = vi.fn((_chain: string, _address: string, _signal: AbortSignal) => new Promise<TokenOverview>((done) => {settle = done;}));
    const pool = createOverviewRequests(fetcher);
    const cleanup = pool.retain('solana', 'A');
    const initial = pool.run('solana', 'A');
    await Promise.resolve();
    cleanup();
    const remountCleanup = pool.retain('solana', 'A');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls[0][2].aborted).toBe(false);
    expect(pool.run('solana', 'A')).toBe(initial);
    settle({address: 'A'} as TokenOverview);
    await initial;
    remountCleanup();
    await vi.runAllTimersAsync();
  });
});
