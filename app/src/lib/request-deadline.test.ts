import {afterEach, expect, it, vi} from 'vitest';
import {withRequestDeadline} from './request-deadline';

afterEach(() => vi.useRealTimers());

it('includes response body consumption in the budget even if the transport ignores abort', async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const response = {text: () => new Promise<string>(() => {})};
  const result = withRequestDeadline(async (current) => {signal = current; return await response.text();}, undefined, 100);
  const rejected = expect(result).rejects.toMatchObject({name: 'TimeoutError'});
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('distinguishes external cancellation from timeout and clears the timer', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const work = vi.fn((_signal: AbortSignal) => new Promise<void>(() => {}));
  const result = withRequestDeadline(work, controller.signal, 100);
  const rejected = expect(result).rejects.toMatchObject({name: 'AbortError'});
  await Promise.resolve();
  controller.abort();
  await rejected;
  expect(work.mock.calls[0][0].aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases timers on success and does not start pre-canceled work', async () => {
  vi.useFakeTimers();
  await expect(withRequestDeadline(async () => 'ok', undefined, 100)).resolves.toBe('ok');
  expect(vi.getTimerCount()).toBe(0);
  const controller = new AbortController(); controller.abort();
  const work = vi.fn(async () => 'never');
  await expect(withRequestDeadline(work, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
  expect(work).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
