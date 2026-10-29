// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {UnifiedLeaderboardMeta} from '@/api/leaderboard-new';
import {BUSINESS_API_BASE} from '@/config';
const {fetchMeta} = vi.hoisted(() => ({fetchMeta: vi.fn()}));
vi.mock('@/api/leaderboard-new', () => ({getUnifiedLeaderboardMeta: fetchMeta}));
import {LEADERBOARD_META_TTL_MS, loadLeaderboardMeta, readLeaderboardMeta} from './leaderboard-meta';

const options: UnifiedLeaderboardMeta = {windows: ['7d', '30d'], dimensions: ['ALL', 'Global']};
beforeEach(() => {localStorage.clear(); fetchMeta.mockReset(); fetchMeta.mockResolvedValue(options);});
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});

it('shares a navigation warmup with the page and reuses only fresh public options', async () => {
  let resolve!: (value: UnifiedLeaderboardMeta) => void;
  fetchMeta.mockImplementation(() => new Promise<UnifiedLeaderboardMeta>((done) => {resolve = done;}));
  const warm = loadLeaderboardMeta();
  const page = loadLeaderboardMeta(true);
  await Promise.resolve();
  expect(fetchMeta).toHaveBeenCalledTimes(1);
  resolve(options);
  await expect(warm).resolves.toEqual(options);
  await expect(page).resolves.toEqual(options);
  await expect(loadLeaderboardMeta()).resolves.toEqual(options);
  expect(fetchMeta).toHaveBeenCalledTimes(1);
  expect(localStorage.key(0)).toContain(BUSINESS_API_BASE);
  expect(readLeaderboardMeta()).toEqual(options);
});

it('expires filter options and forces a reload after an invalid-parameter response', async () => {
  await loadLeaderboardMeta();
  await loadLeaderboardMeta(true);
  expect(fetchMeta).toHaveBeenCalledTimes(2);
  const later = Date.now() + LEADERBOARD_META_TTL_MS + 1;
  vi.spyOn(Date, 'now').mockReturnValue(later);
  expect(readLeaderboardMeta()).toBeUndefined();
  await loadLeaderboardMeta();
  expect(fetchMeta).toHaveBeenCalledTimes(3);
});

it('ignores malformed storage and works when browser storage is unavailable', async () => {
  await loadLeaderboardMeta();
  const key = localStorage.key(0)!;
  localStorage.setItem(key, JSON.stringify({at: Date.now(), data: {windows: ['7D'], dimensions: ['ALL']}}));
  expect(readLeaderboardMeta()).toBeUndefined();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw new Error('blocked');});
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new Error('blocked');});
  await expect(loadLeaderboardMeta()).resolves.toEqual(options);
});

it('times out a hung meta request and permits another warmup', async () => {
  vi.useFakeTimers();
  fetchMeta.mockReturnValueOnce(new Promise(() => {}));
  const timedOut = expect(loadLeaderboardMeta()).rejects.toMatchObject({name: 'TimeoutError'});
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
  expect((fetchMeta.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
  await expect(loadLeaderboardMeta()).resolves.toEqual(options);
  expect(fetchMeta).toHaveBeenCalledTimes(2);
});
