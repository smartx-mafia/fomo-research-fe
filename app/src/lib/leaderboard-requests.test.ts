import {afterEach, expect, it, vi} from 'vitest';
import {createLeaderboardRequests} from './leaderboard-requests';
import {ApiError} from '@/api/envelope';
import type {UnifiedLeaderboardReply} from '@/api/leaderboard-new';
afterEach(() => vi.useRealTimers());
it('bounds a stuck transmission and lets a manual retry start a new request', async () => {
  vi.useFakeTimers();
  const requests = createLeaderboardRequests();
  const leave = requests.retain('board');
  const fetcher = vi.fn((_signal: AbortSignal) => new Promise<UnifiedLeaderboardReply>(() => {}));
  const pending = requests.run('board', fetcher).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetcher.mock.calls[0][0].aborted).toBe(true);
  expect(await pending).toMatchObject({name: 'TimeoutError'});
  fetcher.mockResolvedValueOnce({list: []} as unknown as UnifiedLeaderboardReply);
  await requests.run('board', fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  leave();
  await vi.runOnlyPendingTimersAsync();
});
it('shares a transmission and cancels only when the last consumer leaves', async () => {
  vi.useFakeTimers();
  const requests = createLeaderboardRequests();
  const leaveA = requests.retain('board');
  const leaveB = requests.retain('board');
  const fetcher = vi.fn((_signal: AbortSignal) => new Promise<UnifiedLeaderboardReply>(() => {}));
  const pending = requests.run('board', fetcher);
  const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
  expect(requests.run('board', fetcher)).toBe(pending);
  await Promise.resolve();
  leaveA();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher.mock.calls[0][0].aborted).toBe(false);
  leaveB();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher.mock.calls[0][0].aborted).toBe(true);
  await rejected;
});
it('bounds rate-limit retries and stops backoff on cancellation', async () => {
  vi.useFakeTimers();
  const requests = createLeaderboardRequests();
  const fetcher = vi.fn().mockRejectedValue(new ApiError('business', 420000, 'limited'));
  const leave = requests.retain('board');
  const rejected = expect(requests.run('board', fetcher)).rejects.toMatchObject({code: 420000});
  await vi.advanceTimersByTimeAsync(2000);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(3);
  const cancelled = expect(requests.run('board', fetcher)).rejects.toMatchObject({name: 'AbortError'});
  await vi.advanceTimersByTimeAsync(1);
  leave();
  await vi.advanceTimersByTimeAsync(2000);
  await cancelled;
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('does not retry authentication or invalid parameters', async () => {
  const requests = createLeaderboardRequests();
  for (const code of [400000, 100109, 500102]) {
    const leave = requests.retain(String(code));
    const fetcher = vi.fn().mockRejectedValue(new ApiError('business', code, 'failed'));
    await expect(requests.run(String(code), fetcher)).rejects.toMatchObject({code});
    expect(fetcher).toHaveBeenCalledTimes(1);
    leave();
  }
});
it('shares one deadline across slow attempts and rate-limit backoff', async () => {
  vi.useFakeTimers();
  const requests = createLeaderboardRequests();
  const leave = requests.retain('slow');
  const fetcher = vi.fn((signal: AbortSignal) => new Promise<UnifiedLeaderboardReply>((_resolve, reject) => {
    const abort = () => {clearTimeout(timer); reject(signal.reason);};
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      reject(new ApiError('business', 420000, 'limited'));
    }, 8_000);
    signal.addEventListener('abort', abort, {once: true});
  }));
  const rejected = expect(requests.run('slow', fetcher)).rejects.toMatchObject({name: 'TimeoutError'});
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0].aborted).toBe(true);
  leave();
  await vi.runOnlyPendingTimersAsync();
});
